import {
  bootFromChain,
  Game,
  IdbAssetPack,
  type GameState,
} from "@two_5_d/engine";
import { installEditorBridge } from "./editor-bridge";

/**
 * Editor-source boot path — I1 of `docs/plans/EDITOR_IFRAME.md` §4.
 *
 * Constructs an `IdbAssetPack` against the editor's IDB schema and
 * hands it to `bootFromChain`, which runs the standard config /
 * scene / Game / pack-scripts pipeline. Once the engine is up,
 * installs the postMessage bridge so the parent editor can drive
 * scene swaps + pause/resume.
 *
 * The standard zip-pack path in `index.ts` stays untouched — this
 * function is only invoked when `?source=editor` is in the URL.
 */
export async function bootForEditor(
  projectId: string,
  sceneOverride: string | null,
  previous?: Partial<GameState>,
): Promise<Game> {
  const pack = await IdbAssetPack.fromProject(projectId);
  const game = await bootFromChain([pack], previous, sceneOverride ?? undefined);

  // The bridge resolves the active scene from `sceneOverride` if
  // present, else from the manifest's `startScene` — same fallback
  // the engine's boot logic uses.
  const startScene =
    sceneOverride && sceneOverride.length > 0
      ? sceneOverride
      : pack.manifest.startScene ?? "";
  installEditorBridge(game, projectId, pack, startScene);

  return game;
}
