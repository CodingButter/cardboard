/**
 * Shell-level event + type definitions for cross-view navigation.
 *
 * `SET_TAB_EVENT` is the string identity the shell's `EditorShell` mounts
 * its listener against. It's currently shell-internal — the
 * post-extraction audit (2026-05-20) confirmed zero pack-side callers,
 * and the matching SDK whitelist entry was removed. The constant lives
 * here (rather than at the EditorShell callsite) so the matching
 * `SetTabEventDetail` type can be re-exported through the SDK
 * surface for typing payloads; if a pack ever needs to dispatch the
 * event itself, the SDK can re-add `SET_TAB_EVENT` to the whitelist
 * without moving the source declaration.
 *
 * Promoted out of `apps/editor/src/views/AssetsView.tsx` + ProjectView.tsx
 * during the P5b shell-view migration — those files moved into the
 * core-editor-pack, but the constants belong in the SHELL so any pack
 * (core or third-party) could dispatch tab-switch intents if needed.
 *
 * CORE_EDITOR_PACK.md §10 P5b.
 */

import type { PrimaryTabId } from "../shell/PrimaryTabs";

/**
 * Detail payload for the cross-view `cardboard:set-tab` event. Any view
 * may dispatch this event with a target tab id (and an optional
 * `assetId` the destination view can use to auto-open the target).
 * The shell's listener flips the active tab on receipt.
 */
export interface SetTabEventDetail {
  tab: PrimaryTabId;
  assetId?: string;
}

/** Custom-event name. Pack code MUST use this constant (not the raw
 *  string) so a future rename propagates through the SDK in one place. */
export const SET_TAB_EVENT = "cardboard:set-tab";

/**
 * Workflow-mode union — the legacy `ProjectView` body-mode discriminator.
 * Kept as an exported type so the migrated ProjectView (now inside the
 * core-editor-pack) can type its props without re-declaring the union
 * locally. Pack code reads this via `@cardboard/editor-shell`.
 *
 * The set mirrors what the pre-P5 shell narrowed when threading the
 * active tab into ProjectView. New tab ids that need a ProjectView
 * body mode get added here.
 */
export type WorkflowMode =
  | "scene"
  | "prefabs"
  | "scripts"
  | "assets"
  | "animation";
