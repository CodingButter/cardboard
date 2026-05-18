import React from "react";
import type { DockviewApi, IDockviewPanel } from "dockview";
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
import { Modal } from "../ui/Modal";
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
  onClick,
  active,
}: RailIconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
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

  const onResetLayout = () => {
    if (!storageKey) return;
    setDockLayout(storageKey, null);
    window.dispatchEvent(
      new CustomEvent("cardboard:reset-workspace", {
        detail: { storageKey },
      }),
    );
  };

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
        onClick={() => setLayoutsOpen(true)}
        active={layoutsOpen}
      />
      <RailIconButton
        icon={<Boxes />}
        label="Docks"
        onClick={() => setDocksOpen(true)}
        active={docksOpen}
      />
      <RailIconButton
        icon={<RotateCcw />}
        label="Reset Layout"
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
      <button
        type="button"
        ref={trashRef}
        tabIndex={-1}
        aria-hidden={!dragActive}
        title="Drop here to remove panel"
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

      <div className="flex-1" aria-hidden />

      <RailIconButton
        icon={<Settings />}
        label="Page settings"
        onClick={() => setSettingsOpen(true)}
        active={settingsOpen}
      />
      <RailIconButton
        icon={<CircleHelp />}
        label="Page help"
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

export default WorkspaceRail;
