import React from "react";
import { EditorShell } from "./shell/EditorShell";

/**
 * App root — R3 introduced the global editor shell (TopBar +
 * PrimaryTabs + StatusBar). The shell owns route reconciliation
 * (hash → tab → view) and renders every per-tab view inside its
 * body region.
 *
 * Before R3, this file dispatched between HomeScreen and ProjectView
 * directly via `useRoute()`. That logic now lives in `EditorShell`,
 * so App is intentionally a one-liner mount point.
 *
 * The Phase 0 `?renderer-demo` short-circuit route was retired when
 * the JSON-panel renderer demo migrated into a real editor pack —
 * see `packages/cardboard-editor-pack-demo/` + the
 * `useEditorPackPanels` hook in `MapView.tsx`. The pack-loaded
 * "Editor Pack: Selection Info" panel supersedes the standalone
 * demo route.
 */
export function App(): React.JSX.Element {
  return <EditorShell />;
}
