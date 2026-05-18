import React from "react";
import type { DockviewApi, IDockviewPanelProps } from "dockview";
import {
  Save as SaveIcon,
  RotateCcw,
  PackagePlus,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "../../lib/cn";
import {
  useWorkspaceStore,
  type WorkspacePreset,
} from "../../state/useWorkspaceStore";
import { LayoutPresetButton } from "./LayoutPresetButton";
import { PanelPacker } from "./PanelPacker";
import type { DockPanelDef } from "./DockShell";

/**
 * WorkspacePanel — the pinned, non-closable, non-poppable workspace
 * rail. Lives as a 48px-wide column on the left edge of the dockview
 * grid by default; flips its inner stack from vertical to horizontal
 * via a CSS `@container` query when the user docks it to the top or
 * bottom edge (which makes the container wide-and-short).
 *
 * Pinned semantics are enforced in two places:
 *   - DockPanelHeader returns `null` for `panel.id === "workspace"`,
 *     so the panel has no tab strip and therefore no close affordance
 *     and no draggable header. (The header bar still exists in the
 *     DOM but at zero height.)
 *   - DockShell's popout gesture layer skips workspace panels — even
 *     if the user finds another way to drag it, `addPopoutGroup` is
 *     a no-op for the workspace id.
 *
 * Contents (vertical mode, top → bottom):
 *   - Save Layout    — captures the current dockview JSON as a named
 *                      preset. Prompts for a name via window.prompt.
 *   - Preset list    — one LayoutPresetButton per saved preset for
 *                      the active pageId. Hover for skeleton preview.
 *   - Reset Layout   — clears the persisted layout and forces the
 *                      DockShell to rehydrate the default.
 *   - Panel Packer   — toggles a flyout listing the panel registry
 *                      and lets the user drag closed panels onto the
 *                      dock to re-mount them.
 */

/** Wire-up data the workspace rail needs from the host page. Passed
 *  through dockview's `params` (string-only fields) so the rail can
 *  scope its presets/layout-key correctly. */
export interface WorkspacePanelParams {
  pageId: string;
  storageKey: string;
}

interface WorkspacePanelContext {
  api: DockviewApi | null;
  registry: readonly DockPanelDef[];
  apiRef: React.MutableRefObject<DockviewApi | null>;
}

/**
 * Context the host DockShell supplies so the panel can talk to the
 * live dockview api and the panel registry without going through
 * dockview's serialisable params. (We can't pass an api ref through
 * params; it isn't JSON-safe.)
 */
export const WorkspacePanelContext = React.createContext<WorkspacePanelContext>(
  {
    api: null,
    registry: [],
    apiRef: { current: null },
  },
);

export const WORKSPACE_PANEL_ID = "workspace";

/** Shared sentinel for "no presets for this page". Returning a fresh
 *  `[]` on every selector evaluation would break zustand's `Object.is`
 *  equality check (the default in v5) and re-render the component on
 *  every store update — including the store's own internal hydration
 *  ticks. Reusing one identity keeps the subscription stable. */
const EMPTY_PRESETS: WorkspacePreset[] = [];

/**
 * The dockview-registered panel component. dockview passes the params
 * (typed loosely as `IDockviewPanelProps["params"]`); we widen them to
 * our `WorkspacePanelParams` shape.
 */
/**
 * Runtime CSS injection — we need to collapse dockview's
 * `.dv-tabs-and-actions-container` to zero height for the workspace
 * panel's group. The `:has()` selector lives in design-system.css,
 * but Bun's dev server caches CSS bundle assets aggressively and
 * doesn't pick up changes inside `@import`'d CSS files reliably.
 * Injecting a `<style>` tag at module load guarantees the rule is
 * present at runtime regardless of bundler state. The rule is
 * idempotent — we tag the style element with a unique id so a second
 * mount doesn't double-insert.
 */
const WORKSPACE_RUNTIME_CSS_ID = "workspace-runtime-css";
function ensureRuntimeCSS(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(WORKSPACE_RUNTIME_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = WORKSPACE_RUNTIME_CSS_ID;
  style.textContent = `
    /* Collapse dockview's tab strip for the workspace panel's group.
     * Uses :has() so we don't care about wrapper depth. */
    .dockview-theme-cardboard .dv-tabs-and-actions-container:has([data-panel-id="workspace"]) {
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      border-bottom: none !important;
      overflow: hidden !important;
    }
    /* The .dv-react-part wrapper still asserts height:100%, which
     * given our 0-height container becomes 0 — but the inner sentinel
     * span we render is display:none anyway. Belt-and-braces hides
     * any dockview-injected close icon in the workspace tab. */
    .dockview-theme-cardboard .dv-tab:has([data-panel-id="workspace"]) .dv-default-tab-action {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function WorkspacePanel(
  props: IDockviewPanelProps,
): React.JSX.Element {
  // Ensure the tab-strip-collapse CSS is present in the document
  // BEFORE the workspace panel renders its body. Runs on every mount
  // but the id-guarded helper makes it a no-op after the first.
  React.useLayoutEffect(() => {
    ensureRuntimeCSS();
  }, []);
  const params = (props.params ?? {}) as Partial<WorkspacePanelParams>;
  const pageId = params.pageId ?? "default";

  const ctx = React.useContext(WorkspacePanelContext);
  const { apiRef, registry } = ctx;

  // Subscribe to the preset list for this page. We read the page's
  // entry directly inside the selector body (a new selector closure
  // each render is fine because the selector ITSELF doesn't need
  // identity stability — zustand compares the selector's RETURN
  // value, not the selector function). We use `??` to fall back to
  // a single shared empty array sentinel so an empty page doesn't
  // mint a fresh `[]` on every read (which would otherwise trip
  // zustand's `Object.is` equality and cause infinite re-renders).
  const presets = useWorkspaceStore((s) => s.presets[pageId] ?? EMPTY_PRESETS);
  const savePreset = useWorkspaceStore((s) => s.savePreset);
  const renamePreset = useWorkspaceStore((s) => s.renamePreset);
  const deletePreset = useWorkspaceStore((s) => s.deletePreset);
  const setDockLayout = useWorkspaceStore((s) => s.setDockLayout);

  const storageKey = params.storageKey ?? "";

  const [packerOpen, setPackerOpen] = React.useState(false);
  const packerTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [packerAnchorRect, setPackerAnchorRect] =
    React.useState<DOMRect | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [orientation, setOrientation] = React.useState<
    "portrait" | "landscape"
  >("portrait");

  // Watch the container's orientation by reading its bounding rect.
  // The CSS `@container` query handles the visual layout switch; this
  // observer only exists so the PanelPacker flyout knows which axis
  // to anchor itself against. We use ResizeObserver only on this
  // tiny rail container; the actual layout swap is CSS-only as
  // specified.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setOrientation(r.width > r.height ? "landscape" : "portrait");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onSaveLayout = () => {
    const api = apiRef.current;
    if (!api) return;
    const name = window.prompt("Name this layout:", "New layout");
    if (name === null) return; // cancelled
    const trimmed = name.trim();
    if (!trimmed) return;
    savePreset(pageId, trimmed, api.toJSON());
  };

  const onApplyPreset = (preset: WorkspacePreset) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.fromJSON(preset.layout);
    } catch {
      // bad payload — leave the layout alone
    }
  };

  const onResetLayout = () => {
    if (!storageKey) return;
    // Clear the persisted entry first so the rehydration logic in
    // DockShell sees an empty slot and falls back to defaultLayout.
    setDockLayout(storageKey, null);
    // Then dispatch an event DockShell listens for to actually
    // re-apply the default. We can't reach the default layout from
    // here (it's defined in MapView); DockShell knows it.
    window.dispatchEvent(
      new CustomEvent("cardboard:reset-workspace", {
        detail: { storageKey },
      }),
    );
  };

  const onTogglePacker = () => {
    if (packerOpen) {
      setPackerOpen(false);
      return;
    }
    const rect = packerTriggerRef.current?.getBoundingClientRect() ?? null;
    setPackerAnchorRect(rect);
    setPackerOpen(true);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "workspace-rail",
        // The `@container size` CSS in design-system.css picks up
        // both axes from this element. flex-col is the default; the
        // landscape @container query flips it to flex-row.
        "h-full w-full bg-(--color-bg-panel) border-r border-(--color-border)",
      )}
      data-workspace-panel
    >
      <div className="workspace-rail-stack flex flex-col gap-1.5 p-1.5 items-center">
        <button
          type="button"
          onClick={onSaveLayout}
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded flex items-center justify-center",
            "bg-(--color-bg-card) hover:bg-(--color-bg-card-elev)",
            "border border-(--color-border) hover:border-(--color-accent)",
            "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
            "transition-colors",
          )}
          title="Save current layout as preset"
          aria-label="Save current layout as preset"
        >
          <SaveIcon size={16} />
        </button>

        {presets.map((preset) => (
          <LayoutPresetButton
            key={preset.id}
            preset={preset}
            onApply={onApplyPreset}
            onRename={(id, name) => renamePreset(pageId, id, name)}
            onDelete={(id) => deletePreset(pageId, id)}
          />
        ))}

        {/* Hairline divider between presets and chrome actions —
            keeps the rail readable when the preset list grows. */}
        <div
          aria-hidden
          className="workspace-rail-divider h-px w-6 bg-(--color-border) my-1"
        />

        <button
          type="button"
          onClick={onResetLayout}
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded flex items-center justify-center",
            "bg-(--color-bg-card) hover:bg-(--color-bg-card-elev)",
            "border border-(--color-border) hover:border-(--color-accent)",
            "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
            "transition-colors",
          )}
          title="Reset to default layout"
          aria-label="Reset to default layout"
        >
          <RotateCcw size={16} />
        </button>

        <button
          ref={packerTriggerRef}
          type="button"
          data-panel-packer-trigger
          onClick={onTogglePacker}
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded flex items-center justify-center",
            "bg-(--color-bg-card) hover:bg-(--color-bg-card-elev)",
            "border border-(--color-border) hover:border-(--color-accent)",
            "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
            "transition-colors",
            packerOpen &&
              "workspace-preset-button-active bg-(--color-bg-card-elev) text-(--color-fg-primary) border-(--color-accent)",
          )}
          title="Open panel packer"
          aria-label="Open panel packer"
          aria-pressed={packerOpen}
        >
          <PackagePlus size={16} />
        </button>
      </div>

      {packerOpen ? (
        <PanelPacker
          registry={registry}
          apiRef={apiRef}
          anchorRect={packerAnchorRect}
          orientation={orientation}
          onClose={() => setPackerOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Lucide icon used in the workspace panel header (when one is
 *  surfaced, e.g. in legacy code paths or for accessibility tooling).
 *  The DockPanelHeader currently suppresses the header entirely for
 *  the workspace id, but exposing the icon lets callers reference it
 *  consistently. */
export const WorkspacePanelIcon = LayoutDashboard;

export default WorkspacePanel;
