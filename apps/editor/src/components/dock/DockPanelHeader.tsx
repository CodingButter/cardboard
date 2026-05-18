import React from "react";
import type { IDockviewPanelHeaderProps } from "dockview";
import { cn } from "../../lib/cn";
import {
  findDockGroupElementAt,
  getCtrlPressed,
} from "./useCtrlDragFloatToggle";

/**
 * Ornaments — non-serialisable React-node decorations the header
 * renders alongside the title.
 *
 * These do NOT live in dockview's panel params (those are
 * JSON-serialised into the saved layout snapshot; React nodes would
 * round-trip as broken `{type,key,props,_owner,_store}` objects).
 * Instead, `<DockShell/>` supplies a map keyed by panel id via the
 * context below, and this component reads its entry by id.
 */
export interface DockPanelHeaderOrnaments {
  icon?: React.ReactNode;
  controls?: React.ReactNode;
}

export const DockPanelHeaderOrnamentsContext = React.createContext<
  Record<string, DockPanelHeaderOrnaments>
>({});

/**
 * DockPanelHeader — custom tab renderer for dockview that styles the
 * tab as a panel-header bar matching `Editor Design/Entities.png`.
 *
 * dockview's API surface used:
 *   - `<DockviewReact defaultTabComponent={DockPanelHeader} />` — wires
 *     this React component as the tab renderer for every panel that
 *     does not specify a `tabComponent` override (see
 *     `dockview/dist/esm/dockview/dockview.d.ts` — IDockviewReactProps).
 *   - `singleTabMode: 'fullwidth'` on the DockviewReact options forces
 *     groups containing exactly one panel to render their tab strip
 *     full-width (see options.d.ts). When combined with this renderer,
 *     a single-panel group looks like a panel-header bar; when the
 *     user drags a second panel into the same group, dockview
 *     automatically reverts to its narrow-tab look — that's correct
 *     fallback behaviour.
 *
 * Header shape:
 *   - 22px bar (driven by --dv-tabs-and-actions-container-height)
 *   - transparent background — inherits the panel body colour so the
 *     header reads as a thin drag handle, not a contrasting bar
 *   - small-caps uppercase title, text-[11px] tracking-wider
 *   - optional right controls slot (params.controls — a node) for
 *     inline filter chips, dropdowns, etc. Nothing rendered when
 *     absent (no placeholder chevron — non-functional UI was
 *     confusing users).
 *   - clicking-and-dragging the bar still feeds dockview's native
 *     reorder/split/popout machinery (dockview attaches its DnD
 *     listeners to the element this component renders).
 *
 * Ctrl+drag float toggle (DockShell wires the keyboard listener):
 *   - Ctrl+drag from a docked tab → drop in empty space spawns a
 *     floating group at the release point.
 *   - Ctrl+drag from a floating panel's tab → drop onto a docked
 *     group docks the panel back into that group as a tab.
 *   When Ctrl is NOT held, dockview's native drag behaviour is
 *   untouched. The pointerdown handler explicitly does NOT
 *   `preventDefault()` unless Ctrl is held, so non-Ctrl drags hand
 *   off to dockview's HTML5 DnD code cleanly. When Ctrl IS held, we
 *   call `preventDefault()` to suppress dockview's native drag and
 *   take pointer capture ourselves, then trigger the float/dock
 *   action on the eventual pointerup.
 */

const CTRL_DRAG_THRESHOLD_PX = 6;
const CTRL_DRAG_FLOAT_W = 360;
const CTRL_DRAG_FLOAT_H = 240;

export function DockPanelHeader(
  props: IDockviewPanelHeaderProps,
): React.JSX.Element | null {
  const { api, containerApi } = props;
  // Subscribe to title changes — dockview can update the title at
  // runtime via api.setTitle() so we mirror that into local state.
  const [title, setTitle] = React.useState<string>(api.title ?? "");
  React.useEffect(() => {
    setTitle(api.title ?? "");
    const sub = api.onDidTitleChange((e) => setTitle(e.title ?? ""));
    return () => sub.dispose();
  }, [api]);

  const ornaments = React.useContext(DockPanelHeaderOrnamentsContext);
  const own = ornaments[api.id] ?? {};
  // Per-panel icons are intentionally NOT rendered in the dock tab
  // strip — the title alone identifies the panel. The MANIFEST.icon
  // field is still consumed by DocksModal (panel-discovery card grid).
  const controls = own.controls ?? null;

  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // Ctrl+drag pointer handlers. We keep state in refs because the
  // gesture is a pure DOM interaction; React state would trigger
  // re-renders on every move which would chew CPU on a dense layout
  // with many tabs.
  const ctrlDragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
    wasFloating: boolean;
  } | null>(null);

  const clearCtrlDragVisual = React.useCallback(() => {
    if (rootRef.current) {
      rootRef.current.removeAttribute("data-ctrl-drag");
    }
  }, []);

  const onPointerDown = React.useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      // Only left button. Other buttons fall through to dockview /
      // browser-default context menus.
      if (ev.button !== 0) return;
      if (!getCtrlPressed()) return;
      // Capture before stopping propagation so dockview's drag-start
      // handler (registered on the same element) doesn't kick in. We
      // can't actually cancel dockview's listener — it's attached
      // separately — but stopping propagation and preventing the
      // native HTML5 drag is enough since dockview's drag handle
      // relies on a `dragstart` it never receives once we suppress
      // pointer-based interaction.
      ev.preventDefault();
      ev.stopPropagation();

      const target = ev.currentTarget;
      try {
        target.setPointerCapture(ev.pointerId);
      } catch {
        // ignore — some browsers refuse capture mid-pointerdown
      }

      ctrlDragRef.current = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        started: false,
        wasFloating: api.location.type === "floating",
      };
    },
    [api],
  );

  const onPointerMove = React.useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = ctrlDragRef.current;
      if (!state) return;
      if (ev.pointerId !== state.pointerId) return;
      if (state.started) return;
      const dx = ev.clientX - state.startX;
      const dy = ev.clientY - state.startY;
      if (dx * dx + dy * dy < CTRL_DRAG_THRESHOLD_PX * CTRL_DRAG_THRESHOLD_PX) {
        return;
      }
      state.started = true;
      // Apply in-progress visual.
      if (rootRef.current) {
        rootRef.current.setAttribute("data-ctrl-drag", "active");
      }
    },
    [],
  );

  const onPointerUp = React.useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = ctrlDragRef.current;
      if (!state) return;
      if (ev.pointerId !== state.pointerId) return;
      const target = ev.currentTarget;
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      ctrlDragRef.current = null;
      clearCtrlDragVisual();

      // If the pointer never moved past the threshold treat this as
      // a click — no float/dock action. dockview's tab-click logic
      // already ran (it listens on the same element via React's
      // SyntheticEvent system); the panel is already active.
      if (!state.started) return;

      // Releasing Ctrl mid-drag aborts the gesture — the user
      // changed their mind about toggling float state. We've
      // already suppressed dockview's native drag for this pointer
      // sequence so the panel simply stays put.
      if (!getCtrlPressed() && !ev.ctrlKey) return;

      // Resolve the live IDockviewPanel via the containerApi — we
      // can't trust the closure-captured `api` in pathological cases
      // (e.g. the panel was replaced mid-drag).
      const panel = containerApi.getPanel(api.id);
      if (!panel) return;

      if (state.wasFloating) {
        // Floating → docked. Hit-test the document at the release
        // point; find the corresponding DockviewGroupPanel via DOM
        // identity match against api.groups[*].element.
        const groupEl = findDockGroupElementAt(ev.clientX, ev.clientY);
        if (!groupEl) return; // no docked target — leave float in place
        // `containerApi.groups` returns the concrete
        // `DockviewGroupPanel[]` (the type `panel.api.moveTo` expects
        // for its `group` field). Each group exposes its container
        // node via `.element` — we identity-match the hit-tested
        // element against the group elements to recover the live
        // group reference.
        const groups = containerApi.groups;
        type GroupWithEl = (typeof groups)[number] & { element?: HTMLElement };
        let targetGroup: (typeof groups)[number] | null = null;
        for (const g of groups) {
          const el = (g as GroupWithEl).element;
          if (!el) continue;
          if (el === groupEl || el.contains(groupEl) || groupEl.contains(el)) {
            targetGroup = g;
            break;
          }
        }
        if (!targetGroup) return;
        try {
          panel.api.moveTo({
            group: targetGroup,
            position: "center",
          });
        } catch {
          // dockview rejected the move — non-fatal; float stays put.
        }
        return;
      }

      // Docked → floating. dockview's `addFloatingGroup` takes
      // `x` / `y` in coordinates relative to the dockview root
      // element (NOT viewport / page). We translate the release
      // point into that space by subtracting the dockview root's
      // bounding-rect origin.
      let originX = 0;
      let originY = 0;
      // The dockview root lives at the closest `.dv-dockview`
      // ancestor of the tab element.
      const dockRoot = target.closest<HTMLElement>(".dv-dockview");
      if (dockRoot) {
        const rect = dockRoot.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
      }
      const localX = Math.max(
        0,
        Math.round(ev.clientX - originX - CTRL_DRAG_FLOAT_W / 2),
      );
      const localY = Math.max(
        0,
        Math.round(ev.clientY - originY - 12),
      );

      try {
        containerApi.addFloatingGroup(panel, {
          x: localX,
          y: localY,
          width: CTRL_DRAG_FLOAT_W,
          height: CTRL_DRAG_FLOAT_H,
        });
      } catch {
        // dockview rejected the float (e.g. last panel in last
        // docked group). Non-fatal — the panel keeps its current
        // location.
      }
    },
    [api, clearCtrlDragVisual, containerApi],
  );

  const onPointerCancel = React.useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = ctrlDragRef.current;
      if (!state) return;
      if (ev.pointerId !== state.pointerId) return;
      ctrlDragRef.current = null;
      clearCtrlDragVisual();
    },
    [clearCtrlDragVisual],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        // Header bar geometry — full height of dockview's tab strip
        // (driven by --dv-tabs-and-actions-container-height, currently
        // 22px). No own background or bottom rule — inherits the
        // panel-body colour and reads as a thin drag handle. Panel
        // content paints its own surfaces (cards / sections) so the
        // header doesn't need a separator from the body.
        "dock-panel-header h-full w-full",
        "flex items-center gap-2",
        "px-3",
        "text-(--color-fg-secondary)",
        "text-[11px] font-medium uppercase tracking-wider",
        "select-none",
        "cursor-grab active:cursor-grabbing",
        // Visual feedback for Ctrl-drag. Two layers:
        //   - Armed (Ctrl held, no drag yet): a soft amber outline
        //     hints that Ctrl-drag is available. Driven by a body
        //     attribute set by useCtrlDragFloatToggle.
        //   - Active (drag in progress): a stronger amber tint +
        //     grabbing cursor. Driven by our own data attribute set
        //     in pointermove once the threshold is crossed.
        "data-[ctrl-drag=active]:cursor-grabbing",
        "data-[ctrl-drag=active]:bg-amber-500/30",
      )}
      data-dock-panel-header
      // Forward a couple of useful identifiers so the popout-gesture
      // layer can find the right panel from a pointer hit-test.
      data-panel-id={api.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="dock-panel-header__title flex-1 truncate">{title}</span>
      {controls ? (
        <span className="dock-panel-header__controls flex items-center gap-1">
          {controls}
        </span>
      ) : null}
    </div>
  );
}

export default DockPanelHeader;
