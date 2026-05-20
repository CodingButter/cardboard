import React from "react";
import * as Lucide from "lucide-react";
import type { SidecarParams } from "../lib/urlParams";
import type { SidecarIdentity } from "../lib/identityStore";

/**
 * ConnectingScreen — shown when the URL carries a `peer` id. D9 is a
 * pure UI shell; no PeerJS, no WebRTC. The screen renders the
 * zero-latency header (`label` text), a loading skeleton sized to the
 * declared `kind` / `layout`, and a Cancel button.
 *
 * D10 will replace the simulated "connecting…" state with the actual
 * PeerJS handshake. The component contract — props, layout — stays the
 * same so D10 is a transport swap, not a redesign.
 */

interface ConnectingScreenProps {
  params: SidecarParams;
  identity: SidecarIdentity | null;
  /** User pressed Cancel — fall back to ColdLaunchScreen. */
  onCancel: () => void;
}

/**
 * Map raw `kind` URL param to a human-friendly label. The full list
 * lives in the editor's dock registry; for D9 the sidecar can't
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

export function ConnectingScreen({
  params,
  identity,
  onCancel,
}: ConnectingScreenProps) {
  const headerLabel = params.label ?? describeMount(params);
  const mountLabel = describeMount(params);
  const peerSlug = params.peer ? params.peer.slice(0, 8) : "unknown";

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
          onClick={onCancel}
          className="text-zinc-400 hover:text-zinc-200 min-h-[44px] px-3 text-sm flex items-center justify-center"
        >
          Cancel
        </button>
      </header>

      <main className="flex-1 flex flex-col items-stretch px-5 py-6 gap-6">
        {/* Connecting status */}
        <div className="flex items-center gap-3 text-zinc-300">
          <Lucide.Loader className="w-5 h-5 animate-spin text-amber-400" />
          <div>
            <p className="text-sm font-medium">Connecting to peer…</p>
            <p className="text-[11px] text-zinc-500">
              Establishing the data channel. Held by D10 wiring.
            </p>
          </div>
        </div>

        {/* Skeleton — sized to the declared mount. Visually shows the
            user what's about to mount once the channel opens. */}
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
              {params.mode === "controller"
                ? "Controller"
                : params.mode === "display"
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

        <p className="text-[11px] text-zinc-600 text-center">
          The remote dock will hydrate here once the peer is online.
        </p>
      </main>
    </div>
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
