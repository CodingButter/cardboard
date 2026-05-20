import React from "react";
import * as Lucide from "lucide-react";

/**
 * Sidecar panel registry — M2.
 *
 * Maps a `panelKind` string (the dockview panel-id the desktop sends in
 * the `mountPanel` WireMessage) to a touch-friendly React component
 * tailored to the sidecar's small-tier surface (mobile / tablet).
 *
 * Constraints:
 *
 *   • Touch-first. Tap targets ≥ 44×44, no hover affordances, generous
 *     spacing — the sidecar always runs on a finger, never a mouse.
 *
 *   • Self-contained. The sidecar bundles separately from the editor's
 *     src/ tree (different SW scope, different HTML entry). It can't
 *     reach into the editor's dock-registry or pull editor components
 *     across the module boundary. That means each entry in this map is
 *     a MOBILE MIRROR of an editor panel — they share UX intent, not
 *     code.
 *
 *   • No external state wiring yet. M2 ships the visual layer + the
 *     mount/unmount handshake; per-panel store mirroring (`storeWrite`
 *     traffic) plugs into these components in a later phase.
 *
 * Adding a new panel:
 *   1. Implement a touch-friendly component in this file (or a sibling
 *      under `sidecar/components/panels/`).
 *   2. Register it in `SIDECAR_PANEL_REGISTRY` below under the same key
 *      the desktop's dock registry uses for its panel-id.
 *   3. Don't add it to the wire-message union — the registry is private
 *      to the sidecar; unknown kinds render a friendly "unsupported"
 *      fallback per the forward-compat contract.
 *
 * Tier policy:
 *   M2 doesn't tier-gate. Every paired device gets the same registry.
 *   When tier-aware variants land (REMOTE_DOCK_QR.md §M3+) this map
 *   will become `Record<SemanticPanelKind, Partial<Record<DeviceTier,
 *   Component>>>`. The mounted-panel host can already pass `tier` to
 *   each component — components just ignore it today.
 */

export interface SidecarPanelProps {
  /** Human-readable label from the `mountPanel` payload. */
  label: string;
  /** Tier of THIS sidecar — components can adapt density if they want. */
  tier: "mobile" | "tablet" | "desktop";
  /** Optional state snapshot the desktop sent along (reserved). */
  initialState?: unknown;
}

export type SidecarPanelComponent = React.ComponentType<SidecarPanelProps>;

// ---------------------------------------------------------------------------
// Tools panel — chip strip
// ---------------------------------------------------------------------------

const TOOLS = [
  { id: "select", label: "Select", icon: "MousePointer" },
  { id: "brush", label: "Brush", icon: "Paintbrush" },
  { id: "eraser", label: "Eraser", icon: "Eraser" },
  { id: "fill", label: "Fill", icon: "PaintBucket" },
  { id: "picker", label: "Picker", icon: "Pipette" },
  { id: "wall", label: "Wall", icon: "Square" },
] as const;

function ToolsPanel(_props: SidecarPanelProps): React.JSX.Element {
  const [active, setActive] = React.useState<string>("brush");
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
        Pick a tool
      </p>
      <div className="grid grid-cols-3 gap-3">
        {TOOLS.map((tool) => {
          const isActive = tool.id === active;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActive(tool.id)}
              className={
                "min-h-[88px] rounded-xl border flex flex-col items-center justify-center gap-2 transition-colors " +
                (isActive
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 active:bg-zinc-800/80")
              }
              aria-pressed={isActive}
            >
              <LucideByName name={tool.icon} className="w-7 h-7" />
              <span className="text-sm">{tool.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-600 text-center mt-2">
        Selections sync with the editor in a later phase — M2 ships the
        touch surface only.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color picker panel — preset tile selector
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#a3a3a3",
  "#525252",
  "#fafafa",
  "#0a0a0a",
];

function ColorPickerPanel(_props: SidecarPanelProps): React.JSX.Element {
  const [selected, setSelected] = React.useState<string>(COLOR_PRESETS[0]!);
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
        Pick a color
      </p>
      <div
        className="h-16 rounded-xl border border-zinc-800"
        style={{ backgroundColor: selected }}
        aria-label={`Selected color ${selected}`}
      />
      <div className="grid grid-cols-4 gap-3">
        {COLOR_PRESETS.map((c) => {
          const isActive = c === selected;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setSelected(c)}
              className={
                "h-16 rounded-lg border-2 transition-all " +
                (isActive
                  ? "border-white scale-105"
                  : "border-transparent active:scale-95")
              }
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
              aria-pressed={isActive}
            />
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500 text-center font-mono">
        {selected}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes panel — touch-friendly textarea
// ---------------------------------------------------------------------------

function NotesPanel(_props: SidecarPanelProps): React.JSX.Element {
  const [value, setValue] = React.useState<string>("");
  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
        Notes
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Jot a thought…"
        className="flex-1 min-h-[240px] rounded-xl bg-zinc-900/70 border border-zinc-800 p-4 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 resize-none"
      />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setValue("")}
          className="flex-1 min-h-[48px] rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-300 active:bg-zinc-800/80 text-sm"
        >
          Clear
        </button>
        <button
          type="button"
          className="flex-1 min-h-[48px] rounded-xl border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 active:bg-emerald-500/20 text-sm"
        >
          Save
        </button>
      </div>
      <p className="text-[11px] text-zinc-600 text-center">
        Notes are local-only until the store-sync layer wires them up.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The sidecar's panelKind → component map. Keys mirror dockview
 * panel-ids the desktop's registry uses; unknown kinds resolve to the
 * fallback component below.
 */
export const SIDECAR_PANEL_REGISTRY: Record<string, SidecarPanelComponent> = {
  // Tools — match a few common ids the editor's dock might emit.
  tools: ToolsPanel,
  toolPicker: ToolsPanel,
  brush: ToolsPanel,

  // Color presets — the editor's "tilePresets" panel is the closest
  // semantic match in the dock registry today.
  tilePresets: ColorPickerPanel,
  colorPicker: ColorPickerPanel,
  palette: ColorPickerPanel,

  // Notes — a generic note-taking surface; no canonical editor panel
  // yet, but the kind is useful for smoke-testing the mount path with
  // a real textarea.
  notes: NotesPanel,
  scratchpad: NotesPanel,
};

/**
 * Resolve a panelKind to a component. Returns the fallback when the
 * kind isn't registered (forward-compat per the WireMessage contract).
 */
export function resolveSidecarPanel(panelKind: string): SidecarPanelComponent {
  return SIDECAR_PANEL_REGISTRY[panelKind] ?? UnsupportedPanel;
}

/**
 * Friendly fallback rendered when the sidecar receives a `mountPanel`
 * for a kind it doesn't know about. The fallback is intentionally
 * minimal — the spec says unknown kinds "MUST silently ignore," but
 * showing the user *something* is friendlier than swallowing the drop
 * silently.
 */
function UnsupportedPanel({ label }: SidecarPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Lucide.HelpCircle className="w-12 h-12 text-zinc-600" />
      <div>
        <p className="text-sm font-medium text-zinc-300">
          “{label}” isn't supported on this device yet
        </p>
        <p className="text-[11px] text-zinc-600 mt-2 max-w-xs">
          The desktop tried to mount a panel kind this sidecar doesn't
          know about. Tap back to return to the identity screen.
        </p>
      </div>
    </div>
  );
}

/**
 * Resolve a lucide icon by name. Mirrors the helper in DeviceChip.tsx
 * but kept local to avoid cross-imports between the sidecar and editor
 * bundles.
 */
function LucideByName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Lucide as Record<string, any>)[name] as
    | React.ComponentType<{ className?: string }>
    | undefined;
  if (!Icon) {
    return <Lucide.Square className={className} />;
  }
  return <Icon className={className} />;
}
