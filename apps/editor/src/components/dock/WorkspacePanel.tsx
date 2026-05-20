import React from "react";
import type {
  DockviewApi,
  IDockviewPanel,
  SerializedDockview,
} from "dockview";
import {
  RotateCcw,
  Boxes,
  LayoutDashboard,
  Settings,
  CircleHelp,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspaceStore } from "../../state/useWorkspaceStore";
import { registerCommand } from "../../state/useCommandStore";
import { useRegisteredPredefinedLayouts } from "../../state/useLayoutRegistryStore";
import { Modal } from "../ui/Modal";
import { Tooltip } from "../ui/Tooltip";
import { LayoutsModal } from "./LayoutsModal";
import { DocksModal } from "./DocksModal";
import type { DockPanelDef } from "./DockShell";

/**
 * WorkspaceRail — a fixed 40px-wide vertical rail that sits to the
 * LEFT of the page's DockShell.
 *
 * We previously tried to host the rail as a dockview panel so the user
 * could move it, resize it, dock it horizontally, pop it out, etc.
 * Every flavour of that hit dockview's gridview enforcing different
 * constraints than ours, layout-change feedback loops, and orientation
 * snap problems that fought the splitter on every drag. The rail is
 * fundamentally page chrome — not a panel — and trying to model it
 * inside the docking system was wrong.
 *
 * New shape: a plain React component the page renders alongside
 * `<DockShell/>` as a sibling. No drag handle, no resize splitter, no
 * popout. The rail's children stay the same:
 *   1. Layouts button   → opens LayoutsModal
 *   2. Docks button     → opens DocksModal
 *   3. Reset Layout     → clears saved layout for this page
 *   4. Flex spacer
 *   5. Settings cog     → page-specific settings (placeholder)
 *   6. Help             → page-specific help (placeholder)
 *
 * Pages mount the rail with the same `apiRef` they hand to `DockShell`
 * so the modals can call `api.fromJSON / api.addPanel / api.toJSON`
 * against the live dockview instance.
 */

export interface WorkspaceRailProps {
  /** Page identifier — scopes the layout-presets slice in
   *  `useWorkspaceStore` and routes the predefined layout registry. */
  pageId: string;
  /** localStorage key dockview-layout persistence uses for this
   *  page. Reset Layout clears this entry. */
  storageKey: string;
  /** Same DockviewApi ref passed to the sibling DockShell. The
   *  LayoutsModal calls api.fromJSON/toJSON against this; the
   *  DocksModal calls api.addPanel against this. */
  apiRef: React.MutableRefObject<DockviewApi | null>;
  /** Panel registry exposed to the DocksModal so it can list every
   *  panel available on the page and route drag-source / addPanel
   *  calls through it. */
  registry: readonly DockPanelDef[];
}

interface RailIconButtonProps {
  icon: React.ReactNode;
  label: string;
  /** 1-sentence description surfaced as the stage-2 progressive Tooltip
   *  body. The `label` doubles as the stage-1 label. */
  description?: string;
  onClick: () => void;
  active?: boolean;
}

/**
 * Shared rail icon button — glyph-only target, no chip background.
 *
 * Per `Editor Design/Map.png`:
 *   - Idle  : muted fg, transparent
 *   - Hover : brighter fg, no bg change
 *   - Active: amber (--color-accent), no bg change
 *   - Focus : keyboard ring only (no chip surface)
 *   - Size  : 36x36 hit target with the lucide glyph centered
 */
function RailIconButton({
  icon,
  label,
  description,
  onClick,
  active,
}: RailIconButtonProps): React.JSX.Element {
  const buttonNode = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-active={active ? "true" : "false"}
      className={cn(
        "workspace-rail-icon",
        "h-9 w-9 inline-flex items-center justify-center rounded",
        "bg-transparent border border-transparent",
        active
          ? "text-(--color-accent)"
          : "text-(--color-fg-muted) hover:text-(--color-fg-primary)",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60",
        "transition-colors",
      )}
    >
      <span className="flex items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </span>
    </button>
  );
  // Progressive-reveal Tooltip: stage 1 after ~2s shows the short
  // label; stage 2 after ~5s swaps in label + description. Position on
  // the right since the rail hugs the left edge of the page.
  return (
    <Tooltip
      side="right"
      stages={[
        { delay: 1000, content: <span>{label}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{label}</div>
              {description && (
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {description}
                </div>
              )}
            </div>
          ),
        },
      ]}
    >
      {buttonNode}
    </Tooltip>
  );
}

export function WorkspaceRail({
  pageId,
  storageKey,
  apiRef,
  registry,
}: WorkspaceRailProps): React.JSX.Element {
  const setDockLayout = useWorkspaceStore((s) => s.setDockLayout);

  // Modal state — only one open at a time.
  const [layoutsOpen, setLayoutsOpen] = React.useState(false);
  const [docksOpen, setDocksOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // ── Trash drop target ──────────────────────────────────────────────
  //
  // When the user starts dragging a dockview panel by its tab/header,
  // a trash icon fades into the rail (between Reset Layout and the
  // spacer). Releasing the drag over the trash rect closes the panel
  // via `panel.api.close()`. Releasing anywhere else is a no-op for
  // this layer — dockview's native drag handling (snap-back, re-dock,
  // drag-off-viewport popout in DockShell) is unaffected because our
  // gate is a STRICT pointer-inside-trash-rect check.
  //
  // apiRef-subscription strategy:
  //   We poll `apiRef.current` via a useEffect that re-runs once per
  //   render. The DockShell sibling fills apiRef during its own
  //   `onReady` callback — there's no synchronous moment where we
  //   know it's populated, but the very next render after onReady will
  //   have it. We use a tiny `apiReady` state flag that we flip when
  //   we observe a non-null apiRef.current. If null on this pass we
  //   schedule a single rAF retry. This is the cleanest option of the
  //   three the spec suggested — no DockShell/MapView changes needed.
  const [apiReady, setApiReady] = React.useState(false);
  React.useEffect(() => {
    if (apiRef.current) {
      if (!apiReady) setApiReady(true);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (apiRef.current) {
        setApiReady(true);
        return;
      }
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [apiRef, apiReady]);

  const [dragActive, setDragActive] = React.useState(false);
  const [isOverTrash, setIsOverTrash] = React.useState(false);
  const trashRef = React.useRef<HTMLButtonElement | null>(null);
  // Captured panel + last-known pointer position survive across
  // pointermove / pointerup / dragend without forcing re-renders.
  const draggedPanelRef = React.useRef<IDockviewPanel | null>(null);
  const lastPointerRef = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!apiReady) return;
    const api = apiRef.current;
    if (!api) return;

    const isPointerInsideTrash = (x: number, y: number): boolean => {
      const el = trashRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      // Strict bbox containment — no padding/tolerance. The popout
      // gesture in DockShell only fires when the pointer is well
      // OUTSIDE the viewport, so the two layers never both claim a
      // single release point.
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const onPointerMove = (ev: PointerEvent) => {
      lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
      // Compute hover-during-drag from live coords. HTML5 drag
      // suppresses CSS :hover on most browsers, so we drive
      // `isOverTrash` ourselves.
      const over = isPointerInsideTrash(ev.clientX, ev.clientY);
      setIsOverTrash((prev) => (prev === over ? prev : over));
    };

    const cleanupListeners = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("dragend", onDragEnd, true);
    };

    const finishDrag = (releaseX: number, releaseY: number) => {
      const panel = draggedPanelRef.current;
      draggedPanelRef.current = null;
      lastPointerRef.current = null;
      cleanupListeners();
      setDragActive(false);
      setIsOverTrash(false);
      if (!panel) return;
      if (!isPointerInsideTrash(releaseX, releaseY)) return;
      try {
        panel.api.close();
      } catch {
        // Panel already removed (e.g. dockview disposed it mid-drag).
        // Non-fatal — the layout will reconcile on next layout-change.
      }
    };

    function onPointerUp(ev: PointerEvent) {
      finishDrag(ev.clientX, ev.clientY);
    }

    // HTML5 dragend fires when the OS drag completes. Some browsers
    // report (0, 0) on cancel/leave-window; fall back to the last
    // pointermove position in that case — same trick the popout
    // gesture in DockShell uses.
    function onDragEnd(ev: DragEvent) {
      const x = ev.clientX;
      const y = ev.clientY;
      const last = lastPointerRef.current;
      const px = x === 0 && y === 0 && last ? last.x : x;
      const py = x === 0 && y === 0 && last ? last.y : y;
      finishDrag(px, py);
    }

    const sub = api.onWillDragPanel((e) => {
      draggedPanelRef.current = e.panel;
      lastPointerRef.current = null;
      setDragActive(true);
      setIsOverTrash(false);
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("dragend", onDragEnd, true);
    });

    return () => {
      sub.dispose();
      cleanupListeners();
      draggedPanelRef.current = null;
      lastPointerRef.current = null;
    };
  }, [apiReady, apiRef]);

  const onResetLayout = React.useCallback(() => {
    if (!storageKey) return;
    setDockLayout(storageKey, null);
    window.dispatchEvent(
      new CustomEvent("cardboard:reset-workspace", {
        detail: { storageKey },
      }),
    );
  }, [storageKey, setDockLayout]);

  // Register workspace commands while the rail is mounted. The
  // commands are page-scoped — they reference the current `storageKey`
  // via a ref so they keep matching the active page when the user
  // navigates between tabs. Cleanup on unmount.
  const resetRef = React.useRef(onResetLayout);
  React.useEffect(() => {
    resetRef.current = onResetLayout;
  }, [onResetLayout]);
  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "workspace.resetLayout",
        title: "Reset Workspace Layout",
        category: "Workspace",
        keywords: ["reset", "layout", "workspace", "panels", "dock"],
        run: () => resetRef.current(),
      }),
      registerCommand({
        id: "workspace.openLayouts",
        title: "Open Layouts",
        category: "Workspace",
        keywords: ["layouts", "presets", "save layout"],
        run: () => setLayoutsOpen(true),
      }),
      registerCommand({
        id: "workspace.openDocks",
        title: "Open Docks",
        category: "Workspace",
        keywords: ["docks", "panels", "add panel"],
        run: () => setDocksOpen(true),
      }),
      registerCommand({
        id: "workspace.openPageSettings",
        title: "Open Page Settings",
        category: "Workspace",
        keywords: ["page", "settings", "preferences"],
        run: () => setSettingsOpen(true),
      }),
      registerCommand({
        id: "workspace.openPageHelp",
        title: "Open Page Help",
        category: "Help",
        keywords: ["page", "help", "docs"],
        run: () => setHelpOpen(true),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ── Dynamic Layouts commands. One per predefined layout for this page
  // and one per user-saved preset. Re-registers whenever the user preset
  // list changes (savePreset / deletePreset / renamePreset). The `run`
  // applies the layout via the live dockview api ref and stamps the
  // store's `lastAppliedPresetId` so subsequent UI agrees on which
  // layout is "active". `layouts.saveAsNew` and `layouts.resave` are
  // also registered here so they're discoverable from the palette even
  // when the LayoutsModal isn't open.
  // P5 — predefined layouts come from the pack-contributed registry
  // (`useLayoutRegistryStore`). The hook returns a stable array that
  // re-derives only when the registry changes, so the downstream
  // command-registration effect stays warm until a pack
  // adds/removes a preset.
  const predefinedLayouts = useRegisteredPredefinedLayouts(pageId);
  const userPresets = useWorkspaceStore(
    (s) => s.presets[pageId] ?? EMPTY_USER_PRESETS,
  );
  const lastAppliedPresetId = useWorkspaceStore(
    (s) => s.lastAppliedPresetId[pageId] ?? null,
  );
  const savePreset = useWorkspaceStore((s) => s.savePreset);
  const resavePreset = useWorkspaceStore((s) => s.resavePreset);
  const setLastAppliedPresetId = useWorkspaceStore(
    (s) => s.setLastAppliedPresetId,
  );
  const setEditingPresetId = useWorkspaceStore((s) => s.setEditingPresetId);

  const applyLayoutRef = React.useRef<(id: string, layout: SerializedDockview) => void>(
    () => undefined,
  );
  applyLayoutRef.current = (id: string, layout: SerializedDockview) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.fromJSON(layout);
      setLastAppliedPresetId(pageId, id);
    } catch {
      // bad payload — leave layout alone
    }
  };

  const saveAsNewRef = React.useRef<() => void>(() => undefined);
  saveAsNewRef.current = () => {
    const api = apiRef.current;
    if (!api) return;
    const base = "New layout";
    const taken = new Set(userPresets.map((p) => p.name));
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base} ${n++}`;
    const preset = savePreset(pageId, name, api.toJSON());
    // Mark the new preset for inline-rename mode BEFORE updating
    // `lastAppliedPresetId` so the LayoutsModal renders the freshly-
    // added card with its name input focused + selected.
    setEditingPresetId(pageId, preset.id);
    setLastAppliedPresetId(pageId, preset.id);
  };

  const resaveRef = React.useRef<() => void>(() => undefined);
  resaveRef.current = () => {
    const api = apiRef.current;
    if (!api) return;
    const active = userPresets.find((p) => p.id === lastAppliedPresetId);
    if (!active) return;
    resavePreset(pageId, active.id, api.toJSON());
  };

  React.useEffect(() => {
    const unregs: Array<() => void> = [
      registerCommand({
        id: "layouts.saveAsNew",
        title: "Save Current Layout as New",
        category: "Layouts",
        keywords: ["save", "layout", "preset", "new"],
        // Open the Layouts modal first so the user lands looking at
        // the grid where their freshly-created card is about to enter
        // inline-rename mode. `workspace.openLayouts` is idempotent —
        // calling it when the modal is already open just re-sets the
        // boolean state to true.
        preMacro: ["workspace.openLayouts"],
        run: () => saveAsNewRef.current(),
      }),
      registerCommand({
        id: "layouts.resave",
        title: "Resave Current Layout",
        category: "Layouts",
        keywords: ["resave", "overwrite", "save", "layout"],
        run: () => resaveRef.current(),
      }),
    ];
    for (const p of predefinedLayouts) {
      unregs.push(
        registerCommand({
          id: `layouts.apply.${p.id}`,
          title: `Apply Layout: ${p.name}`,
          category: "Layouts",
          keywords: ["apply", "layout", "predefined", "default", p.name],
          run: () => applyLayoutRef.current(p.id, p.layout),
        }),
      );
    }
    for (const p of userPresets) {
      unregs.push(
        registerCommand({
          id: `layouts.apply.${p.id}`,
          title: `Apply Layout: ${p.name}`,
          category: "Layouts",
          keywords: ["apply", "layout", "preset", "user", p.name],
          run: () => applyLayoutRef.current(p.id, p.layout),
        }),
      );
    }
    return () => unregs.forEach((u) => u());
  }, [predefinedLayouts, userPresets]);

  // ── Dynamic Docks commands. One per panel in the page's registry
  // (excluding the workspace rail itself, mirroring DocksModal). Each
  // `docks.add.<panelId>` materialises the panel into the live
  // dockview layout. Re-registers when the registry changes — typically
  // never, since pages declare their registry at module scope, but the
  // dependency is included for correctness.
  React.useEffect(() => {
    const cards = registry.filter((def) => def.id !== "workspace");
    const unregs = cards.map((def) =>
      registerCommand({
        id: `docks.add.${def.id}`,
        title: `Add Panel: ${def.title}`,
        category: "Docks",
        keywords: ["add", "panel", "dock", def.id, def.title],
        run: () => {
          const api = apiRef.current;
          if (!api) return;
          if (api.getPanel(def.id)) return;
          try {
            api.addPanel({
              id: def.id,
              component: def.id,
              title: def.title,
              position: { direction: "right" },
            });
          } catch {
            // dockview rejected the addPanel call — non-fatal.
          }
        },
      }),
    );
    return () => unregs.forEach((u) => u());
  }, [registry, apiRef]);

  return (
    <aside
      className={cn(
        // Fixed 40px column. shrink-0 so neighbouring flex children
        // can't shave any pixels off. The rail isn't draggable, isn't
        // resizable, isn't popoutable — it's page chrome.
        "shrink-0 w-10 h-full",
        "flex flex-col items-center gap-1",
        "py-1.5 bg-(--color-bg-panel)",
        "border-r border-(--color-border)",
      )}
      aria-label="Workspace"
    >
      <RailIconButton
        icon={<LayoutDashboard />}
        label="Layouts"
        description="Save / apply named dock layouts."
        onClick={() => setLayoutsOpen(true)}
        active={layoutsOpen}
      />
      <RailIconButton
        icon={<Boxes />}
        label="Docks"
        description="Add hidden panels to this page's layout."
        onClick={() => setDocksOpen(true)}
        active={docksOpen}
      />
      <RailIconButton
        icon={<RotateCcw />}
        label="Reset Layout"
        description="Reset this page's dock layout to its default."
        onClick={onResetLayout}
      />

      {/* Trash drop target — only visible while a dockview panel is
       *  being dragged. We always render the element (so its
       *  bounding rect is measurable the moment the drag starts) and
       *  toggle visibility via opacity + pointer-events. Fade is
       *  120ms ease-out via Tailwind's transition-opacity.
       *
       *  Idle drag state  : muted fg + hairline border chip
       *  Over-trash state : red-tinted bg + red-300 fg
       *
       *  pointer-events:none during the idle (non-drag) state keeps
       *  this from intercepting clicks elsewhere on the rail. */}
      <Tooltip
        stages={[
          { delay: 1000, content: <span>Drop to remove panel</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">Drop to remove panel</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Drag a docked panel onto this trash target to close it.
                  This only appears while a dockview panel drag is in
                  progress.
                </div>
              </div>
            ),
          },
        ]}
      >
      <button
        type="button"
        ref={trashRef}
        tabIndex={-1}
        aria-hidden={!dragActive}
        aria-label="Drop here to remove panel"
        // HTML5 drag-and-drop shows the "not-allowed" cursor by
        // default UNLESS the drop target preventDefaults dragover.
        // Without this the browser overrides our cursor styling
        // with the ⊘ glyph even though our pointer-based handler
        // does accept the drop. preventDefault on dragover +
        // setting dropEffect = 'move' tells the browser "yes I
        // accept this", which gives us the move/copy cursor.
        onDragOver={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={(e) => {
          if (!dragActive) return;
          e.preventDefault();
        }}
        className={cn(
          "workspace-rail-icon",
          "h-9 w-9 inline-flex items-center justify-center rounded",
          "border transition-[opacity,colors,background-color] duration-[120ms] ease-out",
          dragActive ? "opacity-100" : "opacity-0 pointer-events-none",
          isOverTrash
            ? "text-red-300 bg-red-500/15 border-red-400/40"
            : "text-(--color-fg-muted) bg-transparent border-(--color-border)",
        )}
      >
        <span className="flex items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px]">
          <Trash2 />
        </span>
      </button>
      </Tooltip>

      <div className="flex-1" aria-hidden />

      <RailIconButton
        icon={<Settings />}
        label="Page settings"
        description="Per-page settings (snap, ruler, etc.)."
        onClick={() => setSettingsOpen(true)}
        active={settingsOpen}
      />
      <RailIconButton
        icon={<CircleHelp />}
        label="Page help"
        description="Quick help + keyboard shortcuts for this page."
        onClick={() => setHelpOpen(true)}
        active={helpOpen}
      />

      <LayoutsModal
        open={layoutsOpen}
        onClose={() => setLayoutsOpen(false)}
        pageId={pageId}
        apiRef={apiRef}
      />
      <DocksModal
        open={docksOpen}
        onClose={() => setDocksOpen(false)}
        registry={registry}
        apiRef={apiRef}
      />

      {/* Placeholder modals — Settings + Help are page-specific and
       *  will be wired into a real page-settings system later. */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Page settings"
        description="Coming soon."
        width="md"
      >
        <p className="text-sm text-(--color-fg-secondary)">
          Page-specific settings will live here.
        </p>
      </Modal>
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Page help"
        description="Coming soon."
        width="md"
      >
        <p className="text-sm text-(--color-fg-secondary)">
          Page-specific help will live here.
        </p>
      </Modal>
    </aside>
  );
}

/** Stable empty array reference for the user-preset selector — keeps
 *  zustand's default Object.is comparison from re-running the
 *  registration effect on every store change when a page has no user
 *  presets yet. */
const EMPTY_USER_PRESETS: import("../../state/useWorkspaceStore").WorkspacePreset[] = [];

export default WorkspaceRail;
