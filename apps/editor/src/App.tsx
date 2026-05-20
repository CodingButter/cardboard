import React from "react";
import { EditorShell } from "./shell/EditorShell";
import {
  RendererDemoRoute,
  isRendererDemoActive,
} from "./panel-renderer/DemoRoute";

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
 * The `?renderer-demo` query param short-circuits the shell and
 * mounts the JSON-panel-renderer Phase 0 demo route. This stays out
 * of the production path — it's only loaded when the URL opts in.
 */
export function App() {
  if (isRendererDemoActive()) {
    return <RendererDemoRoute />;
  }
  return <EditorShell />;
}
