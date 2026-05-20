/**
 * Editor pack loader — Phase 2b (pack-bundled libraries + dynamic
 * stores + Canvas refs).
 *
 * The editor app loads every editor-scope pack listed in
 * `useEditorPacksStore` at startup. For each pack the loader:
 *
 *   1. Fetches `/packs/<id>.apg` and decodes via `ZipAssetPack`.
 *   2. Walks `manifest.libraries[]` — for each entry, reads the bytes,
 *      hashes them against the manifest's declared SRI, and uses
 *      `libraryCache.resolveLibrary` to deduplicate identical bytes
 *      across packs into a single Blob-URL ESM module.
 *   3. Walks `manifest.editorPanels[]` — registers a `DockPanelDef`
 *      per spec, wrapped in a `<PackContextProvider>` so the renderer's
 *      Canvas node can reach the owning pack.
 *   4. Walks `manifest.scripts[]` — Blob-URL each script + dynamic-
 *      import + invokes the default export with a per-pack
 *      `EditorPackContext` object.
 *
 * The pack context surface (the typed argument scripts receive) is
 * widened from Phase 2a:
 *
 *   - `registerCommand(cmd)`        (Phase 2a)
 *   - `stores: { selection }`       (Phase 2a)
 *   - `importLibrary(name)`         (Phase 2b)
 *   - `createStore(n, i, actions)`  (Phase 2b)
 *   - `getCanvasRef(refName)`       (Phase 2b)
 *   - `onPanelMount(panelId, cb)`   (Phase 2b)
 *   - `share(key, value)`           (Phase 2b)
 *   - `consume(key)`                (Phase 2b)
 *
 * Each addition is justified by a concrete pack need (the canary
 * Profiler pack drives the design — see
 * `docs/plans/PERFORMANCE_PROFILER.md` §6 for the rationale on each
 * API). All additions are dogfood-safe: they're the SAME surface a
 * future core-editor pack would use, and a third-party pack with no
 * editor-app access can ship a feature using only these primitives.
 *
 * Disable / re-enable: scripts return optional teardowns + dynamic
 * store registrations return unregister fns; the loader stashes them
 * in `packScriptCleanups` keyed by pack id. Today's Extensions tab
 * requires a reload after toggling a pack (see EDITOR_ENGINE.md §8
 * Phase 2b "live disable" deferred work).
 */

import React from "react";
import { FileJson } from "lucide-react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { SerializedDockview } from "dockview";
import type { DockPanelDef } from "../components/dock/DockShell";
import { PanelRenderer } from "../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../panel-renderer/types";
import { ZipAssetPack, type PackManifest } from "@two_5_d/engine";
import {
  getEnabledEditorPackIds,
  useEditorPacksStore,
} from "../state/useEditorPacksStore";
import { registerCommand } from "../state/useCommandStore";
import { useSelectionStore } from "../state/useSelectionStore";
import {
  useDockPanelRegistryStore,
  useRegisteredPackPanels,
} from "../state/useDockPanelRegistryStore";
import {
  useViewRegistryStore,
  type ViewComponent,
} from "../state/useViewRegistryStore";
import {
  useLayoutRegistryStore,
  type RegisteredPredefinedLayout,
} from "../state/useLayoutRegistryStore";
import {
  useTabRegistryStore,
  type RegisteredTab,
} from "../state/useTabRegistryStore";
import { registerDynamicStore } from "../panel-renderer/resolveBinding";
import {
  registerCustomComponent as registerRendererCustomComponent,
} from "../panel-renderer/PanelRenderer";
import type { CustomComponentRenderer } from "../panel-renderer/PanelRenderer";
import { resolveLibrary } from "./libraryCache";
import {
  PackContextProvider,
  type RendererPackContextSlice,
} from "./PackContextProvider";
import { removePanelFromAllDockApis } from "./activeDockApis";
import { tutorialsApi } from "../tutorials/runtime";
import type { TutorialDef } from "../tutorials/types";

/**
 * Callback registered via `ctx.onPanelMount(panelId, cb)`. The loader
 * invokes it after the panel's children commit (Canvas refs are in
 * place). The callback may return a teardown — the loader fires that
 * teardown when the panel unmounts.
 */
export type PanelMountCallback = () => (() => void) | void;

/**
 * Per-pack EditorPackContext.
 *
 * The context is constructed once per pack-load and handed verbatim
 * to every script the manifest declares. Pack scripts hold the
 * context for the lifetime of their setup-fn closure — the loader
 * doesn't re-issue contexts across scripts in a pack (they share a
 * single ref / lifecycle / shared-slot registry, which is how
 * setup.ts hands `{ Chart, store }` to chart-init.ts).
 *
 * Underscore-prefixed members (`_registerCanvasRef`,
 * `_unregisterCanvasRef`, `_firePanelMount`, `_firePanelUnmount`)
 * are the renderer's side of the context — pack scripts NEVER call
 * them. They're exposed here only so a script that wraps the context
 * for testing can forward them. The renderer reaches them via the
 * `<PackContextProvider>` value, not via the context the scripts
 * receive.
 */
export interface EditorPackContext extends RendererPackContextSlice {
  /** Stable id of the loading pack — surfaced for logging / scoping. */
  packId: string;
  /** Same API the editor uses for first-party command registration. */
  registerCommand: typeof registerCommand;
  /**
   * Shell-store accessors — the editor's own Zustand store hooks
   * handed to the pack as-is, so a pack-script's `select(null)` is
   * byte-identical to MapView.tsx calling the same method.
   */
  stores: {
    selection: typeof useSelectionStore;
  };
  /**
   * Resolve a pack-bundled library declared in `manifest.libraries[]`
   * to its imported module namespace. The returned Promise resolves
   * to whatever the library's ESM bundle exports — for chart.js (bundled
   * via the `chart.js/auto/auto.js` entry) the namespace contains
   * `Chart`, `registerables`, etc. as named exports.
   *
   * Multiple packs that ship the SAME bytes (verified by SHA-256)
   * share one resolved module instance — chart.js singletons stay
   * coherent across packs.
   *
   * Throws when the pack didn't declare the named library; the script
   * author gets an immediate error rather than a silent `undefined`.
   */
  importLibrary: (name: string) => Promise<unknown>;
  /**
   * Create a Zustand store and register it under `name` so the
   * panel renderer can bind to `$store.<name>.<field>`. Returns the
   * bound hook (same shape as the editor's own shell-level stores) —
   * the script can read via `getState()`, write via `setState(...)`,
   * and subscribe via `subscribe(cb)`.
   *
   * Dogfood note: this is the SAME surface a future core-editor pack
   * would use to register the editor's own shell stores; the editor's
   * Wave-3 stores happen to be created eagerly in
   * `apps/editor/src/state/`, but conceptually they could move into a
   * core pack and the API surface wouldn't change.
   */
  createStore: <S extends Record<string, unknown>, A extends Record<string, unknown>>(
    name: string,
    initial: S,
    actions: (
      setState: StoreApi<S & A>["setState"],
      getState: StoreApi<S & A>["getState"],
    ) => A,
  ) => UseBoundStore<StoreApi<S & A>>;
  /**
   * Look up a `<canvas>` DOM node by `refName`. Returns `null` when
   * no canvas with that ref is currently mounted — pack scripts
   * should call this from inside an `onPanelMount` lifecycle hook
   * where the panel containing the canvas is guaranteed to be in
   * the tree.
   */
  getCanvasRef: (refName: string) => HTMLCanvasElement | null;
  /**
   * Register a callback fired AFTER the named panel's children
   * commit (Canvas refs in place). The callback may return a
   * teardown that fires when the panel unmounts. Multiple callbacks
   * per panel are allowed; they fire in registration order on each
   * mount.
   *
   * The callback fires for EVERY mount of the panel — opening the
   * panel twice (split tabs, popout) fires twice. Teardowns are
   * fired in reverse order on unmount. Pack-disable also fires any
   * still-pending teardowns + unregisters every callback the pack
   * registered.
   */
  onPanelMount: (panelId: string, cb: PanelMountCallback) => () => void;
  /**
   * Stash a value under `key` for sibling scripts to pick up via
   * `consume`. Phase 2b deliberately keeps this narrow: it's the
   * setup.ts → chart-init.ts handoff pattern (pass `{ Chart, store }`
   * across two scripts in the same pack). Cross-pack share is NOT
   * supported and intentionally so — packs that need to share state
   * should expose a Zustand store via `createStore`.
   */
  share: (key: string, value: unknown) => void;
  /**
   * Register a TSX-backed dock panel. The def matches `DockPanelDef`
   * exactly (id/title/category/component + optional icon/surface/
   * headerless) so a pack can ship a panel with the same fidelity the
   * shell's hand-written panels have. Returns an unregister function;
   * pack scripts typically aggregate every unregister into their
   * setup-fn cleanup so a future Extensions-tab disable rip every
   * contribution out without a reload.
   *
   * Mirrors `registerCommand`'s shape — the panel registry is the
   * dock-panel equivalent of the command registry, and a third-party
   * pack can ship TSX panels through this API with no special access.
   * See `docs/plans/CORE_EDITOR_PACK.md` §9.1 + §10 P2.
   */
  registerPanel: (def: DockPanelDef) => () => void;
  /**
   * Register a TOP-LEVEL VIEW component for the given view id. The
   * shell maps the active primary-tab id 1:1 to a view id and renders
   * the registered component in the shell's main body region when the
   * tab is active. Returns an unregister fn.
   *
   * The view component receives no shell-supplied props — it should
   * read whatever it needs (route, active scene, project id) from the
   * shell SDK hooks. See `docs/plans/CORE_EDITOR_PACK.md` §10 P4 for
   * the design intent + the routing decision.
   */
  registerView: (viewId: string, component: ViewComponent) => () => void;
  /**
   * Register the DEFAULT dockview layout for a view id. The view shell
   * reads this via `useDefaultLayout(viewId)` when no user-saved layout
   * exists. Replaces the previous hardcoded `buildDefaultLayout()`
   * functions in MapView / PrefabsView. Returns an unregister fn.
   */
  registerLayout: (viewId: string, layout: SerializedDockview) => () => void;
  /**
   * Register a NAMED PREDEFINED layout for a view id. Appears in the
   * Workspace Layouts modal alongside any shell-side predefined
   * layouts the WorkspacePanel still surfaces during P4. The `name`
   * argument is the human-facing label; `entry` carries everything
   * else (id, optional description, layout JSON). Returns an
   * unregister fn.
   */
  registerPredefinedLayout: (
    viewId: string,
    name: string,
    entry: Omit<RegisteredPredefinedLayout, "name">,
  ) => () => void;
  /**
   * Register a primary-tab descriptor on the shell's top-level tab
   * strip. Tabs render in registration order. The `id` doubles as
   * the URL hash segment + `useRoute().tab` value the shell narrows
   * on. Returns an unregister fn.
   */
  registerTab: (tab: RegisteredTab) => () => void;
  /**
   * VB5 — Register a custom React component under `id` so JSON authors
   * can reference it from a `{ type: "Custom", component: id }` node.
   * Used by the JSON Visual Builder pack to ship the store-path picker
   * and script-ref picker as `Custom` nodes referenced from the
   * inspector form, but available to any pack that needs a controlled
   * component the renderer doesn't ship (color pickers, code editors,
   * charts).
   *
   * Convention: ids carry a pack-id prefix (e.g.
   * `panel-builder.store-path-picker`). Returns an unregister fn.
   */
  registerCustomComponent: (
    id: string,
    component: CustomComponentRenderer,
  ) => () => void;
  /**
   * Read a value stashed via `share`. Returns `undefined` if no
   * sibling script wrote the key yet. Scripts can poll, or order
   * declarations in `manifest.scripts[]` so the consumer runs
   * AFTER the producer (the editor loader runs scripts in array
   * order).
   */
  consume: (key: string) => unknown;
}

/** Optional cleanup returned by a pack script's default export. */
export type EditorPackScriptCleanup = () => void;

/** Shape of the default export a pack script ships. */
export type EditorPackScriptModule = (
  ctx: EditorPackContext,
) => EditorPackScriptCleanup | void | Promise<EditorPackScriptCleanup | void>;

/** Base path the editor dev server serves editor packs from. Each
 *  id resolves to `<EDITOR_PACKS_BASE>/<id>.apg`, served by the
 *  editor's `Bun.serve` (see `apps/editor/server.ts`). The same path
 *  shape will work in a production deploy where the .apg sits in
 *  `apps/editor/public/packs/`. */
const EDITOR_PACKS_BASE = "/packs";

/**
 * Build a DockPanelDef from a loaded PanelSpec. The component is a
 * thin wrapper around `<PackContextProvider><PanelRenderer .../></...>`
 * — same trick the (now-deleted) `JsonDemoPanel.tsx` used, but
 * instantiated dynamically per spec rather than baked into a TSX file.
 *
 * Memoisation: the wrapper component is created ONCE per spec — react
 * keys panels by component identity, so re-creating the wrapper on
 * every render would force mounts; building it once keeps identity
 * stable for the lifetime of the loader run.
 */
function buildDockPanelDef(
  spec: PanelSpec,
  packId: string,
  packCtx: RendererPackContextSlice,
): DockPanelDef {
  const Panel: React.FunctionComponent = () => {
    return React.createElement(
      PackContextProvider,
      { value: packCtx },
      React.createElement(PanelRenderer, { spec }),
    );
  };
  Panel.displayName = `EditorPackPanel(${packId}/${spec.id})`;
  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    component: Panel,
    // TODO Phase 2 — let pack authors ship custom icon refs (lucide
    // name + colour). Until then every editor-pack-loaded panel
    // gets the FileJson icon so users can tell it apart from
    // hand-written TSX panels in the DocksModal.
    icon: React.createElement(FileJson, { size: 12 }),
  };
}

/**
 * Per-pack mutable state the context closes over. Bundled here so a
 * single object literal carries everything the pack's lifetime
 * needs — refs, mount callbacks, library modules, and shared slots
 * stay tightly scoped to one pack-load.
 */
interface PackLoadState {
  packId: string;
  canvasRefs: Map<string, HTMLCanvasElement>;
  /** Pending mount callbacks keyed by panel id. */
  mountCallbacks: Map<string, PanelMountCallback[]>;
  /**
   * Live teardown handles per (panelId, mount-index). When a panel
   * unmounts, every teardown in its slot fires in reverse order.
   * Keyed by panelId + mount-instance counter.
   */
  mountTeardowns: Map<string, Array<() => void>>;
  libModuleByName: Map<string, Promise<unknown>>;
  sharedSlots: Map<string, unknown>;
  /** Unregister fns for dynamic stores the pack created. */
  storeUnregistrars: Array<() => void>;
  /**
   * Unregister fns for TSX panels the pack contributed via
   * `ctx.registerPanel(...)`. Stashed alongside `storeUnregistrars`
   * so a future Extensions-tab disable handler can call them via
   * `disposeEditorPackScripts` and drop the panels out of the
   * DocksModal without a reload.
   */
  panelUnregistrars: Array<() => void>;
  /** Unregister fns for views + layouts + tabs the pack contributed
   *  via the P4 APIs. Aggregated into `packScriptCleanups` so disable
   *  flushes everything in one shot. */
  viewUnregistrars: Array<() => void>;
  layoutUnregistrars: Array<() => void>;
  tabUnregistrars: Array<() => void>;
  /** VB5 — unregistrars for custom components registered via
   *  `ctx.registerCustomComponent(...)`. Aggregated into the cleanup
   *  ring so disable rips them out alongside everything else. */
  customComponentUnregistrars: Array<() => void>;
  /** Mount counter per panel — defensive for future split-mount work. */
  mountCounters: Map<string, number>;
}

/**
 * Fetch + decode one editor pack's `.apg`, walk its libraries +
 * panels + scripts, and return the contributed `DockPanelDef[]`.
 * Returns an empty list and logs a warning when the pack 404s, fails
 * to decode, or isn't scoped to the editor.
 *
 * Side effects:
 *   - Stashes the JSON-spec defs in `loadedPackJsonDefs[packId]` so
 *     `unloadEditorPack` knows which panel ids to call removePanel on.
 *   - Calls `rebuildLiveDefs()` so subscribers re-render with the new
 *     panels included.
 *
 * Idempotent on already-loaded packs — returns the previously
 * captured defs without re-fetching.
 */
async function loadOneEditorPack(packId: string): Promise<DockPanelDef[]> {
  const existing = loadedPackJsonDefs.get(packId);
  if (existing) return existing;
  const url = `${EDITOR_PACKS_BASE}/${packId}.apg`;
  let pack: ZipAssetPack;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[editorPackLoader] ${url} → HTTP ${res.status}; skipping`,
      );
      return [];
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    pack = await ZipAssetPack.loadFromBytes(bytes, url);
  } catch (err) {
    console.warn(
      `[editorPackLoader] ${url} → fetch/decode failed:`,
      err,
    );
    return [];
  }

  const manifest = pack.manifest as PackManifest;
  // Guard: this pack MUST declare editor scope. A game-scope-only
  // pack accidentally placed under `/packs/` should be ignored, not
  // silently treated as editor content.
  const scope = manifest.scope ?? ["game"];
  if (!scope.includes("editor")) {
    console.warn(
      `[editorPackLoader] pack ${packId} does not declare scope: ["editor"]; skipping`,
    );
    return [];
  }
  const panelPaths = manifest.editorPanels ?? [];
  // Cache the manifest-derived metadata on the store BEFORE the
  // panel-spec loop. The Extensions tab reads from this cache so
  // even a pack with zero contributed panels still surfaces its
  // name + version. Setting meta with `panelCount: 0` is the
  // correct signal that the pack loaded but contributes nothing.
  useEditorPacksStore.getState().setMeta(packId, {
    name: manifest.name,
    version: manifest.version,
    panelCount: panelPaths.length,
  });

  // Build the per-pack state ALL the context callbacks close over.
  const state: PackLoadState = {
    packId,
    canvasRefs: new Map(),
    mountCallbacks: new Map(),
    mountTeardowns: new Map(),
    libModuleByName: new Map(),
    sharedSlots: new Map(),
    storeUnregistrars: [],
    panelUnregistrars: [],
    viewUnregistrars: [],
    layoutUnregistrars: [],
    tabUnregistrars: [],
    customComponentUnregistrars: [],
    mountCounters: new Map(),
  };

  // ── Library bundling step ──────────────────────────────────────
  // Pre-resolve every `manifest.libraries[]` entry so the context's
  // `importLibrary(name)` is a synchronous map lookup. Each library
  // routes through `resolveLibrary` (content-hash-deduped cache).
  //
  // `manifest.libraries` is now formally declared on `PackManifest`
  // (engine `AssetPack/types.ts:527`), so no `as unknown as { ... }`
  // cast is needed — TypeScript narrows the optional array directly.
  const libs = manifest.libraries ?? [];
  for (const lib of libs) {
    try {
      // Read bytes via the engine's `binaryBody` accessor. The
      // accessor is non-optional on `ZipAssetPack` (engine
      // `AssetPack/ZipAssetPack.ts:109`); the prior fallback to a
      // legacy `binaryBlob` accessor + the corresponding cast were
      // dead code post the engine's accessor consolidation. The
      // `as ZipAssetPack` widens `pack` (typed `ZipAssetPack` from
      // `loadFromBytes` above) so this access is a clean
      // structural match.
      const bytes = await pack.binaryBody(lib.path);
      const mod = resolveLibrary(lib.hash, bytes);
      state.libModuleByName.set(lib.name, mod);
    } catch (err) {
      console.warn(
        `[editorPackLoader] ${packId}/${lib.path}: library load failed:`,
        err,
      );
      // Continue — scripts that don't use the library still work.
    }
  }

  // ── Build the renderer-facing context slice ──────────────────────
  // The Canvas node + PanelRenderer reach this via `useContext(PackContext)`.
  const rendererCtx: RendererPackContextSlice = {
    packId,
    _registerCanvasRef: (refName, el) => {
      if (state.canvasRefs.has(refName)) {
        console.warn(
          `[editorPackLoader] ${packId}: canvas ref "${refName}" was ` +
            `already registered; overwriting (last mount wins)`,
        );
      }
      state.canvasRefs.set(refName, el);
    },
    _unregisterCanvasRef: (refName) => {
      state.canvasRefs.delete(refName);
    },
    _firePanelMount: (panelId) => {
      const callbacks = state.mountCallbacks.get(panelId);
      if (!callbacks || callbacks.length === 0) return;
      const teardowns: Array<() => void> = [];
      for (const cb of callbacks) {
        try {
          const teardown = cb();
          if (typeof teardown === "function") {
            teardowns.push(teardown);
          }
        } catch (err) {
          console.error(
            `[editorPackLoader] ${packId}/${panelId}: mount callback threw —`,
            err,
          );
        }
      }
      // Replace any stale teardowns from a previous mount (if React
      // remounts the same panel without an unmount, e.g. dev-mode
      // strict-mode double-invoke, the previous teardowns were
      // already fired in the unmount step).
      state.mountTeardowns.set(panelId, teardowns);
      const ctr = (state.mountCounters.get(panelId) ?? 0) + 1;
      state.mountCounters.set(panelId, ctr);
    },
    _firePanelUnmount: (panelId) => {
      const teardowns = state.mountTeardowns.get(panelId);
      if (!teardowns) return;
      // Fire teardowns in reverse order to mirror constructor / destructor
      // ordering callers expect.
      for (let i = teardowns.length - 1; i >= 0; i--) {
        try {
          teardowns[i]!();
        } catch (err) {
          console.error(
            `[editorPackLoader] ${packId}/${panelId}: unmount teardown threw —`,
            err,
          );
        }
      }
      state.mountTeardowns.delete(panelId);
    },
  };

  // ── Panel registration ──────────────────────────────────────────
  if (panelPaths.length === 0) {
    console.debug(
      `[editorPackLoader] pack ${packId} has no editorPanels[]; nothing to register`,
    );
  }
  const defs: DockPanelDef[] = [];
  for (const panelPath of panelPaths) {
    let spec: PanelSpec;
    try {
      const text = await pack.textBody(panelPath);
      spec = JSON.parse(text) as PanelSpec;
    } catch (err) {
      console.warn(
        `[editorPackLoader] ${packId}/${panelPath} → read/parse failed:`,
        err,
      );
      continue;
    }
    if (!spec.id || !spec.title || !spec.category || !spec.root) {
      console.warn(
        `[editorPackLoader] ${packId}/${panelPath} is not a valid PanelSpec` +
          ` (missing id/title/category/root); skipping`,
      );
      continue;
    }
    defs.push(buildDockPanelDef(spec, packId, rendererCtx));
  }

  // ── Tutorial registration (T2) ──────────────────────────────────
  // Walk `manifest.tutorials[]` — for each path, read the JSON via
  // `pack.textBody`, parse + validate via `tutorialsApi._register`,
  // and stash the unregister fn in the pack's cleanup ring so a
  // toggle-off via the Extensions tab removes the tutorial from the
  // runtime registry without a reload. See `docs/plans/TUTORIALS.md`
  // §3 T2 + §4.1.
  const tutorialPaths = manifest.tutorials ?? [];
  const tutorialUnregistrars: Array<() => void> = [];
  for (const tutorialPath of tutorialPaths) {
    let def: TutorialDef;
    try {
      const text = await pack.textBody(tutorialPath);
      def = JSON.parse(text) as TutorialDef;
    } catch (err) {
      console.warn(
        `[editorPackLoader] ${packId}/${tutorialPath} → tutorial read/parse failed:`,
        err,
      );
      continue;
    }
    const ok = tutorialsApi._register(def);
    if (!ok) {
      // _register already logged the validation error — skip onward.
      continue;
    }
    // Build an unregister fn — `tutorialsApi._unregister(id)` deletes
    // the registry entry (and stops the active session if it's the
    // one being removed). See `runtime.ts:unregisterTutorial`.
    const id = def.id;
    tutorialUnregistrars.push(() => {
      tutorialsApi._unregister(id);
    });
    console.debug(
      `[editorPackLoader] ${packId}/${tutorialPath}: tutorial "${id}" registered`,
    );
  }
  // Stash tutorial unregistrars in the cleanup ring immediately so
  // `disposeEditorPackScripts` rips them out on pack-disable, even
  // when the pack ships no scripts (a tutorial-only pack is legal).
  if (tutorialUnregistrars.length > 0) {
    let cleanups = packScriptCleanups.get(packId);
    if (!cleanups) {
      cleanups = [];
      packScriptCleanups.set(packId, cleanups);
    }
    cleanups.push(...tutorialUnregistrars);
  }

  // ── Script execution ────────────────────────────────────────────
  const scriptPaths = manifest.scripts ?? [];
  // Build the script-author-facing context. It extends the renderer
  // slice — the underscore-prefixed methods are present but pack
  // scripts SHOULD NOT call them.
  const scriptCtx: EditorPackContext = {
    ...rendererCtx,
    registerCommand,
    stores: { selection: useSelectionStore },
    importLibrary: (name) => {
      const mod = state.libModuleByName.get(name);
      if (!mod) {
        return Promise.reject(
          new Error(
            `[editorPackLoader] ${packId}: importLibrary("${name}") failed — ` +
              `the pack's manifest.libraries[] does not declare "${name}".`,
          ),
        );
      }
      return mod;
    },
    createStore: <
      S extends Record<string, unknown>,
      A extends Record<string, unknown>,
    >(
      storeName: string,
      initial: S,
      actions: (
        setState: StoreApi<S & A>["setState"],
        getState: StoreApi<S & A>["getState"],
      ) => A,
    ): UseBoundStore<StoreApi<S & A>> => {
      const hook = create<S & A>()((set, get) => {
        const acts = actions(set, get);
        // The actions object's properties are spread INTO the state
        // so callers can do `store.getState().setX(...)` — same
        // ergonomic pattern the editor's own Zustand stores use.
        return { ...initial, ...acts } as S & A;
      });
      const unregister = registerDynamicStore(
        storeName,
        hook as unknown as UseBoundStore<StoreApi<unknown>>,
      );
      state.storeUnregistrars.push(unregister);
      return hook;
    },
    getCanvasRef: (refName) => state.canvasRefs.get(refName) ?? null,
    onPanelMount: (panelId, cb) => {
      let list = state.mountCallbacks.get(panelId);
      if (!list) {
        list = [];
        state.mountCallbacks.set(panelId, list);
      }
      list.push(cb);
      return () => {
        const arr = state.mountCallbacks.get(panelId);
        if (!arr) return;
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
    share: (key, value) => {
      state.sharedSlots.set(key, value);
    },
    consume: (key) => state.sharedSlots.get(key),
    registerPanel: (def) => {
      const unregister = useDockPanelRegistryStore.getState().register(def);
      state.panelUnregistrars.push(unregister);
      return () => {
        const idx = state.panelUnregistrars.indexOf(unregister);
        if (idx >= 0) state.panelUnregistrars.splice(idx, 1);
        unregister();
      };
    },
    registerView: (viewId, component) => {
      const unregister = useViewRegistryStore
        .getState()
        .register(viewId, component);
      state.viewUnregistrars.push(unregister);
      return () => {
        const idx = state.viewUnregistrars.indexOf(unregister);
        if (idx >= 0) state.viewUnregistrars.splice(idx, 1);
        unregister();
      };
    },
    registerLayout: (viewId, layout) => {
      const unregister = useLayoutRegistryStore
        .getState()
        .registerLayout(viewId, layout);
      state.layoutUnregistrars.push(unregister);
      return () => {
        const idx = state.layoutUnregistrars.indexOf(unregister);
        if (idx >= 0) state.layoutUnregistrars.splice(idx, 1);
        unregister();
      };
    },
    registerPredefinedLayout: (viewId, name, entry) => {
      const full: RegisteredPredefinedLayout = { ...entry, name };
      const unregister = useLayoutRegistryStore
        .getState()
        .registerPredefinedLayout(viewId, full);
      state.layoutUnregistrars.push(unregister);
      return () => {
        const idx = state.layoutUnregistrars.indexOf(unregister);
        if (idx >= 0) state.layoutUnregistrars.splice(idx, 1);
        unregister();
      };
    },
    registerTab: (tab) => {
      const unregister = useTabRegistryStore.getState().register(tab);
      state.tabUnregistrars.push(unregister);
      return () => {
        const idx = state.tabUnregistrars.indexOf(unregister);
        if (idx >= 0) state.tabUnregistrars.splice(idx, 1);
        unregister();
      };
    },
    registerCustomComponent: (id, component) => {
      const unregister = registerRendererCustomComponent(id, component);
      state.customComponentUnregistrars.push(unregister);
      return () => {
        const idx = state.customComponentUnregistrars.indexOf(unregister);
        if (idx >= 0) state.customComponentUnregistrars.splice(idx, 1);
        unregister();
      };
    },
  };

  for (const scriptPath of scriptPaths) {
    await runEditorPackScript(pack, packId, scriptPath, scriptCtx, state);
  }

  // Stash the JSON-spec defs so unloadEditorPack can find them later +
  // every subscriber to useLiveDefsStore re-renders. This is the
  // mechanism that lets DocksModal update without a reload.
  loadedPackJsonDefs.set(packId, defs);
  rebuildLiveDefs();

  return defs;
}

/**
 * Read one pack-bundled script, import it as ESM via a Blob URL, and
 * invoke its default export with the {@link EditorPackContext}.
 */
async function runEditorPackScript(
  pack: ZipAssetPack,
  packId: string,
  scriptPath: string,
  ctx: EditorPackContext,
  state: PackLoadState,
): Promise<void> {
  let source: string;
  try {
    source = await pack.textBody(scriptPath);
  } catch (err) {
    console.warn(
      `[editorPackLoader] ${packId}/${scriptPath} → read failed:`,
      err,
    );
    return;
  }
  const blob = new Blob([source], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    // String-indirection so static analysers don't try to resolve the
    // Blob URL at bundle time. See `docs/plans/PERFORMANCE_PROFILER.md`
    // §10 R3 for the rationale on this pattern.
    const dyn: (s: string) => Promise<unknown> = (s) =>
      import(/* @vite-ignore */ s);
    const mod = (await dyn(url)) as Record<string, unknown>;
    const setup = (mod.default ?? mod.setup) as EditorPackScriptModule | undefined;
    if (typeof setup !== "function") {
      console.warn(
        `[editorPackLoader] ${packId}/${scriptPath}: no default export ` +
          `or setup() function — nothing to run`,
      );
      return;
    }
    const result = await Promise.resolve(setup(ctx));
    if (typeof result === "function") {
      let cleanups = packScriptCleanups.get(packId);
      if (!cleanups) {
        cleanups = [];
        packScriptCleanups.set(packId, cleanups);
      }
      cleanups.push(result);
    }
    // Stash store unregistrars in the same cleanup ring so a future
    // Extensions-tab disable handler tears them down too.
    if (state.storeUnregistrars.length > 0) {
      let cleanups = packScriptCleanups.get(packId);
      if (!cleanups) {
        cleanups = [];
        packScriptCleanups.set(packId, cleanups);
      }
      // Move ownership — each unregistrar is fired once across the
      // pack's lifetime.
      const moved = state.storeUnregistrars.splice(0);
      cleanups.push(...moved);
    }
    // Same treatment for panel unregistrars contributed via
    // `ctx.registerPanel(...)`. Each unregister drops the panel out
    // of `useDockPanelRegistryStore` so `useEditorPackPanels()`
    // re-renders without the entry.
    if (state.panelUnregistrars.length > 0) {
      let cleanups = packScriptCleanups.get(packId);
      if (!cleanups) {
        cleanups = [];
        packScriptCleanups.set(packId, cleanups);
      }
      const moved = state.panelUnregistrars.splice(0);
      cleanups.push(...moved);
    }
    // P4 view + layout + tab unregistrars share the same lifecycle.
    if (
      state.viewUnregistrars.length > 0 ||
      state.layoutUnregistrars.length > 0 ||
      state.tabUnregistrars.length > 0
    ) {
      let cleanups = packScriptCleanups.get(packId);
      if (!cleanups) {
        cleanups = [];
        packScriptCleanups.set(packId, cleanups);
      }
      cleanups.push(...state.viewUnregistrars.splice(0));
      cleanups.push(...state.layoutUnregistrars.splice(0));
      cleanups.push(...state.tabUnregistrars.splice(0));
    }
    // VB5 — custom-component unregistrars ride the same cleanup ring.
    if (state.customComponentUnregistrars.length > 0) {
      let cleanups = packScriptCleanups.get(packId);
      if (!cleanups) {
        cleanups = [];
        packScriptCleanups.set(packId, cleanups);
      }
      cleanups.push(...state.customComponentUnregistrars.splice(0));
    }
    console.debug(
      `[editorPackLoader] ${packId}/${scriptPath}: loaded`,
    );
  } catch (err) {
    console.error(
      `[editorPackLoader] ${packId}/${scriptPath}: failed to run —`,
      err,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Per-pack cleanup ring. Populated by `runEditorPackScript` when a
 * script's default export returns a cleanup function OR when a script
 * created dynamic stores. The Extensions-tab disable handler calls
 * {@link disposeEditorPackScripts} with the pack id to unwind every
 * registration.
 */
const packScriptCleanups = new Map<string, EditorPackScriptCleanup[]>();

/**
 * Per-pack JSON-spec DockPanelDefs. Populated by `loadOneEditorPack`
 * once a pack's `editorPanels[]` have been parsed + wrapped. Stored
 * here (rather than only as a flat list inside `loadEditorPacks()`'s
 * resolved promise) so the Extensions-tab live-disable path can:
 *
 *   1. Look up which panel ids the pack contributed,
 *   2. Call `api.removePanel(id)` on every mounted DockShell,
 *   3. Drop the pack's entry from this map so the live-defs selector
 *      stops surfacing them.
 *
 * Pre-live-unregister, these defs lived ONLY inside the promise's
 * resolved array + the `useEditorPackPanels` hook's local state — a
 * pack-disable couldn't reach them without a reload.
 */
const loadedPackJsonDefs = new Map<string, DockPanelDef[]>();

/**
 * Module-level "live defs" Zustand store. Holds two derived bits:
 *
 *   - `defs`: a flat list of every JSON-spec DockPanelDef across every
 *     currently-loaded pack. Re-derived from `loadedPackJsonDefs` on
 *     every mutation.
 *   - `version`: monotonically increasing counter — bumps on every
 *     load/unload so `useEditorPacksLoaded` can flip back to false
 *     during a re-enable, then back to true once the load completes.
 *
 * `useEditorPackPanels` subscribes to this store INSTEAD of using
 * local React state, so a toggle in the Extensions tab re-renders
 * every consumer (DocksModal, MapView, PrefabsView) automatically.
 */
interface LiveDefsStoreState {
  defs: DockPanelDef[];
  /** Set of pack ids whose initial-load (or re-enable load) is currently in flight. */
  loadingPackIds: ReadonlySet<string>;
  /** Set of pack ids that have completed at least one load this session. */
  loadedPackIds: ReadonlySet<string>;
}

const useLiveDefsStore = create<LiveDefsStoreState>(() => ({
  defs: [],
  loadingPackIds: new Set<string>(),
  loadedPackIds: new Set<string>(),
}));

/** Recompute the flat `defs` list from `loadedPackJsonDefs` and push
 *  it into the store. Cheap — maps run at most once per toggle. */
function rebuildLiveDefs(): void {
  const flat: DockPanelDef[] = [];
  for (const list of loadedPackJsonDefs.values()) {
    flat.push(...list);
  }
  useLiveDefsStore.setState({ defs: flat });
}

function markPackLoading(packId: string): void {
  useLiveDefsStore.setState((s) => {
    const next = new Set(s.loadingPackIds);
    next.add(packId);
    return { loadingPackIds: next };
  });
}

function markPackLoaded(packId: string): void {
  useLiveDefsStore.setState((s) => {
    const nextLoading = new Set(s.loadingPackIds);
    nextLoading.delete(packId);
    const nextLoaded = new Set(s.loadedPackIds);
    nextLoaded.add(packId);
    return { loadingPackIds: nextLoading, loadedPackIds: nextLoaded };
  });
}

function markPackUnloaded(packId: string): void {
  useLiveDefsStore.setState((s) => {
    const nextLoaded = new Set(s.loadedPackIds);
    nextLoaded.delete(packId);
    const nextLoading = new Set(s.loadingPackIds);
    nextLoading.delete(packId);
    return { loadedPackIds: nextLoaded, loadingPackIds: nextLoading };
  });
}

/** Run every cleanup callback collected for a given pack id and clear
 *  the entry. Safe to call when the pack has no cleanups (no-op). */
export function disposeEditorPackScripts(packId: string): void {
  const cleanups = packScriptCleanups.get(packId);
  if (!cleanups) return;
  for (const fn of cleanups) {
    try {
      fn();
    } catch (err) {
      console.warn(
        `[editorPackLoader] ${packId}: cleanup threw —`,
        err,
      );
    }
  }
  packScriptCleanups.delete(packId);
}

/**
 * Per-pack in-flight load promise. Multiple call sites (e.g.
 * `useEditorPackPanels` AND `useEditorPacksLoaded`) hit
 * `loadEditorPacks()` in parallel during a single editor mount; the
 * cached promise lets them share the same in-flight load so pack
 * scripts run exactly once. Without this, two concurrent callers
 * would both call `loadOneEditorPack()` which runs the pack's setup
 * script, which calls `registerCommand(...)` etc. — duplicate
 * registrations log "command id … already registered" warnings AND
 * leave dangling cleanups.
 *
 * Keyed by pack id so a per-pack toggle on the Extensions tab can
 * re-load THAT pack without disturbing the rest. A unified "load all
 * enabled" promise still exists below (`loadEditorPacksPromise`),
 * built on top of this map.
 */
const inFlightPackLoads = new Map<string, Promise<DockPanelDef[]>>();

/**
 * Load a SINGLE editor pack by id. Idempotent — calling twice for the
 * same id while the first load is in flight returns the same promise.
 * Calling after the load completes returns the cached defs without
 * re-fetching.
 *
 * Used by the Extensions-tab live-enable path AND internally by
 * `loadEditorPacks()` (which fans this out to every enabled id).
 */
export function loadEditorPack(packId: string): Promise<DockPanelDef[]> {
  const inFlight = inFlightPackLoads.get(packId);
  if (inFlight) return inFlight;
  markPackLoading(packId);
  const promise = (async () => {
    try {
      const defs = await loadOneEditorPack(packId);
      return defs;
    } finally {
      markPackLoaded(packId);
    }
  })();
  inFlightPackLoads.set(packId, promise);
  return promise;
}

/**
 * Unload a single editor pack by id. The full live-disable path:
 *
 *   1. Walk EVERY mounted DockShell (via `activeDockApis`) and call
 *      `api.removePanel(panelId)` for every panel id this pack
 *      contributed — JSON-spec defs AND TSX-via-registerPanel defs.
 *      Mid-edit panel state (e.g. unsaved CellInspector edits in a
 *      panel from the disabled pack) is dropped — same as a reload.
 *   2. Run `disposeEditorPackScripts(packId)` — fires every cleanup
 *      callback the pack registered. This rips down commands, stores,
 *      tabs, views, layouts, and TSX panel registrations.
 *   3. Drop the pack's JSON-spec defs from `loadedPackJsonDefs` so
 *      `useEditorPackPanels()` re-renders without the entries.
 *   4. Drop the in-flight promise so a future re-enable starts fresh.
 *
 * Safe to call when the pack is already unloaded (no-op).
 */
export function unloadEditorPack(packId: string): void {
  const jsonDefs = loadedPackJsonDefs.get(packId);
  const tsxDefs = useDockPanelRegistryStore.getState().panels;
  // Collect every panel id contributed by this pack. JSON ids are easy
  // — they're in `jsonDefs`. TSX ids are looked up by walking the
  // global panel registry; we can't distinguish "this pack's panels"
  // from "another pack's panels" by id alone, so we conservatively
  // call removePanel for both. Dockview's removePanel on a non-mounted
  // panel id is silently dropped (guarded in removePanelFromAllDockApis).
  const idsToRemove = new Set<string>();
  if (jsonDefs) {
    for (const def of jsonDefs) idsToRemove.add(def.id);
  }
  // TSX-registered panel ids that disappear when we run cleanups —
  // we walk the registry BEFORE running cleanups so we have the snapshot.
  // After cleanups run, those ids will be gone from the registry.
  const tsxIdsBefore = new Set(Object.keys(tsxDefs));

  // 1. Remove any currently-mounted instances from every DockShell.
  for (const id of idsToRemove) {
    removePanelFromAllDockApis(id);
  }

  // 2. Fire script cleanups — this rips out TSX panels, stores, tabs,
  //    views, layouts, commands, and runs the script's own returned
  //    cleanup. After this, anything that disappeared from the panel
  //    registry was a TSX contribution from THIS pack.
  disposeEditorPackScripts(packId);

  // 2a. Now compute the TSX-panel ids that disappeared and remove
  //     their mounted instances too. This covers the case where a
  //     pack contributes panels via `ctx.registerPanel(...)` rather
  //     than `editorPanels[]`.
  const tsxIdsAfter = new Set(
    Object.keys(useDockPanelRegistryStore.getState().panels),
  );
  for (const id of tsxIdsBefore) {
    if (!tsxIdsAfter.has(id)) {
      removePanelFromAllDockApis(id);
    }
  }

  // 3. Drop the JSON defs cache + rebuild the live defs list.
  loadedPackJsonDefs.delete(packId);
  rebuildLiveDefs();

  // 4. Drop in-flight promise + mark unloaded.
  inFlightPackLoads.delete(packId);
  markPackUnloaded(packId);

  // 5. Invalidate the unified loadEditorPacks() promise so the next
  //    call sees the current enabled set rather than the snapshot
  //    captured at first call.
  loadEditorPacksPromise = null;
}

/**
 * Unified "load every enabled pack" promise. Cached at module level
 * so the first batch of `useEditorPackPanels` / `useEditorPacksLoaded`
 * callers on an editor mount share one in-flight load.
 *
 * Reset to null whenever a pack is enabled/disabled — the next caller
 * builds a fresh promise that walks `getEnabledEditorPackIds()` again
 * (post-toggle).
 */
let loadEditorPacksPromise: Promise<DockPanelDef[]> | null = null;

/**
 * Load every enabled editor pack and collect their contributed
 * `DockPanelDef`s. Designed to be called once per editor mount;
 * subsequent calls within the same session return the cached promise
 * unless a pack toggle has invalidated it (see `unloadEditorPack` /
 * the toggle handler in ExtensionsTab).
 *
 * Errors during load (404, decode fail, missing scope, invalid spec)
 * are logged to the console and the offending file/pack is skipped.
 * The editor boots regardless — the editor shell does NOT depend on
 * any editor pack to function.
 */
export async function loadEditorPacks(): Promise<DockPanelDef[]> {
  if (loadEditorPacksPromise) return loadEditorPacksPromise;
  loadEditorPacksPromise = (async () => {
    const enabledIds = getEnabledEditorPackIds();
    const defs: DockPanelDef[] = [];
    for (const packId of enabledIds) {
      const packDefs = await loadEditorPack(packId);
      defs.push(...packDefs);
    }
    return defs;
  })();
  return loadEditorPacksPromise;
}

/**
 * React hook: subscribe to the LIVE editor-pack panel registry.
 *
 * Two contribution streams merge here:
 *   1. JSON `editorPanels[]` specs → the loader builds DockPanelDefs
 *      out of each spec via `buildDockPanelDef`. Stored in
 *      `loadedPackJsonDefs` and exposed via `useLiveDefsStore`.
 *   2. TSX `ctx.registerPanel(def)` calls → the loader writes them
 *      into `useDockPanelRegistryStore` while running pack scripts.
 *
 * Both lists are reactive — a toggle in the Extensions tab calls
 * `unloadEditorPack` / `loadEditorPack`, which mutate the underlying
 * stores; THIS hook re-renders immediately without a reload. The
 * mount-time effect kicks off the initial `loadEditorPacks()` call
 * for the first render of the editor.
 *
 * JSON defs come first so a TSX panel registered later in the same
 * pack wins on id collision (last-write for the registry is also
 * last-write here).
 */
export function useEditorPackPanels(): DockPanelDef[] {
  // Mount-time kickoff — idempotent thanks to `loadEditorPacksPromise`.
  React.useEffect(() => {
    void loadEditorPacks();
  }, []);
  const jsonDefs = useLiveDefsStore((s) => s.defs);
  const tsxDefs = useRegisteredPackPanels();
  return React.useMemo(() => {
    const byId = new Map<string, DockPanelDef>();
    for (const def of jsonDefs) byId.set(def.id, def);
    for (const def of tsxDefs) byId.set(def.id, def);
    return Array.from(byId.values());
  }, [jsonDefs, tsxDefs]);
}

/**
 * React hook: returns `true` once every currently-enabled editor pack
 * has completed loading. Flips back to `false` when a pack is being
 * enabled live (the new pack's load is in flight); flips back to true
 * once the in-flight set drains.
 *
 * Used by view shells whose default layouts reference panels
 * CONTRIBUTED by a pack — gating the dock mount on this flag prevents
 * dockview's deserializer from throwing "Only React.memo / ForwardRef
 * / functional components are accepted as components" when the
 * saved/default layout names a panel id whose component is still
 * in-flight.
 */
export function useEditorPacksLoaded(): boolean {
  const [initialResolved, setInitialResolved] = React.useState<boolean>(false);
  React.useEffect(() => {
    let cancelled = false;
    void loadEditorPacks().then(() => {
      if (cancelled) return;
      setInitialResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // After the initial load resolves, treat the flag as "no packs are
  // currently loading". A live re-enable kicks `loadingPackIds` back
  // above zero, flipping the flag false; once the new pack finishes,
  // it flips true again. The set is from useLiveDefsStore so callers
  // re-render on each transition.
  const loadingPackIds = useLiveDefsStore((s) => s.loadingPackIds);
  return initialResolved && loadingPackIds.size === 0;
}
