/**
 * DemoRoute — Phase 0 visible-mount point for the JSON renderer.
 *
 * Activates when the URL contains `?renderer-demo`. Short-circuits the
 * normal editor shell so we render the demo spec directly with no
 * dockview / TopBar chrome in the way. This is intentionally kept out
 * of the production path — `App.tsx` checks the query param before
 * mounting `EditorShell`.
 *
 * Also registers the `demo.selection.clear` command the demo's button
 * dispatches. Per `feedback_command_registry_required.md` every
 * interactive action must register, and the demo's button is no
 * exception. We register here (not in some "core" place) because the
 * command is purely demo-scoped — Phase 0 deliverable, not part of
 * the long-lived core surface.
 */

import React from "react";
import { registerCommand } from "../state/useCommandStore";
import { useSelectionStore } from "../state/useSelectionStore";
import { PanelRenderer } from "./PanelRenderer";
import demoSpec from "./test-panels/demo-selection-info.json";
import type { PanelSpec } from "./types";

/** Check whether the renderer demo is active in the current URL. */
export function isRendererDemoActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("renderer-demo");
}

export function RendererDemoRoute(): React.JSX.Element {
  // Register the demo's clear-selection command. Mounted via useEffect
  // so we get auto-unregister on unmount (the demo route may be
  // navigated away from, even though Phase 0 doesn't have a back
  // button — keep the cleanup honest).
  React.useEffect(() => {
    return registerCommand({
      id: "demo.selection.clear",
      title: "Demo: Clear Selection",
      category: "View",
      run: () => {
        useSelectionStore.getState().select(null);
      },
    });
  }, []);

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-4 text-xs text-zinc-500 font-mono">
          /?renderer-demo — JSON Panel Renderer Phase 0
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/40">
          <PanelRenderer spec={demoSpec as PanelSpec} />
        </div>
      </div>
    </div>
  );
}
