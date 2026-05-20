import React from "react";
import * as Lucide from "lucide-react";
import type { SidecarParams } from "../lib/urlParams";
import type { SidecarIdentity } from "../lib/identityStore";
import { detectDeviceTier } from "../lib/deviceTier";
import {
  connect as transportConnect,
  disconnect as transportDisconnect,
  onMessage,
  useTransportStore,
  type WireMessage,
  type TransportStatus,
} from "../lib/peerTransport";

/**
 * ConnectingScreen — shown when the URL carries a `peer` id.
 *
 * D9 shipped a pure UI shell. D10 (this file) wires the actual PeerJS
 * transport: on mount we dial `params.peer`, subscribe to the transport
 * store for status, and on `connected` flip to a "no panel mounted yet"
 * placeholder (panel mounting itself is D11+).
 *
 * Header label is still rendered IMMEDIATELY from the URL `label` param
 * for zero-latency feedback before any data-channel traffic.
 */

interface ConnectingScreenProps {
  params: SidecarParams;
  identity: SidecarIdentity | null;
  /** User pressed Cancel — fall back to ColdLaunchScreen. */
  onCancel: () => void;
}

/**
 * Map raw `kind` URL param to a human-friendly label. The full list
 * lives in the editor's dock registry; for D10 the sidecar can't
 * reach into the registry (different module graph), so this is a
 * best-effort mirror. Unknown kinds render as titlecase of the raw
 * value.
 */
const KIND_LABELS: Record<string, string> = {
  minimap: "Minimap",
  tilePresets: "Tile Presets",
  gamePreview: "Game Preview",
  controller: "Controller",
  inspector: "Inspector",
  brush: "Brush",
  layers: "Layers",
  history: "History",
};

function describeMount(params: SidecarParams): string {
  if (params.layout) return `Layout: ${prettyKey(params.layout)}`;
  if (params.kind) return KIND_LABELS[params.kind] ?? prettyKey(params.kind);
  return "Remote panel";
}

function prettyKey(k: string): string {
  // camelCase / kebab-case → "Camel Case"
  return k
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A compact one-line summary of the most recent inbound message — fed
 *  into a dev banner so we can eyeball the channel without opening the
 *  devtools console. D10b will replace this with real handlers. */
interface InboundEcho {
  kind: WireMessage["kind"];
  at: number;
  preview: string;
}

export function ConnectingScreen({
  params,
  identity,
  onCancel,
}: ConnectingScreenProps) {
  const headerLabel = params.label ?? describeMount(params);
  const mountLabel = describeMount(params);
  const peerSlug = params.peer ? params.peer.slice(0, 8) : "unknown";

  const status = useTransportStore((s) => s.status);
  const errorMessage = useTransportStore((s) => s.errorMessage);
  const reconnectAttempt = useTransportStore((s) => s.reconnectAttempt);

  const [lastInbound, setLastInbound] = React.useState<InboundEcho | null>(null);

  // Dial the transport on mount + every time the URL params change.
  // Tearing down on unmount returns us cleanly to idle so the next
  // navigation starts fresh.
  React.useEffect(() => {
    if (!params.peer) return;
    transportConnect(params.peer, {
      identity: identity ?? {
        // Fallback identity for the case where the wizard was skipped
        // AND the boot effect hadn't minted a default yet. Real wiring
        // should always have an `identity` by this point, but we'd
        // rather send an honest "anonymous" record than crash.
        name: "Unidentified Sidecar",
        color: "#71717a",
        icon: "Tablet",
        tier: detectDeviceTier(),
        updatedAt: Date.now(),
      },
      deviceTier: identity?.tier ?? detectDeviceTier(),
      mountedKind: params.kind ?? undefined,
      mountedLayout: params.layout ?? undefined,
    });
    return () => {
      transportDisconnect();
    };
  }, [params.peer, params.kind, params.layout, identity]);

  // Subscribe to inbound messages — D10 just logs them into a dev
  // banner so the smoke test can confirm the channel is bidirectional.
  React.useEffect(() => {
    return onMessage((msg) => {
      setLastInbound({
        kind: msg.kind,
        at: Date.now(),
        preview: previewMessage(msg),
      });
    });
  }, []);

  const handleCancel = React.useCallback(() => {
    transportDisconnect();
    onCancel();
  }, [onCancel]);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c] text-zinc-100 flex flex-col">
      {/* Sticky header — header label is rendered IMMEDIATELY (zero-
          latency feedback) from the URL `label` param, before any
          WebRTC traffic happens. */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 sticky top-0 bg-[#0a0a0c]/95 backdrop-blur z-10">
        <div className="flex items-center gap-3 min-w-0">
          {identity && (
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${identity.color}22`,
                color: identity.color,
              }}
              aria-label={identity.name}
              title={identity.name}
            >
              <Lucide.Tablet className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight truncate">
              {headerLabel}
            </h1>
            <p className="text-[11px] text-zinc-500 truncate">
              Peer {peerSlug}…
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCancel}
          className="text-zinc-400 hover:text-zinc-200 min-h-[44px] px-3 text-sm flex items-center justify-center"
        >
          Cancel
        </button>
      </header>

      <main className="flex-1 flex flex-col items-stretch px-5 py-6 gap-6">
        <StatusBanner
          status={status}
          errorMessage={errorMessage}
          reconnectAttempt={reconnectAttempt}
        />

        {status === "error" ? (
          <ErrorPanel
            message={errorMessage}
            onRetry={() => {
              // Re-dial by toggling the URL through onCancel and back;
              // simpler than threading a "retry" callback up. The
              // ColdLaunchScreen handles re-entering URL flow.
              handleCancel();
            }}
          />
        ) : status === "connected" ? (
          <ConnectedPlaceholder mountLabel={mountLabel} mode={params.mode} />
        ) : (
          <SkeletonPanel
            mountLabel={mountLabel}
            mode={params.mode}
          />
        )}

        {/* Dev banner — shows the last inbound `WireMessage`. Helps
            verify the channel is bidirectional during D10 smoke tests;
            D10b will replace this with real per-store handlers. */}
        {lastInbound && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] font-mono text-zinc-400 truncate">
            <span className="text-emerald-400">in</span>{" "}
            <span className="text-zinc-200">{lastInbound.kind}</span>{" "}
            <span className="text-zinc-600">{lastInbound.preview}</span>
          </div>
        )}

        <p className="text-[11px] text-zinc-600 text-center">
          The remote dock will hydrate here once the peer is online.
        </p>
      </main>
    </div>
  );
}

function StatusBanner({
  status,
  errorMessage,
  reconnectAttempt,
}: {
  status: TransportStatus;
  errorMessage: string | null;
  reconnectAttempt: number;
}) {
  if (status === "connected") {
    return (
      <div className="flex items-center gap-3 text-emerald-300">
        <Lucide.CheckCircle className="w-5 h-5 text-emerald-400" />
        <div>
          <p className="text-sm font-medium">Connected!</p>
          <p className="text-[11px] text-zinc-500">
            Waiting for the panel to mount.
          </p>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-3 text-rose-300">
        <Lucide.AlertCircle className="w-5 h-5 text-rose-400" />
        <div>
          <p className="text-sm font-medium">
            Couldn't connect — peer not found or expired.
          </p>
          {errorMessage && (
            <p className="text-[11px] text-zinc-500 truncate">{errorMessage}</p>
          )}
        </div>
      </div>
    );
  }
  if (status === "reconnecting") {
    return (
      <div className="flex items-center gap-3 text-amber-200">
        <Lucide.Loader className="w-5 h-5 animate-spin text-amber-400" />
        <div>
          <p className="text-sm font-medium">
            Reconnecting… (attempt {reconnectAttempt}/3)
          </p>
          {errorMessage && (
            <p className="text-[11px] text-zinc-500 truncate">{errorMessage}</p>
          )}
        </div>
      </div>
    );
  }
  // connecting OR idle (idle is transient — render same spinner)
  return (
    <div className="flex items-center gap-3 text-zinc-300">
      <Lucide.Loader className="w-5 h-5 animate-spin text-amber-400" />
      <div>
        <p className="text-sm font-medium">Connecting to peer…</p>
        <p className="text-[11px] text-zinc-500">
          Establishing the data channel.
        </p>
      </div>
    </div>
  );
}

function SkeletonPanel({
  mountLabel,
  mode,
}: {
  mountLabel: string;
  mode: SidecarParams["mode"];
}) {
  return (
    <section
      className="flex-1 rounded-xl border border-zinc-900 bg-zinc-950/70 p-5 flex flex-col gap-4"
      aria-busy="true"
      aria-label={`Loading ${mountLabel}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
          {mountLabel}
        </span>
        <span className="text-[11px] text-zinc-600">
          {mode === "controller"
            ? "Controller"
            : mode === "display"
            ? "Display"
            : "Dock"}
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-3">
        <SkeletonRow width="60%" />
        <SkeletonRow width="90%" />
        <SkeletonRow width="40%" />
        <div className="flex-1 rounded-lg bg-zinc-900/60 animate-pulse min-h-[140px]" />
        <SkeletonRow width="75%" />
        <SkeletonRow width="50%" />
      </div>
    </section>
  );
}

function ConnectedPlaceholder({
  mountLabel,
  mode,
}: {
  mountLabel: string;
  mode: SidecarParams["mode"];
}) {
  return (
    <section
      className="flex-1 rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-5 flex flex-col items-center justify-center gap-3 text-center"
      aria-label={`${mountLabel} placeholder — waiting for panel mount`}
    >
      <Lucide.Plug className="w-10 h-10 text-emerald-500/70" />
      <div>
        <p className="text-sm font-medium text-emerald-200">
          Channel open — no panel mounted yet
        </p>
        <p className="text-[11px] text-zinc-500 mt-1">
          {mountLabel} · {mode === "controller"
            ? "Controller mode"
            : mode === "display"
            ? "Display mode"
            : "Dock mode"}
        </p>
      </div>
      <p className="text-[11px] text-zinc-600 max-w-xs">
        Real-time panels arrive in D11+. The channel is live and accepting
        store-sync messages.
      </p>
    </section>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="flex-1 rounded-xl border border-rose-900/50 bg-rose-950/10 p-5 flex flex-col items-center justify-center gap-4 text-center">
      <Lucide.AlertTriangle className="w-10 h-10 text-rose-400" />
      <div>
        <p className="text-sm font-medium text-rose-200">
          Couldn't connect — peer not found or expired
        </p>
        {message && (
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs truncate">
            {message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] px-4 rounded-md bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 border border-rose-500/40 text-sm font-medium"
      >
        Try Again
      </button>
    </section>
  );
}

function SkeletonRow({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded bg-zinc-900/80 animate-pulse"
      style={{ width }}
    />
  );
}

function previewMessage(msg: WireMessage): string {
  switch (msg.kind) {
    case "hello":
      return `${msg.identity?.name ?? "?"} (${msg.deviceTier})`;
    case "welcome":
      return `session=${msg.sessionId.slice(0, 8)}…`;
    case "storeWrite":
      return `store=${msg.storeId}`;
    case "disconnect":
      return msg.reason ?? "no reason";
    case "mountPanel":
      return `${msg.panelKind} (${msg.label})`;
    case "ping":
    case "pong":
      return "";
    default:
      return "";
  }
}
