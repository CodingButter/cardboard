/**
 * Expose the editor's React + ReactDOM instances to pack scripts via
 * `globalThis`.
 *
 * Pack-side `.tsx` files import `"react"` / `"react-dom"` /
 * `"react-dom/client"` and use the automatic JSX runtime. The
 * pack-builder bundles those scripts with a resolver plugin
 * (`apps/pack-builder/src/build-pack-script.ts` — `cardboard-react-externals`)
 * that rewrites those bare specifiers into virtual modules which read
 * from the slots below at runtime.
 *
 * Both halves must agree on the global names. Bumping these requires
 * coordinated changes in the pack-builder.
 *
 * Why share one React instance across the editor + every pack: React's
 * internal `ReactCurrentDispatcher` (the thing `useState` calls into)
 * is per-module-instance. A pack-shipped component that mounts inside
 * the editor's tree with its OWN React copy would have an unset
 * dispatcher and throw "Invalid hook call — hooks can only be called
 * inside the body of a function component" on the first hook. The
 * same hazard applies to context, reconciler identity, etc. — share
 * one React, or don't share a tree at all.
 *
 * This is the editor-side mirror of `installPreactRuntime()` in
 * `packages/engine/src/PreactRuntime.ts` — same pattern, different
 * framework. See `docs/plans/CORE_EDITOR_PACK.md` §11 "Risk:
 * pack-builder must externalize React + shell SDK".
 */

import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";

declare global {
  // eslint-disable-next-line no-var
  var __cardboard_react: typeof React | undefined;
  // eslint-disable-next-line no-var
  var __cardboard_react_jsx_runtime: typeof ReactJsxRuntime | undefined;
  // eslint-disable-next-line no-var
  var __cardboard_react_dom: typeof ReactDOM | undefined;
  // eslint-disable-next-line no-var
  var __cardboard_react_dom_client: typeof ReactDOMClient | undefined;
}

/**
 * Idempotent. Called by the editor's `index.tsx` BEFORE the first
 * `loadEditorPacks()` invocation. Safe to call across HMR reloads —
 * overwriting the globals with the same module references is a no-op.
 */
export function installReactRuntime(): void {
  globalThis.__cardboard_react = React;
  globalThis.__cardboard_react_jsx_runtime = ReactJsxRuntime;
  globalThis.__cardboard_react_dom = ReactDOM;
  globalThis.__cardboard_react_dom_client = ReactDOMClient;
}
