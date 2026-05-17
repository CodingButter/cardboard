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
 */
export function App() {
  return <EditorShell />;
}
