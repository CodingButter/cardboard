/**
 * core-editor-pack P1 spike — React externalization canary.
 *
 * Validates that pack-shipped TSX components share React with the host
 * editor. If the pack-builder's externalization is broken, this script
 * will see a second React instance and `React.useState` will throw
 * "Invalid hook call" the moment the component mounts. If
 * externalization works, the component renders, the hook fires, the
 * button increments the counter on click.
 *
 * The component mounts into a detached `<div>` appended to
 * `document.body` (NOT into the editor's React tree — we want to prove
 * the React module identity matches without mutating editor UI). On
 * successful mount the script logs `core-editor-pack: spike OK
 * (useState=<n>)`. On any error it logs the error.
 *
 * Returning a cleanup unmounts + removes the detached div so a future
 * Extensions-tab live-disable can rip the spike out without a reload.
 *
 * After P1, this script is replaced by real `setup.ts` /
 * `scene-workspace.ts` / `views.ts` per `CORE_EDITOR_PACK.md` §5.
 */

// Type-only — Bun's bundler erases this. The runtime `ctx` is supplied
// by `runEditorPackScript` in `apps/editor/src/packs/editorPackLoader.ts`.
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

import React, { useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Trivial functional component that exercises a hook. If React is
 * shared with the host, this mounts cleanly and the hook works. If the
 * pack-builder failed to externalize React (i.e. the pack bundle ships
 * its own copy), React's hook dispatcher will be unset for this
 * component's render and `useState` throws.
 */
function SpikeCounter(): React.ReactElement {
  const [count, setCount] = useState(0);
  return React.createElement(
    "div",
    {
      style: {
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        background: "#08090b",
        color: "#9aa0a6",
        font: "11px/1.4 ui-monospace, monospace",
        padding: "6px 10px",
        border: "1px solid #2a2d33",
        borderRadius: 6,
        opacity: 0.85,
      },
      "data-testid": "core-editor-pack-spike",
    },
    React.createElement(
      "div",
      { style: { marginBottom: 4 } },
      "core-editor-pack spike — React shared OK",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setCount((c) => c + 1),
        style: {
          font: "11px ui-monospace, monospace",
          padding: "2px 8px",
          background: "#161a1f",
          color: "#e3e5e8",
          border: "1px solid #2a2d33",
          borderRadius: 4,
          cursor: "pointer",
        },
      },
      `useState count = ${count} (click)`,
    ),
  );
}

export default function setup(ctx: EditorPackContext): () => void {
  // Suppress unused-ctx warning — P1 doesn't touch the context; later
  // phases register tabs / panels / views through it.
  void ctx;

  const host = document.createElement("div");
  host.id = "core-editor-pack-spike-host";
  document.body.appendChild(host);

  let root: ReturnType<typeof createRoot> | null = null;
  try {
    root = createRoot(host);
    root.render(React.createElement(SpikeCounter));
    // If we reach this log without React throwing, the hook ran inside
    // a render scope which means React's internal `ReactCurrentDispatcher`
    // was populated — i.e. the pack and host share one React.
    console.log(
      "[core-editor-pack] spike OK — React shared with host, useState hook works",
    );
  } catch (err) {
    console.error("[core-editor-pack] spike FAILED — React externalization broken:", err);
  }

  return () => {
    try {
      root?.unmount();
    } catch (err) {
      console.warn("[core-editor-pack] spike cleanup: unmount threw:", err);
    }
    host.remove();
  };
}
