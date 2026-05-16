/**
 * DOM-free helpers that drive the EntitiesEditor's Sprite ↔ Animation
 * auto-wire prompt (and the smoke test that asserts on it).
 *
 * The wiring is pure UX: when the user adds a `Sprite` component
 * pointing at a sheet-based sprite (one with `manifest.sprites[imageId]
 * .animations`), the editor suggests adding an `Animation` component
 * pre-filled with the sprite's first animation name. Splitting the
 * logic out of the React component means the smoke test can exercise
 * the same code path without mounting a DOM.
 *
 * See `docs/plans/ANIMATIONS.md` §6 (Animation component shape) and
 * `apps/editor/src/views/EntitiesEditor.tsx` for the UI integration.
 */

import type { DeclarativePrefab } from "@two_5_d/engine";
import type { SpriteDef } from "@two_5_d/engine/AssetPack";

/**
 * Output of the wiring analysis. The editor renders inline UI driven
 * by these flags; the smoke test asserts on them directly.
 */
export interface AnimationWiringState {
  /** Resolved sprite imageId on the prefab's Sprite component (empty if none). */
  spriteImageId: string;
  /** Animation names declared on the resolved sprite, sorted to keep tests deterministic. */
  spriteAnimationNames: ReadonlyArray<string>;
  /**
   * True iff the prefab has a Sprite component pointing at a sheet-
   * based sprite (animations declared) AND no Animation component yet.
   * Drives the "+ Add Animation component" prompt.
   */
  suggestAnimation: boolean;
  /**
   * True iff there's an Animation component whose `current` field
   * isn't valid for the chosen sprite (either the sprite has no
   * animations or `current` isn't in the list). Drives the inline
   * warning rendered above the Animation subform.
   */
  animationMismatch: boolean;
  /** `current` field value from the Animation component (empty if absent). */
  animationCurrent: string;
}

/**
 * Compute the wiring state for a prefab against the manifest's sprite
 * dict. Pure — same inputs always produce the same output; no IDB /
 * DOM access. Animation names are NOT sorted in the output so the
 * editor's "use the FIRST animation" heuristic stays predictable
 * (insertion order matches what shows up in the manifest).
 */
export function computeAnimationWiringState(
  prefab: DeclarativePrefab,
  spritesById: Readonly<Record<string, SpriteDef>>,
): AnimationWiringState {
  const sprite = prefab.components.Sprite as
    | { imageId?: string }
    | undefined;
  const spriteImageId =
    typeof sprite?.imageId === "string" ? sprite.imageId : "";
  const spriteDef = spriteImageId ? spritesById[spriteImageId] : undefined;
  const spriteAnimationNames: ReadonlyArray<string> = spriteDef?.animations
    ? Object.keys(spriteDef.animations)
    : [];
  const hasAnimationComponent = "Animation" in prefab.components;
  const suggestAnimation =
    !hasAnimationComponent && spriteAnimationNames.length > 0;
  const anim = prefab.components.Animation as
    | { current?: unknown }
    | undefined;
  const animationCurrent =
    typeof anim?.current === "string" ? anim.current : "";
  const animationMismatch =
    hasAnimationComponent &&
    (spriteAnimationNames.length === 0 ||
      (animationCurrent !== "" &&
        !spriteAnimationNames.includes(animationCurrent)));
  return {
    spriteImageId,
    spriteAnimationNames,
    suggestAnimation,
    animationMismatch,
    animationCurrent,
  };
}

/**
 * Produce the Animation component payload the editor adds when the
 * user clicks the "+ Add Animation component" suggestion. Keeps the
 * shape in lockstep with `docs/plans/ANIMATIONS.md` §6.1 (current /
 * frame / elapsed).
 *
 * Returns `null` when the sprite has no animations — the caller
 * should not invoke the wire-up flow in that state, but we encode
 * the precondition here for safety.
 */
export function buildAnimationComponentFromSuggestion(
  spriteAnimationNames: ReadonlyArray<string>,
): { current: string; frame: number; elapsed: number } | null {
  if (spriteAnimationNames.length === 0) return null;
  return {
    current: spriteAnimationNames[0]!,
    frame: 0,
    elapsed: 0,
  };
}
