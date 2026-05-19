/**
 * DnD components barrel — re-exports the cross-window DnD primitives.
 *
 * Today: just `<DropZone>`. As D6+ lands the in-flight ghost preview /
 * drag-source helpers, they belong here too. See
 * `docs/plans/CROSS_WINDOW_DND.md`.
 */

export {
  DropZone,
  type DropZoneProps,
  type DropZoneState,
} from "./DropZone";
