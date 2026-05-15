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
 * Preact externalisation:
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
 * Type-only `@two_5_d/engine` imports the script uses for ambient
 * typing get tree-shaken by Bun automatically (TypeScript erases them
 * before the bundler ever sees runtime references).
 */

import { basename } from "node:path";

const PREACT_NS = "two5d-preact";

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

/** `true` when `path` is a `.ts` / `.tsx` pack script (needs compiling). */
export function isCompilablePackScript(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

/** Rewrite a `.ts`/`.tsx` script path to its compiled `.js` form. */
export function compiledPackScriptPath(path: string): string {
  if (path.endsWith(".tsx")) return path.slice(0, -4) + ".js";
  if (path.endsWith(".ts")) return path.slice(0, -3) + ".js";
  return path;
}

