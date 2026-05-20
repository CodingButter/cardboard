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
import { registerDynamicStore } from "../panel-renderer/resolveBinding";
import { resolveLibrary } from "./libraryCache";
import {
  PackContextProvider,
  type RendererPackContextSlice,
} from "./PackContextProvider";

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
  /** Mount counter per panel — defensive for future split-mount work. */
  mountCounters: Map<string, number>;
}

/**
 * Fetch + decode one editor pack's `.apg`, walk its libraries +
 * panels + scripts, and return the contributed `DockPanelDef[]`.
 * Returns an empty list and logs a warning when the pack 404s, fails
 * to decode, or isn't scoped to the editor.
 */
async function loadOneEditorPack(packId: string): Promise<DockPanelDef[]> {
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
  };

  for (const scriptPath of scriptPaths) {
    await runEditorPackScript(pack, packId, scriptPath, scriptCtx, state);
  }

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
 * created dynamic stores. A future Extensions-tab disable handler
 * (deferred) will call {@link disposeEditorPackScripts} with the pack
 * id to unwind every registration.
 */
const packScriptCleanups = new Map<string, EditorPackScriptCleanup[]>();

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
 * Load every editor pack the editor knows about and collect their
 * contributed `DockPanelDef`s. Designed to be called ONCE at editor
 * startup; subsequent calls re-fetch + re-decode (idempotent — there's
 * no global side effect outside of the returned list).
 *
 * Errors during load (404, decode fail, missing scope, invalid spec)
 * are logged to the console and the offending file/pack is skipped.
 * The editor boots regardless — the editor shell does NOT depend on
 * any editor pack to function.
 */
export async function loadEditorPacks(): Promise<DockPanelDef[]> {
  const enabledIds = getEnabledEditorPackIds();
  const defs: DockPanelDef[] = [];
  for (const packId of enabledIds) {
    const packDefs = await loadOneEditorPack(packId);
    defs.push(...packDefs);
  }
  return defs;
}

/**
 * React hook: kick off `loadEditorPacks()` once on mount and return
 * the resolved DockPanelDef list. Returns an empty array until the
 * load completes, then re-renders with the loaded defs.
 */
export function useEditorPackPanels(): DockPanelDef[] {
  const [defs, setDefs] = React.useState<DockPanelDef[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void loadEditorPacks().then((loaded) => {
      if (cancelled) return;
      setDefs(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return defs;
}
