/**
 * core-editor-pack — P2 setup script.
 *
 * Migrates the first hand-written panel out of the editor shell:
 * `NotesPanel`. Before P2 the panel lived at
 * `apps/editor/src/views/scene/panels/NotesPanel.tsx` and MapView's
 * static `PANELS` array imported it directly. After P2 the panel ships
 * inside this pack's `.apg`, the editor loader runs this script at
 * boot, and `ctx.registerPanel(...)` inserts the def into
 * `useDockPanelRegistryStore` — which `useEditorPackPanels()` reads.
 * The DocksModal sees the contribution under "Diagnostics" alongside
 * the JSON-shipped panels from `cardboard-editor-pack-demo`.
 *
 * Why a `.tsx` setup script: the panel is a TSX component imported
 * here as a JSX expression. The pack-builder's TSX compile step
 * (`apps/pack-builder/src/build-pack-script.ts`) handles `.tsx`
 * entries identically to `.ts`, with React + ReactDOM externalised
 * so the pack-shipped panel shares one React instance with the host.
 *
 * Returns a cleanup that fires every per-contribution unregister so
 * a future Extensions-tab live-disable can drop the pack's panels
 * out of the DocksModal without a reload. See
 * `docs/plans/CORE_EDITOR_PACK.md` §10 P2.
 */

// Type-only — Bun erases this. Runtime `ctx` is constructed by the
// editor's pack loader (`apps/editor/src/packs/editorPackLoader.ts`).
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

import { NotesPanel, MANIFEST as NOTES_MANIFEST } from "../panels/NotesPanel";

export default function setup(ctx: EditorPackContext): () => void {
  // Compose the panel def the same way MapView's old static `PANELS`
  // array did — spread the MANIFEST (id/title/category/icon) and
  // attach the component. The shell-side `DockPanelDef` shape
  // accepts both halves verbatim; nothing about a pack-shipped TSX
  // panel differs from a hand-written one from the dock's POV.
  const disposeNotes = ctx.registerPanel({
    ...NOTES_MANIFEST,
    component: NotesPanel,
  });

  return () => {
    disposeNotes();
  };
}
