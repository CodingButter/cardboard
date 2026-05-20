/**
 * cardboard-editor-pack-demo — pack-bundled editor setup script.
 *
 * Phase 2a of editor-pack-bundled scripts (task #30). This file is the
 * dogfooding proof: the editor app no longer registers
 * `demo.selection.clear` on the pack's behalf — the pack ships its
 * own JS, the editor loader executes it, and the `registerCommand`
 * API exposed to the script is the EXACT same one the editor uses
 * itself. Same trust model as a VS Code extension.
 *
 * The script's only job today is to wire the `demo.selection.clear`
 * command so the pack's `selection-info` panel's "Clear selection"
 * button works. When the pack's `manifest.scripts[]` lists this file
 * the editor will:
 *
 *   1. Fetch the .apg, decode, register every `manifest.editorPanels[]`.
 *   2. Walk `manifest.scripts[]` and, for each entry, read the source
 *      via `pack.textBody(path)`, wrap it in a Blob URL, and
 *      dynamic-import the module as ESM.
 *   3. Invoke this file's default export with an `EditorPackContext`
 *      whose `registerCommand` is the editor's own
 *      `useCommandStore.register` re-export and whose `stores` map
 *      exposes the editor's shell-level Zustand stores by name.
 *
 * Returning a cleanup function lets a future Extensions-tab disable
 * hook unwind the registration without a page reload (deferred to
 * Phase 2b).
 */

// The editor publishes this type from `apps/editor/src/packs/editorPackLoader.ts`.
// Type-only import — Bun's bundler erases it during pack-build, so the
// emitted JS has no editor-side dependency. The relative path works at
// authoring time because the workspace lives under the same monorepo
// root as the editor app.
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

/**
 * Default export — the pack-loader calls this with the shared editor
 * context once per pack load. Registers every command the pack's
 * declarative panels reference by id and returns a cleanup hook so a
 * future "disable pack" action can unwind them.
 */
export default function setup(ctx: EditorPackContext): () => void {
  // Register the panel's `onClick: { script: "demo.selection.clear" }`
  // command. The pack's `selection-info.json` panel references this
  // id; before Phase 2a it was registered by the editor app's
  // MapView.tsx, which is the dogfooding leak this pack closes.
  const disposeClear = ctx.registerCommand({
    id: "demo.selection.clear",
    title: "Demo: Clear Selection",
    category: "View",
    run: () => {
      // Same call site MapView.tsx used pre-Phase-2a — clearing the
      // shell-level selection store. `ctx.stores.selection` is the
      // editor's own Zustand store hook, handed to the pack as-is.
      ctx.stores.selection.getState().select(null);
    },
  });

  return () => {
    disposeClear();
  };
}
