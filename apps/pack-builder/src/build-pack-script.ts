/**
 * Compile a pack `.ts` / `.tsx` script entrypoint into a single ESM
 * `.js` bundle suitable for the engine's pack-script loader.
 *
 * Why bundle at pack-build time:
 *   - The engine loads pack scripts via Blob URLs and `import()`. A
 *     blob: URL can't follow relative imports back to its source, so
 *     scripts with internal imports (e.g. `inventory-screen.tsx`
 *     pulling in `../ui/InventoryScreen.tsx`) need to ship as a
 *     pre-bundled single file.
 *   - JSX + TypeScript syntax has to be lowered to plain JS before it
 *     hits the browser. Bun's bundler handles both via the file
 *     extension.
 *
 * Preact externalisation (game-side packs):
 *   - Pack code authoring uses `import { h } from "preact"` etc. The
 *     engine ships its own Preact instance; pack components need to
 *     share it (otherwise hooks dispatch and DOM reconciliation
 *     desync). We do that with two plugins:
 *
 *     1. **resolve plugin** — intercepts `preact`, `preact/hooks`,
 *        and `preact/jsx-runtime` specifiers and routes them into a
 *        synthetic namespace.
 *     2. **load plugin** — returns a tiny module body for each that
 *        re-exports from a `globalThis.__two5d_preact*` slot. The
 *        engine populates those slots at boot via
 *        `installPreactRuntime()` in `packages/engine/src/PreactRuntime.ts`.
 *
 * React externalisation (editor-side packs) — CORE_EDITOR_PACK.md §11:
 *   - The editor uses React, not Preact. Editor packs (the core
 *     editor pack + any third-party editor pack that ships TSX) author
 *     against `import React from "react"` like any normal React
 *     codebase. The same identity hazard applies: two React instances
 *     in one tree means hooks dispatch breaks the moment a pack
 *     component mounts inside the editor's reconciler.
 *   - Same two-plugin shape as Preact. The editor's bootstrap
 *     (`apps/editor/index.tsx`) calls `installReactRuntime()` from
 *     `apps/editor/src/packs/reactRuntime.ts` which populates the
 *     `__cardboard_react*` global slots with the editor's own React +
 *     ReactDOM + ReactDOM/client modules. The stub modules emitted
 *     here read from those slots at runtime.
 *   - We externalise BOTH preact and react in every pack build. A
 *     pack that imports neither pays nothing (the resolver plugins
 *     never fire). A pack that imports both (unlikely but possible)
 *     gets each module routed to the right runtime.
 *
 * Type-only `@two_5_d/engine` imports the script uses for ambient
 * typing get tree-shaken by Bun automatically (TypeScript erases them
 * before the bundler ever sees runtime references).
 */

import { basename } from "node:path";

const PREACT_NS = "two5d-preact";
const REACT_NS = "cardboard-react";
const SHELL_SDK_NS = "cardboard-editor-shell";

/**
 * The shell-SDK virtual module bare specifier. Pack scripts that need
 * to call host-side singletons (e.g. `registerCommand`, `useActiveScene`)
 * import from this specifier; the resolver below maps it to a stub
 * that reads from `globalThis.__cardboard_editor_shell`.
 */
const SHELL_SDK_SPECIFIER = "@cardboard/editor-shell";

/**
 * The four Preact specifiers we externalise → matching global slot.
 * `jsx-dev-runtime` points at the same module as `jsx-runtime` from
 * the pack's POV — Bun emits the dev runtime in non-prod builds and
 * the engine populates both slots with the same Preact namespace.
 */
const PREACT_SPECIFIERS: Record<string, string> = {
  preact: "__two5d_preact",
  "preact/hooks": "__two5d_preact_hooks",
  "preact/jsx-runtime": "__two5d_preact_jsx_runtime",
  "preact/jsx-dev-runtime": "__two5d_preact_jsx_runtime",
};

/**
 * React + ReactDOM specifiers externalised for editor-pack scripts →
 * matching global slot populated by the editor bootstrap. Same
 * pattern as the Preact map above; bumping these requires a
 * coordinated change in `apps/editor/src/packs/reactRuntime.ts`.
 *
 * `react/jsx-dev-runtime` aliases to the prod runtime slot — Bun
 * emits the dev runtime when bundling for browsers in dev mode but
 * the runtime exports are a superset of the prod runtime; mapping
 * both to the same slot is safe.
 */
const REACT_SPECIFIERS: Record<string, string> = {
  react: "__cardboard_react",
  "react/jsx-runtime": "__cardboard_react_jsx_runtime",
  "react/jsx-dev-runtime": "__cardboard_react_jsx_runtime",
  "react-dom": "__cardboard_react_dom",
  "react-dom/client": "__cardboard_react_dom_client",
};

/**
 * Compile a single pack script. Returns the bundled ESM source as a
 * string for the caller to stuff into the .apg under the rewritten
 * path. `packRoot` is the absolute path to the pack root (so the
 * builder can resolve workspace `@two_5_d/engine` types if needed).
 */
export async function buildPackScript(absSourcePath: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [absSourcePath],
    target: "browser",
    format: "esm",
    // The engine handles tree-shaking of its consumer code; we don't
    // minify pack scripts to keep them readable in DevTools.
    minify: false,
    sourcemap: "none",
    // The pack-script loader uses `import(blobUrl)` which can't fan
    // out to other modules — produce one self-contained chunk.
    splitting: false,
    // Pack scripts run in a browser context. They never see Node-only
    // APIs; the loader hands them `globalThis`.
    plugins: [
      {
        name: "two5d-preact-externals",
        setup(build) {
          // Route bare `preact*` imports through our virtual namespace
          // so the load hook below owns them. Without onResolve, Bun
          // would fail with "module not resolvable" since pack scripts
          // don't have a node_modules/preact reachable from `packRoot`.
          build.onResolve(
            { filter: /^preact(\/(hooks|jsx-runtime|jsx-dev-runtime))?$/ },
            (args) => ({
              path: args.path,
              namespace: PREACT_NS,
            }),
          );
          // Emit a stub module that reads from the engine-populated
          // global slot. Using `export *` from a module-level object
          // doesn't work in ESM, so we enumerate the common exports
          // each Preact entry point publishes. Anything not in the
          // list won't be available — but every API the pack-side
          // screens use today is covered.
          build.onLoad({ filter: /.*/, namespace: PREACT_NS }, (args) => {
            const globalSlot = PREACT_SPECIFIERS[args.path];
            if (!globalSlot) {
              throw new Error(`unexpected preact specifier: ${args.path}`);
            }
            // Re-export the full namespace from the global. The named
            // re-export form preserves tree-shake-friendly access
            // patterns and works for both `import h from "preact"` and
            // `import { h } from "preact"` (the bundler emits whatever
            // the source asked for).
            return {
              loader: "js",
              contents: `
                const __mod = globalThis.${globalSlot};
                if (!__mod) {
                  throw new Error(
                    "two_5_d: ${args.path} not available — engine must call installPreactRuntime() before pack scripts run"
                  );
                }
                export default __mod.default ?? __mod;
                export const h = __mod.h;
                export const render = __mod.render;
                export const Component = __mod.Component;
                export const Fragment = __mod.Fragment;
                export const cloneElement = __mod.cloneElement;
                export const createContext = __mod.createContext;
                export const createRef = __mod.createRef;
                export const isValidElement = __mod.isValidElement;
                export const hydrate = __mod.hydrate;
                export const toChildArray = __mod.toChildArray;
                // Hooks
                export const useState = __mod.useState;
                export const useEffect = __mod.useEffect;
                export const useLayoutEffect = __mod.useLayoutEffect;
                export const useRef = __mod.useRef;
                export const useMemo = __mod.useMemo;
                export const useCallback = __mod.useCallback;
                export const useContext = __mod.useContext;
                export const useReducer = __mod.useReducer;
                export const useImperativeHandle = __mod.useImperativeHandle;
                export const useId = __mod.useId;
                export const useDebugValue = __mod.useDebugValue;
                export const useErrorBoundary = __mod.useErrorBoundary;
                // jsx-runtime
                export const jsx = __mod.jsx;
                export const jsxs = __mod.jsxs;
                export const jsxDEV = __mod.jsxDEV;
              `,
            };
          });
        },
      },
      {
        name: "cardboard-react-externals",
        setup(build) {
          // Route bare `react` / `react-dom` / `react-dom/client` /
          // `react/jsx-runtime` imports through our virtual namespace
          // so the load hook below owns them. Pack scripts don't have
          // a node_modules/react reachable from packRoot (no devDep
          // declared); without onResolve Bun would error out. CORE_
          // EDITOR_PACK.md §11 "Risk: pack-builder must externalize
          // React".
          build.onResolve(
            { filter: /^react(-dom(\/client)?|\/jsx-runtime|\/jsx-dev-runtime)?$/ },
            (args) => ({
              path: args.path,
              namespace: REACT_NS,
            }),
          );
          // Emit a stub module that reads from the editor-populated
          // global slot. Mirrors the Preact stub shape — enumerate
          // the named exports we know pack code touches, plus a
          // default re-export so `import React from "react"` works.
          // Anything not in the enumerated list isn't reachable from
          // the pack; if a future pack needs e.g. `useTransition` we
          // add a single line here and the editor's reactRuntime.ts
          // is unchanged (it already publishes the whole React
          // namespace into the global slot).
          build.onLoad({ filter: /.*/, namespace: REACT_NS }, (args) => {
            const globalSlot = REACT_SPECIFIERS[args.path];
            if (!globalSlot) {
              throw new Error(`unexpected react specifier: ${args.path}`);
            }
            // `react` and `react/jsx-runtime` expose different surfaces
            // — branch the stub body on the requested specifier so we
            // don't dereference undefined properties on the wrong
            // module.
            if (args.path === "react") {
              return {
                loader: "js",
                contents: `
                  const __mod = globalThis.${globalSlot};
                  if (!__mod) {
                    throw new Error(
                      "cardboard: react not available — editor must call installReactRuntime() before pack scripts run"
                    );
                  }
                  export default __mod.default ?? __mod;
                  // Top-level
                  export const createElement = __mod.createElement;
                  export const cloneElement = __mod.cloneElement;
                  export const createContext = __mod.createContext;
                  export const createRef = __mod.createRef;
                  export const forwardRef = __mod.forwardRef;
                  export const isValidElement = __mod.isValidElement;
                  export const memo = __mod.memo;
                  export const lazy = __mod.lazy;
                  export const Suspense = __mod.Suspense;
                  export const Fragment = __mod.Fragment;
                  export const StrictMode = __mod.StrictMode;
                  export const Children = __mod.Children;
                  export const Component = __mod.Component;
                  export const PureComponent = __mod.PureComponent;
                  export const startTransition = __mod.startTransition;
                  export const version = __mod.version;
                  // Hooks
                  export const useState = __mod.useState;
                  export const useEffect = __mod.useEffect;
                  export const useLayoutEffect = __mod.useLayoutEffect;
                  export const useInsertionEffect = __mod.useInsertionEffect;
                  export const useRef = __mod.useRef;
                  export const useMemo = __mod.useMemo;
                  export const useCallback = __mod.useCallback;
                  export const useContext = __mod.useContext;
                  export const useReducer = __mod.useReducer;
                  export const useImperativeHandle = __mod.useImperativeHandle;
                  export const useId = __mod.useId;
                  export const useDebugValue = __mod.useDebugValue;
                  export const useDeferredValue = __mod.useDeferredValue;
                  export const useTransition = __mod.useTransition;
                  export const useSyncExternalStore = __mod.useSyncExternalStore;
                `,
              };
            }
            if (args.path === "react/jsx-runtime" || args.path === "react/jsx-dev-runtime") {
              return {
                loader: "js",
                contents: `
                  const __mod = globalThis.${globalSlot};
                  if (!__mod) {
                    throw new Error(
                      "cardboard: ${args.path} not available — editor must call installReactRuntime() before pack scripts run"
                    );
                  }
                  export const Fragment = __mod.Fragment;
                  export const jsx = __mod.jsx;
                  export const jsxs = __mod.jsxs;
                  export const jsxDEV = __mod.jsxDEV;
                `,
              };
            }
            if (args.path === "react-dom") {
              return {
                loader: "js",
                contents: `
                  const __mod = globalThis.${globalSlot};
                  if (!__mod) {
                    throw new Error(
                      "cardboard: react-dom not available — editor must call installReactRuntime() before pack scripts run"
                    );
                  }
                  export default __mod.default ?? __mod;
                  export const flushSync = __mod.flushSync;
                  export const createPortal = __mod.createPortal;
                  export const findDOMNode = __mod.findDOMNode;
                  export const unmountComponentAtNode = __mod.unmountComponentAtNode;
                  export const version = __mod.version;
                `,
              };
            }
            // react-dom/client
            return {
              loader: "js",
              contents: `
                const __mod = globalThis.${globalSlot};
                if (!__mod) {
                  throw new Error(
                    "cardboard: react-dom/client not available — editor must call installReactRuntime() before pack scripts run"
                  );
                }
                export const createRoot = __mod.createRoot;
                export const hydrateRoot = __mod.hydrateRoot;
              `,
            };
          });
        },
      },
      {
        name: "cardboard-shell-externals",
        setup(build) {
          // Route bare `@cardboard/editor-shell` imports through our
          // virtual namespace so the load hook below owns them. The
          // specifier is intentionally NOT a real package — it's an
          // editor-pack convention so authors can import singleton-
          // dependent shell symbols (`registerCommand`,
          // `useActiveScene`, etc.) the same way they import third-
          // party libraries. See CORE_EDITOR_PACK.md §6 gotcha #2.
          build.onResolve(
            { filter: new RegExp(`^${SHELL_SDK_SPECIFIER.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}$`) },
            (args) => ({
              path: args.path,
              namespace: SHELL_SDK_NS,
            }),
          );
          // Stub re-exports each whitelisted symbol from the global
          // slot the editor's `installShellSdkRuntime()` populates.
          // Adding a new symbol requires (a) extending the shellSdk
          // object in `apps/editor/src/packs/shellSdkRuntime.ts` and
          // (b) appending a matching `export const` line below.
          build.onLoad({ filter: /.*/, namespace: SHELL_SDK_NS }, () => ({
            loader: "js",
            contents: `
              const __mod = globalThis.__cardboard_editor_shell;
              if (!__mod) {
                throw new Error(
                  "cardboard: @cardboard/editor-shell not available — editor must call installShellSdkRuntime() before pack scripts run"
                );
              }
              export const registerCommand = __mod.registerCommand;
              export const useCommandStore = __mod.useCommandStore;
              export const useActiveScene = __mod.useActiveScene;
              export const useDiagnosticsStore = __mod.useDiagnosticsStore;
              export const useHistoryStore = __mod.useHistoryStore;
              export const useLayerStore = __mod.useLayerStore;
              export const useTilePresetStore = __mod.useTilePresetStore;
              export const useTilePresetRegistryStore = __mod.useTilePresetRegistryStore;
              export const useSceneStore = __mod.useSceneStore;
              export const cellKey = __mod.cellKey;
              export const useSelectionStore = __mod.useSelectionStore;
              export const useBrushStore = __mod.useBrushStore;
              export const useToolStore = __mod.useToolStore;
              export const EmptyState = __mod.EmptyState;
              export const PanelRenderer = __mod.PanelRenderer;
              export const undoOnce = __mod.undoOnce;
              export const redoOnce = __mod.redoOnce;
              export const loadTileTexture = __mod.loadTileTexture;
              export const getTileTextureSync = __mod.getTileTextureSync;
              export const DockShell = __mod.DockShell;
              export const WorkspaceRail = __mod.WorkspaceRail;
              export const useTabContextSlot = __mod.useTabContextSlot;
              export const useTabContextSlotValue = __mod.useTabContextSlotValue;
              export const useRoute = __mod.useRoute;
              export const buildHash = __mod.buildHash;
              export const useEditorPackPanels = __mod.useEditorPackPanels;
              export const useEditorPacksLoaded = __mod.useEditorPacksLoaded;
              // P5b — view-migration constants. SET_TAB_EVENT is a
              // string identity, EditorProjectStore is a module-level
              // IDB singleton, importPack* + assetUrl + useStatusBar
              // are each host-bound. Type-only specifiers
              // (SetTabEventDetail / WorkflowMode / ProjectMeta /
              // AssetMeta / StatusBarSection) compile away so they
              // need no runtime line here — but TypeScript still
              // resolves them through this stub module via the
              // ambient .d.ts surface the shell publishes.
              export const SET_TAB_EVENT = __mod.SET_TAB_EVENT;
              export const EditorProjectStore = __mod.EditorProjectStore;
              export const importPackFromBlob = __mod.importPackFromBlob;
              export const importPackFromUrl = __mod.importPackFromUrl;
              export const assetUrl = __mod.assetUrl;
              export const useStatusBar = __mod.useStatusBar;
            `,
          }));
        },
      },
      {
        name: "two5d-engine-types-stub",
        setup(build) {
          // Pack scripts type-import `@two_5_d/engine` for types only.
          // Bun's bundler should erase those imports since they have
          // no runtime references — but if the workspace package
          // isn't resolvable from inside the pack directory, the
          // bundler fails before erase. Short-circuit with a no-op
          // module so the build never tries to fan into engine
          // sources. `import type` lines compile away entirely, so
          // this module's body is just `export {}`.
          build.onResolve({ filter: /^@two_5_d\/engine(\/.*)?$/ }, () => ({
            path: "two5d-engine-stub",
            namespace: "two5d-engine-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "two5d-engine-stub" }, () => ({
            loader: "js",
            contents: "export {};",
          }));
        },
      },
    ],
  });

  if (!result.success) {
    // Bun returns `BuildMessage` objects in `result.logs`. Their
    // `.toString()` prints the formatted error including the source
    // location — far more useful than just `.message`. Fall back to
    // a structured dump if for some reason there are no logs.
    const messages = result.logs.length > 0
      ? result.logs.map((l) => String(l)).join("\n  ")
      : `(no diagnostics; raw=${JSON.stringify(result, null, 2)})`;
    throw new Error(
      `pack-build: ${basename(absSourcePath)} failed:\n  ${messages}`,
    );
  }
  if (result.outputs.length === 0) {
    throw new Error(`pack-build: ${basename(absSourcePath)} produced no outputs`);
  }
  // We disabled splitting; the entrypoint is always outputs[0].
  return await result.outputs[0]!.text();
}

/**
 * `true` when `path` is a pack-script source that should be bundled
 * by Bun before shipping inside the .apg. Includes `.js` so packs can
 * `import { ... } from "../lib/foo.js"` and have the helper inlined
 * into the entrypoint — engine loads pack scripts via Blob URLs which
 * have no path context for relative-import resolution.
 */
export function isCompilablePackScript(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js");
}

/**
 * Rewrite a script source path to its compiled `.js` form. `.js`
 * entries keep the same path (Bun rewrites the bundle in place);
 * `.ts`/`.tsx` swap their extension.
 */
export function compiledPackScriptPath(path: string): string {
  if (path.endsWith(".tsx")) return path.slice(0, -4) + ".js";
  if (path.endsWith(".ts")) return path.slice(0, -3) + ".js";
  return path;
}

