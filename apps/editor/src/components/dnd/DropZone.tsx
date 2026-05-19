import React from "react";
import { cn } from "../../lib/cn";
import { useDragStore } from "../../state/useDragStore";
import {
  MIME,
  readDataTransfer,
  type DndPayload,
  type SemanticAssetKind,
} from "../../state/dnd/payload";

/**
 * Reactive view of the zone's current interaction. Exposed to the
 * render-prop variant so callers (slot inputs, cell grids) can paint
 * their own affordances on top of the primitive's filtering + handler
 * machinery.
 */
export interface DropZoneState {
  /** Any in-flight drag matches `accepts`. */
  isDraggingCompatible: boolean;
  /** Any in-flight drag does NOT match `accepts`. */
  isDraggingIncompatible: boolean;
  /** The cursor is currently over THIS zone (after the child-containment guard). */
  isOver: boolean;
}

/**
 * Generic drop-target primitive for the cross-window DnD subsystem.
 *
 * Owns native HTML5 DnD wiring + visual feedback so panels only have to
 * declare what kinds they accept and what to do with the payload. See
 * `docs/plans/CROSS_WINDOW_DND.md` §3.3 for the contract.
 *
 * Key invariants:
 * - `accepts` is the single source of truth for filtering. MIMEs are
 *   derived; callers never name MIME strings directly.
 * - `<DropZone>` never reads or writes IDB. The drop handler is the
 *   only place that calls into asset stores.
 * - Children may be either a `ReactNode` (the primitive draws a subtle
 *   ring during valid hover) or a render-prop receiving `DropZoneState`
 *   (caller paints itself; the primitive contributes nothing visual).
 *
 * @example
 * ```tsx
 * <DropZone accepts={["script"]} onDrop={(p) => attachScript(entityId, p.id)}>
 *   <button>Drop script here…</button>
 * </DropZone>
 * ```
 */
export interface DropZoneProps<K extends SemanticAssetKind> {
  /** The semantic kinds this zone accepts. Order matters for tie-breaking. */
  accepts: readonly K[];
  /**
   * Called with the validated payload when a compatible drop lands.
   * The payload's `kind` is narrowed to one of `accepts`.
   */
  onDrop: (payload: DndPayload<K>) => void | Promise<void>;
  /** Applied to the inner content wrapper. */
  className?: string;
  /** Applied to the outer dnd root (where ring + state classes land). */
  wrapperClassName?: string;
  /**
   * When `true`, the zone skips `preventDefault` on `dragover` so the
   * browser shows the natural "not allowed" cursor, and does not
   * subscribe to drag state (no renders during foreign drags).
   */
  disabled?: boolean;
  /**
   * Either static children (default visual: subtle ring overlay during
   * valid hover) or a render-prop for callers that want to paint
   * themselves (slot inputs, cell grids).
   */
  children: React.ReactNode | ((state: DropZoneState) => React.ReactNode);
}

/**
 * Render-prop type guard. Function children get called with state;
 * everything else renders verbatim.
 */
function isRenderProp<K extends SemanticAssetKind>(
  children: DropZoneProps<K>["children"],
): children is (state: DropZoneState) => React.ReactNode {
  return typeof children === "function";
}

/**
 * Inner component that does subscribe to `useDragStore`. We isolate the
 * subscription here so the `disabled` branch can render a static
 * wrapper without paying the subscription cost.
 */
function DropZoneActive<K extends SemanticAssetKind>(
  props: DropZoneProps<K>,
): React.JSX.Element {
  const { accepts, onDrop, className, wrapperClassName, children } = props;

  const currentDrag = useDragStore((s) => s.currentDrag);

  // Child-containment guard: dragenter/dragleave fire as the cursor
  // crosses descendant boundaries inside the zone. A naive boolean flips
  // off as soon as the cursor enters a child. A counter incremented on
  // every enter and decremented on every leave stays positive for the
  // whole time the cursor is inside the subtree.
  const enterCountRef = React.useRef(0);
  const [isOver, setIsOver] = React.useState(false);

  const acceptsSet = React.useMemo(
    () => new Set<SemanticAssetKind>(accepts),
    [accepts],
  );

  const isDraggingCompatible =
    currentDrag != null && acceptsSet.has(currentDrag.kind);
  const isDraggingIncompatible =
    currentDrag != null && !acceptsSet.has(currentDrag.kind);

  const acceptedMimes = React.useMemo<readonly string[]>(
    () => accepts.map((k) => MIME[k]),
    [accepts],
  );

  const dataTransferHasAcceptedMime = React.useCallback(
    (dt: DataTransfer | null): boolean => {
      if (!dt) return false;
      const types = dt.types;
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        if (t !== undefined && acceptedMimes.includes(t)) return true;
      }
      return false;
    },
    [acceptedMimes],
  );

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only preventDefault when a MIME we accept is on the wire — that
      // is what gates whether `drop` will fire. Skipping preventDefault
      // for foreign drags lets the browser paint the "not allowed"
      // cursor naturally.
      if (!dataTransferHasAcceptedMime(e.dataTransfer)) return;
      e.preventDefault();
      // `link` matches `writeDataTransfer`'s `effectAllowed = "link"` —
      // cardboard drags are always references, never moves/copies.
      e.dataTransfer.dropEffect = "link";
    },
    [dataTransferHasAcceptedMime],
  );

  const onDragEnter = React.useCallback(
    (_e: React.DragEvent<HTMLDivElement>) => {
      enterCountRef.current += 1;
      if (enterCountRef.current === 1) setIsOver(true);
    },
    [],
  );

  const onDragLeave = React.useCallback(
    (_e: React.DragEvent<HTMLDivElement>) => {
      enterCountRef.current = Math.max(0, enterCountRef.current - 1);
      if (enterCountRef.current === 0) setIsOver(false);
    },
    [],
  );

  const onDropHandler = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      enterCountRef.current = 0;
      setIsOver(false);

      let payload = readDataTransfer(e.dataTransfer, accepts);
      if (!payload) {
        // Paranoid fallback: between `dragover` (which captured types)
        // and `drop` (which exposes data), a misbehaving source could
        // race and the body isn't on the DataTransfer. Fall back to
        // the synced store and re-validate kind against `accepts`.
        const live = useDragStore.getState().currentDrag;
        if (live && acceptsSet.has(live.kind)) {
          payload = live;
        }
      }
      if (!payload) return;
      // Narrow: we just validated `payload.kind` is one of `accepts`.
      void onDrop(payload as DndPayload<K>);
    },
    [accepts, acceptsSet, onDrop],
  );

  const state: DropZoneState = {
    isDraggingCompatible,
    isDraggingIncompatible,
    isOver,
  };

  // Visual state precedence: invalid-hover > drop-active > valid-hover > idle.
  // Only applied when children is NOT a render prop — render-prop callers
  // own their visuals entirely.
  const renderProp = isRenderProp(children);
  const stateRing = renderProp
    ? undefined
    : isDraggingIncompatible && isOver
      ? "ring-2 ring-red-500/50 cursor-not-allowed"
      : isDraggingCompatible && isOver
        ? "ring-2 ring-amber-500 bg-amber-500/10"
        : isDraggingCompatible
          ? "ring-1 ring-amber-500/40"
          : undefined;

  return (
    <div
      data-drop-zone={accepts.join(" ")}
      data-drop-over={isOver ? "true" : undefined}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDropHandler}
      className={cn("transition-shadow rounded-sm", stateRing, wrapperClassName)}
    >
      <div className={className}>
        {renderProp ? children(state) : children}
      </div>
    </div>
  );
}

/**
 * Disabled-branch shell. No store subscription, no handlers — the
 * browser handles the foreign drag with its native "not allowed"
 * cursor. Render-prop children still get called with a zeroed state
 * so they can lay out consistently.
 */
function DropZoneDisabled<K extends SemanticAssetKind>(
  props: DropZoneProps<K>,
): React.JSX.Element {
  const { accepts, className, wrapperClassName, children } = props;
  const state: DropZoneState = {
    isDraggingCompatible: false,
    isDraggingIncompatible: false,
    isOver: false,
  };
  return (
    <div
      data-drop-zone={accepts.join(" ")}
      data-drop-zone-disabled="true"
      className={cn("rounded-sm", wrapperClassName)}
    >
      <div className={className}>
        {isRenderProp(children) ? children(state) : children}
      </div>
    </div>
  );
}

/**
 * `<DropZone>` — generic drop-target primitive. See the JSDoc on
 * `DropZoneProps` for the contract and the @example.
 */
export function DropZone<K extends SemanticAssetKind>(
  props: DropZoneProps<K>,
): React.JSX.Element {
  if (props.disabled) return <DropZoneDisabled {...props} />;
  return <DropZoneActive {...props} />;
}

export default DropZone;
