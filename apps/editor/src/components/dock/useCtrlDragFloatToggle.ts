import React from "react";

/**
 * useCtrlDragFloatToggle — module-level Ctrl-key tracking + DOM
 * hit-test helpers used by `DockPanelHeader` to implement
 * Ctrl+drag toggling of a panel between docked and floating.
 *
 * Why a module-level ref?
 *   Many tab headers render simultaneously, and every one of them
 *   needs to read the current Ctrl-state synchronously inside a
 *   pointerdown / pointerup handler. Re-renders driven by a React
 *   `useState` would be lossy (state updates are asynchronous and
 *   batched) AND wasteful (every tab in the layout would re-render
 *   on every keyboard tap). A module-level boolean wrapped in a
 *   `{ current }` object models the same contract as `useRef` and
 *   is read by every header via the exported `getCtrlPressed()`
 *   accessor.
 *
 * Why mount the listeners from a hook?
 *   We want the listeners attached exactly once per editor mount.
 *   DockShell calls `useCtrlDragHostListeners()` in its render so
 *   React owns the lifecycle (attach on mount, detach on unmount).
 *   The listeners are idempotent — multiple mounts only increase a
 *   reference count; the keydown/keyup pair is registered on
 *   `window` once.
 *
 * Visual feedback:
 *   - While Ctrl is held, the body element gets
 *     `data-cardboard-ctrl-drag-armed` so global CSS can tint dock
 *     tab headers (selector: `body[data-cardboard-ctrl-drag-armed]
 *     [data-dock-panel-header]`).
 *   - During an actual drag, the dragged tab's own
 *     `data-ctrl-drag="active"` attribute switches on for a stronger
 *     in-progress highlight.
 *
 * Hit-testing back to a docked group:
 *   `findDockGroupElementAt(x, y)` runs `document.elementFromPoint`
 *   then walks `closest('.dv-groupview')` upward. dockview does NOT
 *   stamp a stable `data-group-id` on group containers, so callers
 *   match the returned `HTMLElement` against the live
 *   `api.groups[*].element` list. Floating + popout groups also carry
 *   the `.dv-groupview` class, so we additionally reject hits whose
 *   ancestor carries `.dv-groupview-floating` / `.dv-groupview-popout`
 *   — Ctrl+drag from floating to floating is intentionally a no-op
 *   (the user is asking to dock, not reposition).
 */

let ctrlPressedRef = { current: false };
let listenerRefcount = 0;

function setBodyAttr(active: boolean) {
  if (typeof document === "undefined") return;
  if (active) {
    document.body.setAttribute("data-cardboard-ctrl-drag-armed", "");
  } else {
    document.body.removeAttribute("data-cardboard-ctrl-drag-armed");
  }
}

function onKeyDown(ev: KeyboardEvent) {
  if (ev.key === "Control" || ev.ctrlKey) {
    if (!ctrlPressedRef.current) {
      ctrlPressedRef.current = true;
      setBodyAttr(true);
    }
  }
}

function onKeyUp(ev: KeyboardEvent) {
  // Either the Control key itself was released, or any other key was
  // released and ctrlKey is now false (e.g. user released Ctrl while
  // another modifier was held). Use the actual ctrlKey flag from the
  // event when available.
  if (ev.key === "Control" || !ev.ctrlKey) {
    if (ctrlPressedRef.current) {
      ctrlPressedRef.current = false;
      setBodyAttr(false);
    }
  }
}

function onBlur() {
  // Window lost focus — we can't observe the keyup, so assume Ctrl
  // released. Without this, alt-tabbing while holding Ctrl strands
  // the editor in armed state.
  if (ctrlPressedRef.current) {
    ctrlPressedRef.current = false;
    setBodyAttr(false);
  }
}

/**
 * Mount the global Ctrl-key listeners. Refcount-guarded so multiple
 * DockShell instances on the same page (rare, but possible during
 * route transitions) don't double-bind.
 */
export function useCtrlDragHostListeners(): void {
  React.useEffect(() => {
    if (listenerRefcount === 0) {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("blur", onBlur);
    }
    listenerRefcount += 1;
    return () => {
      listenerRefcount -= 1;
      if (listenerRefcount <= 0) {
        listenerRefcount = 0;
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("blur", onBlur);
        // Make sure the visual cue clears too if the last shell
        // unmounts mid-press.
        ctrlPressedRef.current = false;
        setBodyAttr(false);
      }
    };
  }, []);
}

/** Synchronous read for pointer handlers. */
export function getCtrlPressed(): boolean {
  return ctrlPressedRef.current;
}

/**
 * Hit-test the document at `(x, y)` and return the dockview group
 * element underneath, or null when the point is outside the docked
 * grid (e.g. over a floating group, popout, or outside the editor
 * entirely).
 *
 * Caller responsibility: match the returned `HTMLElement` against
 * `api.groups` by walking `group.element === element` (or
 * `.contains(...)` fallback) to recover the live DockviewGroupPanel
 * — dockview does not stamp a data-attribute on the container.
 */
export function findDockGroupElementAt(
  x: number,
  y: number,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  // Reject floating + popout groups. `.dv-groupview-floating` is the
  // class dockview toggles on a group container when its location is
  // 'floating'; `.dv-groupview-popout` likewise for 'popout'. Both
  // are also matched by `.dv-groupview`, so we filter first.
  if ((hit as Element).closest(".dv-groupview-floating")) return null;
  if ((hit as Element).closest(".dv-groupview-popout")) return null;
  const groupEl = (hit as Element).closest<HTMLElement>(".dv-groupview");
  if (!groupEl) return null;
  return groupEl;
}
