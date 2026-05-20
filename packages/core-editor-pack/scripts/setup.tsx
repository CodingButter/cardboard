/**
 * core-editor-pack — P2 + P3 batch A setup script.
 *
 * P2 migrated `NotesPanel` out of the editor shell into this pack via
 * the `ctx.registerPanel(...)` API on `EditorPackContext`. P3 batch A
 * extends the same pattern to four more leaf panels:
 *
 *   - `OutputPanel`     (Diagnostics — bottom strip log surface)
 *   - `ProblemsPanel`   (Diagnostics — warn/error subset)
 *   - `HistoryPanel`    (Diagnostics — undo/redo stack visualisation)
 *   - `LightingPanel`   (Scene — opt-in light list)
 *
 * Surface flags (`surface`, `headerless`) preserve the registration
 * semantics MapView previously used in its static `PANELS` array.
 *
 * Why a `.tsx` setup script: the panels are TSX components imported
 * here as JSX expressions. The pack-builder's TSX compile step
 * (`apps/pack-builder/src/build-pack-script.ts`) handles `.tsx`
 * entries identically to `.ts`, with React + ReactDOM externalised so
 * the pack-shipped panels share one React instance with the host.
 *
 * Returns a cleanup that fires every per-contribution unregister so
 * a future Extensions-tab live-disable can drop the pack's panels
 * out of the DocksModal without a reload. See
 * `docs/plans/CORE_EDITOR_PACK.md` §10 P2 / P3 batch A.
 */

// Type-only — Bun erases this. Runtime `ctx` is constructed by the
// editor's pack loader (`apps/editor/src/packs/editorPackLoader.ts`).
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

import { NotesPanel, MANIFEST as NOTES_MANIFEST } from "../panels/NotesPanel";
import { OutputPanel, MANIFEST as OUTPUT_MANIFEST } from "../panels/OutputPanel";
import { ProblemsPanel, MANIFEST as PROBLEMS_MANIFEST } from "../panels/ProblemsPanel";
import { HistoryPanel, MANIFEST as HISTORY_MANIFEST } from "../panels/HistoryPanel";
import { LightingPanel, MANIFEST as LIGHTING_MANIFEST } from "../panels/LightingPanel";

export default function setup(ctx: EditorPackContext): () => void {
  // Compose each panel def the same way MapView's old static `PANELS`
  // array did — spread the MANIFEST (id/title/category/icon) and
  // attach the component plus any surface/headerless flags. The
  // shell-side `DockPanelDef` shape accepts both halves verbatim;
  // nothing about a pack-shipped TSX panel differs from a hand-written
  // one from the dock's POV.
  const disposers: Array<() => void> = [
    // P2 — NotesPanel.
    ctx.registerPanel({
      ...NOTES_MANIFEST,
      component: NotesPanel,
    }),
    // P3 batch A — Output + Problems were registered in MapView with
    // `surface: false` so the log/diagnostic body sits flush against
    // the dock area. Preserve that flag here.
    ctx.registerPanel({
      ...OUTPUT_MANIFEST,
      component: OutputPanel,
      surface: false,
    }),
    ctx.registerPanel({
      ...PROBLEMS_MANIFEST,
      component: ProblemsPanel,
      surface: false,
    }),
    // P3 batch A — History was a default-surface panel in MapView.
    ctx.registerPanel({
      ...HISTORY_MANIFEST,
      component: HistoryPanel,
    }),
    // P3 batch A — Lighting was a default-surface panel in MapView.
    ctx.registerPanel({
      ...LIGHTING_MANIFEST,
      component: LightingPanel,
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
