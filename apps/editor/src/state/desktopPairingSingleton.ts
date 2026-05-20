// Proper ESM import — see the matching JSDoc in
// `sidecar/lib/peerTransport.ts` for the full history. Briefly:
// previously this file used a side-effect import of
// `peerjs/dist/peerjs.min.js` (the browser bundle that assigns
// `window.Peer`), which got tree-shaken in production builds and
// crashed Pages with "Peer is not a constructor". Switching to the
// named ESM import anchors peerjs in the graph and pulls the three
// peer-deps (`peerjs-js-binarypack`, `webrtc-adapter`,
// `@msgpack/msgpack`) that are installed in this workspace.
import { Peer } from "peerjs";
import type { Peer as PeerCtor, DataConnection } from "peerjs";
import type {
  SidecarIdentity,
  DeviceTier,
  WireMessage,
} from "./pairingTypes";
import { useDesktopPairingStore } from "./useDesktopPairingStore";

/**
 * desktopPairingSingleton — owns the live `Peer` + per-peer
 * `DataConnection` instances on the desktop (editor) side.
 *
 * These objects aren't serializable so they don't belong inside a
 * zustand store — especially one wrapped by `createSyncedStore`, which
 * round-trips state through localStorage. The singleton lives at module
 * scope (one per browser window). Popped-out windows get their own
 * because they're separate JS realms — that's fine; for D10b the user
 * triggers pairing from the orchestrator window's TopBar and only that
 * window needs a live `Peer`. D11+ may broker pairing across windows.
 *
 * The store mirrors the serializable subset (own peer-id, paired-peer
 * identity metadata, status) via the callbacks plumbed into
 * `initPeer(...)`.
 *
 * D10 (sidecar side) initiates the connection; D10b (this file) accepts
 * incoming connections, runs the welcome/hello handshake, and stores
 * the identity. Store-sync over the channel is deferred to D11+.
 */

interface PairedPeerRuntime {
  conn: DataConnection;
  /** Cleared as soon as the hello is received. */
  helloTimer: ReturnType<typeof setTimeout> | null;
}

interface DesktopPairingRuntime {
  peer: PeerCtor;
  /** Resolved with our PeerJS-assigned id once `peer.on("open")` fires. */
  ownIdPromise: Promise<string>;
  /** Per-paired-peer runtime keyed by the peer id. */
  peers: Map<string, PairedPeerRuntime>;
  /** The session id we announce in our `welcome` payload. */
  sessionId: string;
}

let runtime: DesktopPairingRuntime | null = null;

const HELLO_TIMEOUT_MS = 15_000;

/**
 * Mint a session id. Used in the `welcome` payload so the sidecar can
 * distinguish "same desktop, fresh page" from "same desktop, same page"
 * if it cares — D10b doesn't act on it yet, but the field is reserved
 * in the WireMessage union.
 */
function mintSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Initialise the desktop's own `Peer`. Idempotent — the second call
 * returns the cached own-id promise. The store is updated with
 * `ownPeerId` once `peer.on("open")` fires.
 *
 * The Peer is left alive for the lifetime of the page. A page reload
 * mints a fresh peer-id (PeerJS doesn't persist), which is fine —
 * paired sidecars will see the connection close and surface their
 * "Disconnected" UI per D10's reconnect logic.
 */
export function initDesktopPeer(): Promise<string> {
  if (runtime) return runtime.ownIdPromise;

  const sessionId = mintSessionId();
  // Same PeerJS Cloud defaults the sidecar uses (D10). D15 may swap in
  // a self-hosted PeerServer, but until then defaults are fine.
  const peer = new Peer({ debug: 0 });

  const ownIdPromise = new Promise<string>((resolve, reject) => {
    let resolved = false;
    peer.on("open", (id) => {
      resolved = true;
      useDesktopPairingStore.getState().setOwnPeerId(id);
      resolve(id);
    });
    peer.on("error", (err) => {
      // PeerJS surfaces signaling-server errors and per-connection
      // errors through the same channel. Only the pre-open errors are
      // terminal from the singleton's POV; once we have an id, per-
      // connection errors are handled inside `wireDataConnection`.
      if (!resolved) {
        reject(err);
      } else {
        // Best-effort log so downstream connection failures aren't
        // silent in dev.
        // eslint-disable-next-line no-console
        console.warn("[desktopPairing] peer.on('error'):", err);
      }
    });
  });

  runtime = {
    peer,
    ownIdPromise,
    peers: new Map(),
    sessionId,
  };

  // Wire incoming connections. Each sidecar dials us, then the
  // `connection` event fires once the WebRTC negotiation completes.
  peer.on("connection", (conn) => {
    wireDataConnection(conn);
  });

  return ownIdPromise;
}

/**
 * Convenience accessor for the session id. Stable across the lifetime
 * of the page; minted lazily by `initDesktopPeer`.
 */
export function getDesktopSessionId(): string | null {
  return runtime?.sessionId ?? null;
}

function wireDataConnection(conn: DataConnection): void {
  if (!runtime) return;
  const remoteId = conn.peer;
  const store = useDesktopPairingStore.getState();
  store.upsertPairedPeer(remoteId, {
    id: remoteId,
    // Identity is filled in once the sidecar's `hello` arrives.
    identity: null,
    deviceTier: null,
    status: "connecting",
    mountedKind: null,
    mountedLayout: null,
    connectedAt: Date.now(),
  });

  const helloTimer = setTimeout(() => {
    // No `hello` after 15s — drop the connection. Either the sidecar
    // is stuck or it's not actually one of ours.
    const entry = runtime?.peers.get(remoteId);
    if (!entry) return;
    try {
      entry.conn.close();
    } catch {
      /* ignore */
    }
    runtime?.peers.delete(remoteId);
    useDesktopPairingStore
      .getState()
      .markPairedPeerStatus(remoteId, "ended");
  }, HELLO_TIMEOUT_MS);

  runtime.peers.set(remoteId, { conn, helloTimer });

  conn.on("open", () => {
    // Welcome is sent immediately on channel open. The sidecar uses
    // this to flip its UI from "connecting" to "connected" with
    // minimal latency. The reciprocal `hello` from the sidecar
    // follows in `conn.on("data")`.
    const msg: WireMessage = {
      kind: "welcome",
      sessionId: runtime?.sessionId ?? mintSessionId(),
    };
    try {
      conn.send(msg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[desktopPairing] failed to send welcome:", err);
    }
  });

  conn.on("data", (raw: unknown) => {
    handleInbound(remoteId, raw);
  });

  conn.on("close", () => {
    const entry = runtime?.peers.get(remoteId);
    if (entry?.helloTimer) clearTimeout(entry.helloTimer);
    runtime?.peers.delete(remoteId);
    useDesktopPairingStore
      .getState()
      .markPairedPeerStatus(remoteId, "ended");
  });

  conn.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.warn("[desktopPairing] data channel error:", err);
    const entry = runtime?.peers.get(remoteId);
    if (entry?.helloTimer) clearTimeout(entry.helloTimer);
    runtime?.peers.delete(remoteId);
    useDesktopPairingStore
      .getState()
      .markPairedPeerStatus(remoteId, "ended");
  });
}

function handleInbound(remoteId: string, raw: unknown): void {
  if (!raw || typeof raw !== "object" || !("kind" in raw)) {
    // eslint-disable-next-line no-console
    console.warn("[desktopPairing] dropped malformed inbound:", raw);
    return;
  }
  const msg = raw as WireMessage;
  switch (msg.kind) {
    case "hello": {
      const entry = runtime?.peers.get(remoteId);
      if (entry?.helloTimer) {
        clearTimeout(entry.helloTimer);
        entry.helloTimer = null;
      }
      // Reflect the identity + tier into the store so the UI can
      // render the paired-peer chip with name/color/icon.
      useDesktopPairingStore.getState().upsertPairedPeer(remoteId, {
        id: remoteId,
        identity: msg.identity satisfies SidecarIdentity,
        deviceTier: msg.deviceTier satisfies DeviceTier,
        status: "connected",
        mountedKind: msg.mountedKind ?? null,
        mountedLayout: msg.mountedLayout ?? null,
        connectedAt: Date.now(),
      });
      return;
    }
    case "ping":
    case "pong":
    case "storeWrite":
    case "welcome":
    case "mountPanel":
    case "disconnect":
      // D10b only acts on `hello`. D11+ lights up storeWrite + ping/pong.
      // `mountPanel` is a DESKTOP-ORIGINATED message; if a sidecar
      // echoes one back (it shouldn't) we no-op rather than throw.
      return;
  }
}

/**
 * Send a `mountPanel` wire message to a single paired peer.
 *
 * Used by the drag-to-device-chip UX in the TopBar: when the user drops
 * a dockview panel tab on a paired-device chip, the chip calls this to
 * tell the sidecar to mount that panel. Returns `true` if the message
 * was put on the wire, `false` if no connection existed or send threw.
 *
 * D10b ships only the DESKTOP side of this — sidecars still need to
 * grow a `mountPanel` handler before anything visible happens on the
 * device. Forward-compat: sidecars that don't know the kind drop it
 * silently per the pairingTypes contract.
 */
export function sendMountPanel(
  remoteId: string,
  payload: {
    panelKind: string;
    label: string;
    asTab?: boolean;
    hint?: "left" | "right" | "bottom";
    state?: unknown;
  },
): boolean {
  const entry = runtime?.peers.get(remoteId);
  if (!entry) return false;
  const msg: WireMessage = {
    kind: "mountPanel",
    panelKind: payload.panelKind,
    label: payload.label,
    asTab: payload.asTab,
    hint: payload.hint,
    state: payload.state,
  };
  try {
    entry.conn.send(msg);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[desktopPairing] failed to send mountPanel:", err);
    return false;
  }
}

/**
 * Disconnect a single paired peer. Closes the data channel and marks
 * the store entry "ended". Safe to call with an unknown id.
 */
export function disconnectPairedPeer(remoteId: string): void {
  const entry = runtime?.peers.get(remoteId);
  if (!entry) return;
  if (entry.helloTimer) clearTimeout(entry.helloTimer);
  try {
    entry.conn.send({ kind: "disconnect", reason: "desktop initiated" });
  } catch {
    /* ignore */
  }
  try {
    entry.conn.close();
  } catch {
    /* ignore */
  }
  runtime?.peers.delete(remoteId);
  useDesktopPairingStore
    .getState()
    .markPairedPeerStatus(remoteId, "ended");
}

/**
 * Tear down the entire Peer. Used only in tests / module HMR resets —
 * production code keeps the desktop peer alive for the page lifetime.
 */
export function destroyDesktopPeer(): void {
  if (!runtime) return;
  for (const [id, entry] of runtime.peers) {
    if (entry.helloTimer) clearTimeout(entry.helloTimer);
    try {
      entry.conn.close();
    } catch {
      /* ignore */
    }
    useDesktopPairingStore.getState().markPairedPeerStatus(id, "ended");
  }
  try {
    runtime.peer.destroy();
  } catch {
    /* ignore */
  }
  runtime = null;
  useDesktopPairingStore.getState().reset();
}
