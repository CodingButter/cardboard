/**
 * Shell-level event + type definitions exposed via the editor shell SDK.
 *
 * These constants and types describe cross-view navigation contracts
 * that BOTH the shell and pack-shipped views need to share by identity.
 * Bundling a duplicate inside a pack would fork the string constant
 * (event listeners on `cardboard:set-tab` wouldn't fire if the
 * dispatcher used a different copy) — they MUST resolve to the same
 * runtime value the shell registers its listener against.
 *
 * Pack authors import these from `@cardboard/editor-shell`:
 *
 *   ```ts
 *   import { SET_TAB_EVENT, type SetTabEventDetail } from "@cardboard/editor-shell";
 *   window.dispatchEvent(new CustomEvent<SetTabEventDetail>(SET_TAB_EVENT, {
 *     detail: { tab: "assets", assetId: "scenes/level-1.json" },
 *   }));
 *   ```
 *
 * Promoted out of `apps/editor/src/views/AssetsView.tsx` + ProjectView.tsx
 * during the P5b shell-view migration — those files moved into the
 * core-editor-pack, but the constants belong in the SHELL so any pack
 * (core or third-party) can dispatch tab-switch intents.
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
