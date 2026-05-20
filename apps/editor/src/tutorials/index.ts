/**
 * Tutorial system T1 — boot-time registry bootstrap.
 *
 * Imports the built-in `.tutorial.json` files and registers them
 * with the runtime registry. Called once from `apps/editor/index.tsx`
 * before the first render. Idempotent — re-registering a slug is
 * legal (the second call wins, matching the pack-chain semantics
 * planned for T5).
 */

import { registerTutorial } from "./runtime";
import type { TutorialDef } from "./types";
import introScene from "./intro-scene.tutorial.json" with { type: "json" };

/**
 * Built-in tutorials shipped with the editor. T1 ships one
 * (`intro-scene`); T3 / T4 fill out the rest of the §6 catalogue.
 */
export const BUILTIN_TUTORIALS: readonly TutorialDef[] = [
  introScene as TutorialDef,
];

let installed = false;

export function installBuiltinTutorials(): void {
  if (installed) return;
  installed = true;
  for (const def of BUILTIN_TUTORIALS) {
    registerTutorial(def);
  }
}

export {
  tutorialsApi,
  startTutorial,
  stopTutorial,
  skipTutorial,
  emitTutorialEvent,
  getRuntimeState,
  subscribe,
} from "./runtime";
export type {
  TutorialDef,
  TutorialStep,
  TutorialResult,
  RuntimeState,
} from "./types";
export { TutorialOverlayHost } from "./TutorialOverlay";
