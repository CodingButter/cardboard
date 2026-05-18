/**
 * Cross-cutting shared module for `@two_5_d/*` packages.
 *
 * Today this is the home of the pack-component `.d.ts` generator
 * (consumed by `apps/pack-builder` and, in a later wave,
 * `apps/editor` for Monaco's `addExtraLib`). Future additions:
 * vector + net-message types per MULTIPLAYER_PLAN.md M1.
 */

export {
  generatePackTypes,
  type GeneratePackTypesOpts,
} from "./generatePackTypes";
