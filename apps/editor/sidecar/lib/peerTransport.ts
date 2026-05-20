// Proper ESM import — uses peerjs's `dist/bundler.mjs` entry. This
// requires the three peer-deps that `bundler.mjs` externalises to be
// installed in this workspace (they aren't transitively visible at the
// top of `node_modules/` under bun's hoisting): `peerjs-js-binarypack`,
// `webrtc-adapter`, and `@msgpack/msgpack`. They were added to this
// package's dependencies so the workspace resolves them.
//
// History: previously this file did `import "peerjs/dist/peerjs.min.js"`
// (the self-contained browser bundle that assigns `window.Peer`). That
// worked in dev because `Bun.serve` transpiles on demand without tree-
// shaking, but in production `bun build` tree-shook the side-effect
// import — the 5.3 MB bundle contained ZERO peerjs symbols, and the
// sidecar crashed with "Peer is not a constructor" on Pages. The
// `import * as _x; void _x;` workaround was also insufficient. Using a
// real named import anchors peerjs into the dependency graph properly,
// so the bundler can't drop it.
import { Peer } from "peerjs";
import type { Peer as PeerCtor, DataConnection } from "peerjs";
import { create } from "zustand";
import type { SidecarIdentity } from "./identityStore";
import type { DeviceTier } from "./deviceTier";

/**
 * SideCar PeerJS transport — wraps the `peerjs` Peer + DataConnection
 * pair behind a small status-machine + event API the UI can subscribe
 * to. Sidecar-side only for D10; desktop-side `Peer()` instantiation +
 * incoming-connection handling lands in D10b.
 *
 * Lifecycle (sidecar viewpoint):
 *
 *   ┌─────┐  connect(remoteId)  ┌────────────┐  open  ┌───────────┐
 *   │idle │ ──────────────────▶ │ connecting │ ─────▶ │ connected │
 *   └─────┘                     └────────────┘        └───────────┘
 *                                      │                    │
 *                                      │ timeout / err      │ close
 *                                      ▼                    ▼
 *                                ┌───────────┐       ┌──────────────┐
 *                                │   error   │       │ reconnecting │
 *                                └───────────┘       └──────────────┘
 *                                                           │
 *                                       max-3-tries fail   ▼
 *                                                    ┌───────────┐
 *                                                    │   error   │
 *                                                    └───────────┘
 *
 * `disconnect()` from any state → `idle` and tears down the peer.
 *
 * Inbound JSON messages are dispatched to registered listeners; the
 * status is exposed via a Zustand store so React components can
 * `useTransportStore(s => s.status)` directly. There's exactly ONE
 * live transport at a time per page — D10 only deals with a single
 * desktop peer per sidecar tab.
 */

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/**
 * `SemanticPanelKind` doesn't have a canonical definition in the editor
 * yet (the dock registry is still source-of-truth via runtime strings).
 * D10 mirrors the contract by typing it as a free-form string — the
 * sidecar's `kind` URL param is already untrusted text, and the dock
 * registry will narrow this when SemanticPanelKind becomes a real union
 * (planned alongside the engine/pack split).
 */
export type SemanticPanelKind = string;

/**
 * The on-the-wire message envelope for the sidecar ↔ desktop data
 * channel. D10 sends `hello` on channel-open and stubs the inbound
 * receiver; D10b lights up `welcome` + `storeWrite`.
 *
 * Mirrors the shape called out in REMOTE_DOCK_QR.md §D12b's
 * ControlMessage union — same channel will carry both store-sync
 * writes and control-plane traffic.
 */
export type WireMessage =
  | {
      kind: "hello";
      identity: SidecarIdentity;
      deviceTier: DeviceTier;
      mountedKind?: SemanticPanelKind;
      mountedLayout?: string;
    }
  | { kind: "welcome"; sessionId: string }
  | { kind: "storeWrite"; storeId: string; patch: unknown; origin: string }
  | { kind: "ping" }
  | { kind: "pong" }
  /**
   * Desktop → sidecar: "mount this panel on your surface."
   *
   * Lands when the user drags a dock panel tab onto a paired-device
   * chip on the desktop's TopBar. The desktop has zero authority over
   * the sidecar's layout — this is a SUGGESTION, not a command. Mobile
   * tier should tab-stack inside its single group; tablet/desktop tier
   * may honour `hint` for side-split placement. Sidecars that don't
   * recognise this kind MUST silently ignore (forward-compat). The
   * full sidecar handler lands in M2.
   */
  | {
      kind: "mountPanel";
      panelKind: SemanticPanelKind;
      label: string;
      asTab?: boolean;
      hint?: "left" | "right" | "bottom";
      state?: unknown;
    }
  | { kind: "disconnect"; reason?: string };

// ---------------------------------------------------------------------------
// Status store
// ---------------------------------------------------------------------------

export type TransportStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

interface TransportStoreState {
  status: TransportStatus;
  /** Last error message — surfaced in the UI when status === "error". */
  errorMessage: string | null;
  /** Current reconnect attempt index (0 when not reconnecting). */
  reconnectAttempt: number;
  /** Remote peer id (whatever we connect TO), if any. */
  remotePeerId: string | null;
  /** Our own PeerJS-assigned id once the Peer is open. */
  localPeerId: string | null;
}

const initialState: TransportStoreState = {
  status: "idle",
  errorMessage: null,
  reconnectAttempt: 0,
  remotePeerId: null,
  localPeerId: null,
};

export const useTransportStore = create<TransportStoreState>(() => initialState);

function setState(patch: Partial<TransportStoreState>): void {
  useTransportStore.setState(patch);
}

// ---------------------------------------------------------------------------
// Inbound message dispatch
// ---------------------------------------------------------------------------

type MessageListener = (msg: WireMessage) => void;

const listeners = new Set<MessageListener>();

/** Register a listener for incoming `WireMessage` payloads. Returns an unsubscribe fn. */
export function onMessage(fn: MessageListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function dispatchInbound(raw: unknown): void {
  // Inbound is untrusted: validate shape before fanning out. Anything
  // that doesn't look like a `WireMessage` is dropped with a warn.
  if (!raw || typeof raw !== "object" || !("kind" in raw)) {
    console.warn("[sidecar:transport] dropped malformed inbound:", raw);
    return;
  }
  const msg = raw as WireMessage;
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch (err) {
      console.error("[sidecar:transport] listener threw:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton transport
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = [1_000, 2_500, 6_000]; // exponential-ish

interface ActiveTransport {
  peer: PeerCtor;
  conn: DataConnection | null;
  remoteId: string;
  helloPayload: Omit<Extract<WireMessage, { kind: "hello" }>, "kind">;
  /** Becomes true once `disconnect()` is called — suppresses reconnect. */
  closed: boolean;
  connectTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

let active: ActiveTransport | null = null;

interface ConnectOptions {
  identity: SidecarIdentity;
  deviceTier: DeviceTier;
  mountedKind?: SemanticPanelKind;
  mountedLayout?: string;
}

/**
 * Begin connecting to `remotePeerId`. Resets the status store and tears
 * down any pre-existing transport. Calling twice is safe — the second
 * call replaces the first.
 */
export function connect(remotePeerId: string, opts: ConnectOptions): void {
  // Tear down any prior transport first.
  disconnect();

  setState({
    status: "connecting",
    errorMessage: null,
    reconnectAttempt: 0,
    remotePeerId,
    localPeerId: null,
  });

  const peer = new Peer({
    // Default to PeerJS Cloud (peerjs.com:443). No `host`/`port` config
    // needed — the SDK picks them up automatically. We may switch to a
    // self-hosted PeerServer later (D15) — but until then defaults are
    // fine for dev + the small-scale traffic of a single editor + a
    // handful of paired tablets.
    debug: 0,
  });

  active = {
    peer,
    conn: null,
    remoteId: remotePeerId,
    helloPayload: {
      identity: opts.identity,
      deviceTier: opts.deviceTier,
      mountedKind: opts.mountedKind,
      mountedLayout: opts.mountedLayout,
    },
    closed: false,
    connectTimer: null,
    reconnectTimer: null,
  };

  peer.on("open", (myId) => {
    setState({ localPeerId: myId });
    openDataConnection();
  });

  peer.on("error", (err) => {
    // PeerJS surfaces errors like `peer-unavailable` (the remote id
    // doesn't exist) here — they're terminal: stop trying. Browser /
    // network errors might be transient — let the data-channel-level
    // reconnect handle them.
    const fatal =
      err.type === "peer-unavailable" ||
      err.type === "invalid-id" ||
      err.type === "invalid-key" ||
      err.type === "browser-incompatible" ||
      err.type === "ssl-unavailable";
    failed(err.message ?? String(err), { fatal });
  });

  peer.on("disconnected", () => {
    // Signaling-server connection dropped (NOT the data channel). The
    // data channel can keep running; we just lose the ability to make
    // new connections. We'll attempt reconnect IF the data channel
    // hasn't already established itself AND we're not already in a
    // terminal error state (e.g. peer-unavailable just fired and
    // tore the transport down — the trailing `disconnected` event
    // shouldn't re-arm the reconnect loop).
    if (!active || active.closed) return;
    const status = useTransportStore.getState().status;
    if (status === "connected" || status === "error") return;
    scheduleReconnect("signaling dropped");
  });
}

function openDataConnection(): void {
  if (!active || active.closed) return;
  const { peer, remoteId, helloPayload } = active;

  // `serialization: "json"` makes peerjs JSON.stringify/JSON.parse for
  // us — saves us hand-rolling that and matches the `WireMessage` shape.
  const conn = peer.connect(remoteId, {
    reliable: true,
    serialization: "json",
  });
  active.conn = conn;

  // Connect-open timeout — if neither `open` nor `error` fires within
  // `CONNECT_TIMEOUT_MS`, surface an error so the UI doesn't sit on a
  // spinner forever. PeerJS sometimes silently hangs on
  // unreachable-remote.
  active.connectTimer = setTimeout(() => {
    if (!active) return;
    if (useTransportStore.getState().status === "connecting") {
      failed("Timed out waiting for peer.", { fatal: false });
    }
  }, CONNECT_TIMEOUT_MS);

  conn.on("open", () => {
    if (!active) return;
    clearConnectTimer();
    setState({
      status: "connected",
      errorMessage: null,
      reconnectAttempt: 0,
    });
    // First payload across the channel is always `hello` — desktop uses
    // it to pick the right snapshot to mirror back.
    send({ kind: "hello", ...active.helloPayload });
  });

  conn.on("data", (raw: unknown) => {
    dispatchInbound(raw);
  });

  conn.on("close", () => {
    if (!active || active.closed) return;
    // Channel closed unexpectedly — attempt reconnect.
    scheduleReconnect("data channel closed");
  });

  conn.on("error", (err: Error) => {
    if (!active || active.closed) return;
    scheduleReconnect(err.message ?? "data channel error");
  });
}

function clearConnectTimer(): void {
  if (active?.connectTimer) {
    clearTimeout(active.connectTimer);
    active.connectTimer = null;
  }
}

function clearReconnectTimer(): void {
  if (active?.reconnectTimer) {
    clearTimeout(active.reconnectTimer);
    active.reconnectTimer = null;
  }
}

function failed(message: string, opts: { fatal: boolean }): void {
  clearConnectTimer();
  if (opts.fatal) {
    setState({
      status: "error",
      errorMessage: message,
      reconnectAttempt: 0,
    });
    teardownPeer();
    return;
  }
  scheduleReconnect(message);
}

function scheduleReconnect(reason: string): void {
  if (!active || active.closed) return;
  clearConnectTimer();
  clearReconnectTimer();
  const attempt = useTransportStore.getState().reconnectAttempt + 1;
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    setState({
      status: "error",
      errorMessage: `Couldn't reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts (${reason}).`,
    });
    teardownPeer();
    return;
  }
  const delay =
    RECONNECT_BACKOFF_MS[attempt - 1] ??
    RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]!;
  setState({
    status: "reconnecting",
    reconnectAttempt: attempt,
    errorMessage: reason,
  });
  active.reconnectTimer = setTimeout(() => {
    if (!active || active.closed) return;
    // Close any stale data connection before redialing.
    try {
      active.conn?.close();
    } catch {
      /* ignore */
    }
    active.conn = null;
    // If the signaling channel itself is gone, ask PeerJS to reconnect
    // to the server before retrying the data channel.
    if (active.peer.disconnected) {
      try {
        active.peer.reconnect();
      } catch (err) {
        console.warn("[sidecar:transport] peer.reconnect threw:", err);
      }
    }
    openDataConnection();
  }, delay);
}

function teardownPeer(): void {
  if (!active) return;
  clearConnectTimer();
  clearReconnectTimer();
  try {
    active.conn?.close();
  } catch {
    /* ignore */
  }
  try {
    active.peer.destroy();
  } catch {
    /* ignore */
  }
  active.closed = true;
  active = null;
}

/**
 * Send a message over the data channel. No-op if the channel isn't
 * open yet — D10 only sends `hello` from the open-handler, but D10b's
 * `storeWrite` traffic will be much chattier. We drop sends made
 * before the channel is open rather than queueing them: the store-sync
 * layer handles its own snapshot/replay on connect.
 */
export function send(msg: WireMessage): void {
  if (!active || !active.conn) return;
  if (!active.conn.open) return;
  try {
    active.conn.send(msg);
  } catch (err) {
    console.warn("[sidecar:transport] send failed:", err);
  }
}

/**
 * Tear down the active transport. Safe to call when nothing is active
 * (resets the store to idle either way).
 */
export function disconnect(): void {
  teardownPeer();
  setState({ ...initialState });
}

/** Current snapshot — handy for non-React callers. */
export function getStatus(): TransportStatus {
  return useTransportStore.getState().status;
}
