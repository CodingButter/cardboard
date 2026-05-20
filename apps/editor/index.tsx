import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./src/App";
import { assetUrl } from "./src/lib/assetUrl";
import { installReactRuntime } from "./src/packs/reactRuntime";
import { installShellSdkRuntime } from "./src/packs/shellSdkRuntime";
import { attachDevHmrClient } from "./src/packs/devHmrClient";
import { useToolStore } from "./src/state/useToolStore";
import { useBrushStore } from "./src/state/useBrushStore";
import { useTilePresetStore } from "./src/state/useTilePresetStore";
import { useLayerStore } from "./src/state/useLayerStore";
import { useSelectionStore } from "./src/state/useSelectionStore";
import { useSceneStore } from "./src/state/useSceneStore";
import { useHistoryStore } from "./src/state/useHistoryStore";
import { useDiagnosticsStore } from "./src/state/useDiagnosticsStore";
import { useDragStore } from "./src/state/useDragStore";

// Debug-only global exposure for the Wave 3 cross-panel stores. Keeps
// the playwright cross-tab verification self-contained without having
// to spelunk into Bun's hashed bundle. The cost is a single object on
// `window`; the store modules are loaded by the app anyway once any
// panel migration lands in Phase 3.3.
declare global {
  interface Window {
    __cardboard?: {
      stores: {
        tool: typeof useToolStore;
        brush: typeof useBrushStore;
        tilePreset: typeof useTilePresetStore;
        layer: typeof useLayerStore;
        selection: typeof useSelectionStore;
        scene: typeof useSceneStore;
        history: typeof useHistoryStore;
        diagnostics: typeof useDiagnosticsStore;
        drag: typeof useDragStore;
      };
    };
  }
}
// Expose React + ReactDOM on `globalThis` BEFORE any pack script can
// run. Pack-shipped TSX components compile against externalised
// `import React from "react"` specifiers that read from these slots
// at runtime (see `src/packs/reactRuntime.ts` + the pack-builder's
// `cardboard-react-externals` plugin). Without this, the first
// pack-shipped hook call throws "Invalid hook call".
installReactRuntime();
// Expose shell-side singletons (registerCommand, useActiveScene, etc.)
// the same way. Pack-shipped TSX panels that need a host-singleton hook
// import from `@cardboard/editor-shell`, which the pack-builder rewrites
// to a virtual module reading from `globalThis.__cardboard_editor_shell`.
installShellSdkRuntime();

// Dev-only pack HMR — subscribes to the editor server's
// `/__dev/pack-hmr` SSE channel and hot-swaps a pack whenever its
// workspace source files change. See `docs/plans/CORE_EDITOR_PACK.md`
// §11 risk #2 mitigation (c) for the rationale. Production builds
// never serve the SSE route, so the EventSource open simply 404s and
// the client logs a debug-level warning — no functional impact.
attachDevHmrClient();

if (typeof window !== "undefined") {
  window.__cardboard = {
    stores: {
      tool: useToolStore,
      brush: useBrushStore,
      tilePreset: useTilePresetStore,
      layer: useLayerStore,
      selection: useSelectionStore,
      scene: useSceneStore,
      history: useHistoryStore,
      diagnostics: useDiagnosticsStore,
      drag: useDragStore,
    },
  };

  // Bootstrap-clear any stale `currentDrag` left behind in LS by a
  // previous session that crashed mid-drag. `useDragStore` persists
  // its descriptor under `cardboard.sync.drag` so a window popped
  // DURING a drag rehydrates the live payload — the same persistence
  // means a hard crash can leave a non-null `currentDrag` lingering
  // across reloads. Clearing once at boot is the cleanup. See
  // `docs/plans/CROSS_WINDOW_DND.md` §3.2.
  useDragStore.getState().endDrag();
}

/**
 * Register the PWA service worker.
 *
 * Behaviour:
 *   - Dev (`bun --hot`):  SW registers; cache-first for known build
 *     artifacts (entry HTML, hashed JS/CSS chunks, manifest, icons).
 *     The SW explicitly carves out `/_bun`, `/__bun`, and any path
 *     containing `"hmr"` so live-reload traffic falls through to the
 *     network and HMR keeps working.
 *   - Prod (Pages build): same SW, no HMR paths to encounter.
 *
 * `assetUrl` prefixes the deploy base (`/cardboard/` on Pages), and
 * the SW scope is constrained to that same base so the SW can't reach
 * outside the editor's subpath. The SW file itself ships from
 * `public/sw.js`.
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  // Defer until after first paint so it doesn't compete with the
  // initial bundle fetches.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(assetUrl("/sw.js"), { scope: assetUrl("/") })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
