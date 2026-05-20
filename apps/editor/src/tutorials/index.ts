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
import homeIntro from "./home-intro.tutorial.json" with { type: "json" };
import prefabsIntro from "./prefabs-intro.tutorial.json" with { type: "json" };
import extensionsIntro from "./extensions-intro.tutorial.json" with {
  type: "json",
};
import panelBuilderIntro from "./panel-builder-intro.tutorial.json" with {
  type: "json",
};

/**
 * Built-in tutorials shipped with the editor. T1 shipped `intro-scene`;
 * T5 adds the next batch — `home-intro`, `prefabs-intro`,
 * `extensions-intro`, and `panel-builder-intro` — covering the
 * EmptyState `tutorial="…"` slugs already referenced by HomeScreen
 * and the Prefabs / Extensions / Panel Builder surfaces. T4 will fill
 * out the remaining §6 catalogue (Animation, Scripts, Image / Sound
 * Lab, UI Builder, Project).
 */
export const BUILTIN_TUTORIALS: readonly TutorialDef[] = [
  introScene as TutorialDef,
  homeIntro as TutorialDef,
  prefabsIntro as TutorialDef,
  extensionsIntro as TutorialDef,
  panelBuilderIntro as TutorialDef,
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
