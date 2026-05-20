/**
 * Expose the editor shell's singleton-dependent APIs to pack scripts via
 * `globalThis`.
 *
 * Pack-shipped TSX panels need to call into shell-side singletons —
 * specifically `registerCommand` (so commands hit the host's
 * `useCommandStore` and surface in the command palette) and
 * `useActiveScene` (so the hook reads the host's React Context, not a
 * zero-state copy from inside the pack bundle).
 *
 * The pack-builder's `cardboard-shell-externals` plugin
 * (`apps/pack-builder/src/build-pack-script.ts`) rewrites
 * `import ... from "@cardboard/editor-shell"` specifiers into a virtual
 * module that reads from `globalThis.__cardboard_editor_shell`. This
 * module populates that slot.
 *
 * Why only these symbols and not the entire `components/ui/` surface:
 * presentational primitives like `Tooltip` and `lucide-react` icons are
 * safe to bundle into the pack (no singleton state, no host-side React
 * Context to coordinate with) so they're left alone. Only the symbols
 * whose semantics REQUIRE host-side identity show up here. Future P3+
 * panel migrations will extend this slot as new requirements surface.
 *
 * Same pattern as `reactRuntime.ts` — see CORE_EDITOR_PACK.md §6 gotcha
 * #2 "shell primitives" for the rationale.
 */

import { registerCommand, useCommandStore } from "../state/useCommandStore";
import { useActiveScene } from "../shell/ActiveSceneContext";

/**
 * The runtime surface published into the `globalThis` slot. Pack-shipped
 * TSX `import { ... } from "@cardboard/editor-shell"` resolves to a
 * virtual module whose exports re-export from this object at call time.
 *
 * Adding a new entry: append a property here AND a matching named
 * re-export in the pack-builder's stub-module body (the
 * `cardboard-shell-externals` plugin's onLoad handler).
 */
export const shellSdk = {
  registerCommand,
  useCommandStore,
  useActiveScene,
} as const;

export type ShellSdk = typeof shellSdk;

declare global {
  // eslint-disable-next-line no-var
  var __cardboard_editor_shell: ShellSdk | undefined;
}

/**
 * Idempotent. Called by the editor's `index.tsx` BEFORE the first
 * `loadEditorPacks()` invocation. Safe to call across HMR reloads —
 * overwriting the global with the same shellSdk reference is a no-op.
 */
export function installShellSdkRuntime(): void {
  globalThis.__cardboard_editor_shell = shellSdk;
}
