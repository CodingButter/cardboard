/* @jsxImportSource preact */
import * as Preact from "preact";
import * as PreactHooks from "preact/hooks";
import * as PreactJsxRuntime from "preact/jsx-runtime";

/**
 * Expose the engine's Preact instance to pack scripts via `globalThis`.
 *
 * Pack-side `.tsx` files import `"preact"` / `"preact/hooks"` / the
 * automatic JSX runtime. The pack-builder bundles those scripts with a
 * resolver plugin that rewrites those bare specifiers into virtual
 * modules which read from the slots below at runtime — see
 * `apps/pack-builder/src/build-packs.ts` for the build-side counterpart.
 *
 * Both halves must agree on the global names. Bumping these requires
 * coordinated changes in the pack-builder.
 *
 * Why share one Preact instance instead of bundling a fresh copy into
 * every pack script: components mounted by the engine and components
 * mounted by the pack need to share the same renderer (or `render()`
 * calls into the same DOM mount would interleave conflicting reconcile
 * trees). Sharing also keeps each pack's wire size tiny — Preact is
 * only paid for once, in the engine bundle.
 */
declare global {
  // eslint-disable-next-line no-var
  var __two5d_preact: typeof Preact | undefined;
  // eslint-disable-next-line no-var
  var __two5d_preact_hooks: typeof PreactHooks | undefined;
  // eslint-disable-next-line no-var
  var __two5d_preact_jsx_runtime: typeof PreactJsxRuntime | undefined;
}

/**
 * Idempotent. Called by `Game` before `runPackScripts`. Safe to call
 * across HMR reloads — overwriting the globals with the same modules
 * is a no-op semantically.
 */
export function installPreactRuntime(): void {
  globalThis.__two5d_preact = Preact;
  globalThis.__two5d_preact_hooks = PreactHooks;
  globalThis.__two5d_preact_jsx_runtime = PreactJsxRuntime;
}
