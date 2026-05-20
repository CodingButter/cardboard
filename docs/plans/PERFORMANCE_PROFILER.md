# Performance Profiler — implementation plan

The Profiler is the proof-by-construction milestone for the Editor
Engine (EDITOR_ENGINE.md §9). This doc is what an implementation
agent needs after task #30 (pack-bundled scripts) and task #20
(pack-bundled libraries) have landed. Both are still pending — the
phasing here lists them as blockers, not work items.

This plan was written against the codebase at commit `7a44fac` (last
panel migration). Every "current behaviour" claim below is anchored to
a file path + line range so the implementation agent can verify
without re-reading every plan doc.

---

## 1. Goal + scope

`packages/demo-performance-profiler/` is the canary editor pack. It
proves:

1. **The third-party pack model works.** A workspace outside
   `apps/editor/` ships a `manifest.json`, `scripts/`, `panels/`, and
   `libraries/` directory; the editor consumes them through the
   exact same loader path that already loads
   `cardboard-editor-pack-demo` — no editor-only shortcuts.
2. **Pack-bundled libraries work.** A real npm dependency
   (`chart.js@4.4.0`) ships **inside** the `.apg` at build time. The
   editor resolves it through a content-hash-deduped module cache. No
   `<script src="https://...">`, no esbuild-wasm, no network calls
   at load.
3. **The JSON renderer covers chart-shaped UIs.** A single new
   primitive (`Canvas`) plus the existing
   `Layout`/`Heading`/`Button`/`Text`/`Conditional` set is enough.
   The chart itself is imperative chart.js mounted onto the canvas;
   the JSON wraps it.
4. **No shell-side editor-only hooks were needed.** Everything the
   Profiler script does — register commands, subscribe to a store,
   read pack-bundled module bytes, attach a canvas ref — flows
   through the `EditorPackContext` surface that #30 introduces.
   Verifies the dogfooding principle
   (`.claude/memory/project_dogfooding_principle.md`).

The endpoint: the Profiler pack ships to the marketplace as a `.apg`,
a user installs it via Editor Settings → Extensions, a live FPS line
appears in their docked panel within seconds. That URL is the demo
Jamie hands to a friend (EDITOR_ENGINE.md §9 line 271).

---

## 2. Pack contents

### 2.1 Workspace location — new workspace, not the existing demo

Use a **new workspace**: `packages/demo-performance-profiler/`.

Rationale: `packages/cardboard-editor-pack-demo/` already serves as
the dogfooding-proof / migrated-TSX-panels pack (6 panels listed in
its `manifest.editorPanels[]`). Co-mingling the Profiler with those
muddies the marketplace story — the Profiler is supposed to feel like
**a third party shipped it**, not like it's part of the dogfooding
chassis. A separate workspace also gives the agent a clean fixture
for testing pack enable/disable in isolation.

Workspace skeleton:

```
packages/demo-performance-profiler/
├── package.json            # workspace entry + chart.js devDep
├── manifest.json           # see §2.2
├── libraries/
│   └── chart.js-4.4.0.js   # bundled by pack-builder from node_modules
├── scripts/
│   ├── setup.ts            # data-collection + command registration
│   └── chart-init.ts       # canvas → chart.js instantiation
├── panels/
│   └── profiler.json       # JSON panel spec
└── types/                  # auto-generated pack.d.ts (gitignored)
```

### 2.2 manifest.json shape

```jsonc
{
  "id": "demo-performance-profiler",
  "name": "demo-performance-profiler",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "scope": ["editor"],
  "libraries": [
    {
      "name": "chart.js",
      "version": "4.4.0",
      "path": "libraries/chart.js-4.4.0.js",
      "hash": "sha256-…computed-at-pack-build"
    }
  ],
  "scripts": [
    "scripts/setup.ts",
    "scripts/chart-init.ts"
  ],
  "editorPanels": [
    "panels/profiler.json"
  ]
}
```

- `libraries[]` is the NEW manifest field — see §4 for the schema add
  in `packages/engine/src/AssetPack/types.ts`.
- `scripts[]` already exists at types.ts:510 ("Editor-scope pack
  scripts. Each path is a `.js` (or `.ts` at source-time; the
  pack-builder transpiles to `.js`)"). The pack-builder already
  walks it (build-packs.ts:798-807, 1033-1038); only the editor-side
  loader plumbing in `editorPackLoader.ts` needs to grow the
  fetch-+-execute step.
- `editorPanels[]` is unchanged — same path the dogfooding pack uses.

### 2.3 package.json

```jsonc
{
  "name": "@two_5_d/demo-performance-profiler",
  "version": "0.1.0",
  "private": true,
  "description": "Editor demo pack: live FPS / draw-call / memory chart. Bundles chart.js. The marketplace-milestone canary pack for EDITOR_ENGINE §9.",
  "devDependencies": {
    "chart.js": "4.4.0"
  }
}
```

Chart.js is a `devDependencies` entry, not a `dependencies` one,
because the **only** consumer of `node_modules/chart.js/` is the
pack-builder's library-copy step. Nothing in `apps/editor/` imports
it. Listing it as a devDep makes that intent explicit + keeps the
editor's runtime bundle clean.

### 2.4 libraries/chart.js-4.4.0.js

A pack-build-time copy of `node_modules/chart.js/dist/chart.umd.js`
(verified-on-disk path; see §10 risk on UMD-vs-ESM bundle choice).
Bytes are SHA-256 hashed; the hash is written into
`manifest.libraries[0].hash` at build time. See §4.

The file is checked into the repo so a fresh clone + `bun install` +
`bun run build-packs` produces a deterministic `.apg`. Future work
can regenerate from `node_modules` each build, but Phase 1 just
commits the bytes.

### 2.5 scripts/setup.ts

Default export is invoked by the loader with an `EditorPackContext`
(see §6). Responsibilities, in order:

1. **Subscribe to or create the metrics source.** The editor has NO
   draw-call counter today
   (`apps/editor/src/views/scene/panels/MapCanvasPanel.tsx` is
   canvas-2D with no per-frame instrumentation). The Profiler's
   setup script owns an internal `useProfilerStore` Zustand store
   that the script defines via the context's
   `createStore(name, initial, actions)` API (see §6).
2. **Start a rAF loop** that updates the store every frame with:
   - `fps` — count of frames in the trailing 1-second window.
   - `drawCalls` — stays 0 today (TODO comment in code; see §7).
   - `memoryMB` — `(performance as any).memory?.usedJSHeapSize / 1e6`
     when available (Chrome only).
3. **Register commands** the JSON panel references:
   - `profiler.pause` — sets `paused: true` in the store.
   - `profiler.reset` — clears the rolling window.
   - `profiler.toggle` — flips paused.
4. **Return a teardown** the loader runs on pack-disable. Cancels the
   rAF; unregisters every command; tears down the store.

Pseudocode (full file lives in the implementation, not here):

```ts
export default async function setup(ctx: EditorPackContext) {
  const Chart = await ctx.importLibrary("chart.js"); // see §5
  const store = ctx.createStore("profiler", {
    fps: 0, drawCalls: 0, memoryMB: 0,
    samples: [] as number[], paused: false,
  }, { /* actions */ });
  let raf = 0;
  const loop = (t: number) => { /* sliding-window FPS */ raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const unregPause = ctx.registerCommand({ id: "profiler.pause", run: () => store.setState({ paused: true }) });
  const unregReset = ctx.registerCommand({ id: "profiler.reset", run: () => store.setState({ samples: [] }) });
  const unregToggle = ctx.registerCommand({ id: "profiler.toggle", run: () => store.setState(s => ({ paused: !s.paused })) });
  // chart-init.ts also needs the store + Chart — pass via ctx.share().
  ctx.share("profiler:chart-deps", { Chart, store });
  return () => {
    cancelAnimationFrame(raf);
    unregPause(); unregReset(); unregToggle();
  };
}
```

### 2.6 scripts/chart-init.ts

Runs **after** `setup.ts` (loader runs `manifest.scripts[]` in
declaration order). Responsibilities:

1. Pull `{ Chart, store }` from `ctx.share("profiler:chart-deps")`.
2. Register a per-panel-mount lifecycle hook that:
   - Looks up the canvas DOM node by ref name (`"profiler-chart"`)
     via `ctx.getCanvasRef("profiler-chart")`.
   - Instantiates a chart.js line chart with three datasets (fps,
     drawCalls, memoryMB).
   - Subscribes to the store; on each change, pushes new data points
     + calls `chart.update("none")` (zero-animation update).
3. The lifecycle hook returns a teardown that destroys the chart on
   panel unmount. Wired through a new `ctx.onPanelMount(panelId, cb)`
   API (see §6).

Splitting setup vs chart-init keeps the data-collection (engine-side
concern) separate from the visualisation (presentation concern). A
future "Stats Exporter" pack can reuse setup.ts's store without
shipping a chart.

### 2.7 panels/profiler.json

```jsonc
{
  "id": "profiler",
  "title": "Performance Profiler",
  "category": "Diagnostics",
  "dockKind": "dockable-window",
  "rootOptions": { "padding": 2 },
  "root": {
    "type": "Layout",
    "direction": "column",
    "gap": 2,
    "children": [
      {
        "type": "Layout",
        "direction": "row",
        "gap": 2,
        "align": "center",
        "children": [
          { "type": "Heading", "text": "Performance", "level": 3 },
          { "type": "Spacer", "size": 2 },
          { "type": "Button", "text": "Pause", "onClick": { "script": "profiler.toggle" }, "variant": "secondary" },
          { "type": "Button", "text": "Reset", "onClick": { "script": "profiler.reset" }, "variant": "ghost" }
        ]
      },
      {
        "type": "Layout",
        "direction": "row",
        "gap": 3,
        "children": [
          { "type": "Text", "text": "$store.profiler.fps", "variant": "value" },
          { "type": "Text", "text": "$store.profiler.drawCalls", "variant": "value" },
          { "type": "Text", "text": "$store.profiler.memoryMB", "variant": "value" }
        ]
      },
      {
        "type": "Canvas",
        "refName": "profiler-chart",
        "heightPx": 200
      }
    ]
  }
}
```

The `$store.profiler.fps` bindings prove the dogfooding loop: a JSON
spec authored in a third-party pack reads a Zustand store created by
that pack's script through the same `resolveBinding` path
(`apps/editor/src/panel-renderer/resolveBinding.ts`) that core panels
use for `store.scene.*`. The store registry (`STORE_REGISTRY` at
resolveBinding.ts:152-175) must grow a dynamic-registration entry-
point (§5).

---

## 3. Renderer changes needed

Only ONE new node type. Resist the urge to add more.

### 3.1 New: `Canvas` node

```ts
export interface CanvasNode {
  type: "Canvas";
  /**
   * Stable ref name. The renderer exposes the underlying
   * <canvas> DOM node under this name via the active pack
   * context's `getCanvasRef(name)`. Names are unique per
   * panel-mount; collisions log a warning and the last mount wins.
   */
  refName: string;
  /** Canvas height in pixels. Width fills the flex parent. */
  heightPx?: number;
  /** Optional className passthrough. */
  className?: string;
}
```

Renderer behaviour (in `PanelRenderer.tsx`):

- Render a `<canvas>` element sized to `heightPx` (default 200) and
  100% width.
- On mount, look up the **active pack context** (a new React
  context provider the loader wraps each pack-loaded panel with —
  see §6) and call `ctx._registerCanvasRef(refName, canvasEl)`.
- On unmount, call `ctx._unregisterCanvasRef(refName)`.
- Fire an event (or invoke a registered callback) so chart-init's
  `onPanelMount` lifecycle hook knows the canvas is ready.

This is the only new node. **No `Chart` node.** chart.js's API is
imperative + stateful — wrapping it in declarative JSON would mean
re-deriving chart.js's surface in our renderer, which is busywork
that adds no clarity. The Canvas+script split is the clean line.

### 3.2 Renderer: dynamic store registration

`resolveBinding.ts:152` currently has `STORE_REGISTRY` as a hardcoded
five-entry record (`scene`, `selection`, `layer`, `tool`, `brush`).
For the Profiler to bind `$store.profiler.fps`, that registry must
become **extensible** at runtime.

Required change:

```ts
// resolveBinding.ts
const DYNAMIC_STORES: Map<string, UseBoundStore<StoreApi<unknown>>> = new Map();

export function registerDynamicStore(
  name: string,
  hook: UseBoundStore<StoreApi<unknown>>,
): () => void { /* … */ }

// `isKnownStore` widens to: name in STORE_REGISTRY || DYNAMIC_STORES.has(name)
// `STORE_REGISTRY[storeName]` lookups widen to: STORE_REGISTRY[name] ?? DYNAMIC_STORES.get(name)!
```

The pack-context's `createStore` API (§6) calls
`registerDynamicStore` under the hood. The unregister fn is held by
the pack-load record so disabling the pack tears the store down.

**Write semantics:** dynamic stores are read-only via the resolver
(no entry in the `WRITERS` table at resolveBinding.ts:204). Pack
scripts mutate their own stores directly through closures over the
zustand `setState` they received. This is fine — the Profiler panel
never two-way-binds; the `<Text>` nodes are read-only.

### 3.3 Renderer: pack-context wiring

The `PanelRenderer` itself currently has no notion of "which pack
contributed this panel". For the Canvas node's ref lookup to work,
the renderer needs a React context provider — added by
`buildDockPanelDef` (editorPackLoader.ts:60) — that scopes:

```tsx
<PackContextProvider value={packCtx}>
  <PanelRenderer spec={spec} />
</PackContextProvider>
```

Each panel-mount captures a context lookup; the Canvas node reads
the context and pushes its ref into `packCtx._registerCanvasRef`.

---

## 4. Pack-builder changes

### 4.1 Manifest type — add `libraries[]`

`packages/engine/src/AssetPack/types.ts:451` — add to `PackManifest`:

```ts
/**
 * Editor-scope: pack-bundled npm libraries. Each entry is a JS file
 * inside the pack root that the editor loads as ESM via a content-
 * hash-deduped Blob URL. The loader exposes the resolved module to
 * pack scripts through `ctx.importLibrary(name)`.
 *
 * Pack-builder copies the file from `node_modules/<name>/<dist-path>`
 * at build time, computes SHA-256 of the bytes, and writes the hash
 * into this manifest entry. See `docs/plans/PERFORMANCE_PROFILER.md`
 * §4 and `docs/plans/EDITOR_ENGINE.md` §5.
 */
libraries?: ReadonlyArray<{
  name: string;
  version: string;
  /** Path inside the pack, relative to the pack root. */
  path: string;
  /** "sha256-<base64>" SRI-style hash of the file bytes. */
  hash: string;
}>;
```

Forward-compatible — packs without `libraries[]` keep working
byte-identical.

### 4.2 build-packs.ts — library copy + hash step

Insert AFTER the manifest read (build-packs.ts:600-615) and BEFORE
the walk loop. New helper:

```ts
async function bundleLibraries(
  packRoot: string,
  manifest: PackManifest,
): Promise<void> {
  const libs = (manifest as { libraries?: Array<...> }).libraries;
  if (!libs || libs.length === 0) return;
  for (const lib of libs) {
    // Resolve source: node_modules/<lib.name>/dist/<entry>.js
    // The mapping is per-library; default-pack convention:
    //   chart.js → node_modules/chart.js/dist/chart.umd.js
    // A small allowlist in pack-builder maps library names to
    // canonical browser-entry paths. Unknown names error.
    const src = canonicalBrowserEntry(lib.name, lib.version);
    const bytes = await Bun.file(src).bytes();
    const destAbs = join(packRoot, lib.path);
    await Bun.write(destAbs, bytes);
    // Compute SHA-256 → SRI-style "sha256-<base64>"
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    const expected = `sha256-${hasher.digest("base64")}`;
    if (lib.hash && lib.hash !== expected && lib.hash !== "PLACEHOLDER") {
      throw new Error(`library ${lib.name} hash mismatch`);
    }
    // Mutate the manifest IN MEMORY so the zipped manifest gets the
    // computed hash. First-build use case: `lib.hash: "PLACEHOLDER"`
    // in the source manifest; pack-builder replaces with real hash.
    lib.hash = expected;
  }
}
```

`canonicalBrowserEntry` is a small allowlist living in
`apps/pack-builder/src/library-entries.ts`:

```ts
export const LIBRARY_ENTRIES: Record<string, string> = {
  "chart.js": "node_modules/chart.js/dist/chart.umd.js",
};
```

Adding a new library = one line in this map. Unknown library names
fail the build with an actionable error pointing at this file.

The library bytes are emitted into the zip by the regular walk loop
(libraries live at `libraries/<name>-<version>.js` inside the pack
root; walk already picks them up). The manifest-emit step (already
deferred at build-packs.ts:1019-1062) ships the post-mutation
manifest with computed hashes.

### 4.3 No script-pipeline changes required

The script compile/rewrite path at build-packs.ts:741-851 + 1033-1038
already covers `manifest.scripts[]` for editor packs. The Profiler's
`scripts/setup.ts` + `scripts/chart-init.ts` will round-trip through
the existing `buildPackScript` → `.js` rewrite path without
touching `build-packs.ts`.

---

## 5. Loader changes (editor-side)

Assumes #30 (pack-bundled scripts) lands first. #30 will add the
basic "fetch scripts, Blob-URL them, dynamic import, call default
export with `EditorPackContext`" loop. This section describes the
**library lookup widening** that the Profiler additionally needs.

### 5.1 New file: `apps/editor/src/packs/libraryCache.ts`

Module-global content-hash dedup table:

```ts
const LIBRARY_CACHE = new Map<string, { url: string; module: Promise<unknown> }>();

/**
 * Resolve a pack-bundled library to its imported module. Multiple
 * packs that ship the same bytes (verified by SHA-256) share the
 * same Blob URL + the same Promise — chart.js bundled by two packs
 * is one module instance in memory.
 */
export async function resolveLibrary(
  declaredHash: string,
  bytes: Uint8Array,
): Promise<unknown> {
  const cached = LIBRARY_CACHE.get(declaredHash);
  if (cached) return cached.module;
  // Verify hash before caching — caller's manifest may have stale hash.
  const actual = await sha256Sri(bytes);
  if (actual !== declaredHash) {
    throw new Error(`library hash mismatch: declared ${declaredHash}, actual ${actual}`);
  }
  const blob = new Blob([bytes], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const module = import(/* @vite-ignore */ url);
  LIBRARY_CACHE.set(declaredHash, { url, module });
  return module;
}
```

### 5.2 editorPackLoader.ts — additions

After the manifest read at `editorPackLoader.ts:109-120` and BEFORE
script execution (which #30 introduces), insert:

```ts
const libs = (manifest as { libraries?: Array<{
  name: string; version: string; path: string; hash: string;
}> }).libraries ?? [];
const libModuleByName = new Map<string, Promise<unknown>>();
for (const lib of libs) {
  const bytes = await pack.binaryBody(lib.path); // assumes ZipAssetPack exposes this; see §10 risk
  const mod = resolveLibrary(lib.hash, bytes);
  libModuleByName.set(lib.name, mod);
}
```

Then when constructing the `EditorPackContext` for this pack:

```ts
const ctx: EditorPackContext = {
  // … #30's existing surface
  importLibrary: (name) => {
    const mod = libModuleByName.get(name);
    if (!mod) throw new Error(`pack ${packId} did not bundle "${name}"`);
    return mod;
  },
  getCanvasRef: (refName) => canvasRefs.get(refName) ?? null,
  _registerCanvasRef: (refName, el) => canvasRefs.set(refName, el),
  _unregisterCanvasRef: (refName) => canvasRefs.delete(refName),
  createStore: (storeName, initial, actions) => {
    // creates a zustand store, calls `registerDynamicStore`, returns the bound hook
  },
  share: (key, value) => sharedSlots.set(key, value),
  consume: (key) => sharedSlots.get(key),
  onPanelMount: (panelId, cb) => { /* register; called from buildDockPanelDef */ },
  registerCommand: (cmd) => useCommandStore.getState().register(cmd),
};
```

### 5.3 Disable / re-enable

When a pack is disabled via Extensions tab → reload:

- `editorPackLoader.ts`'s `loadEditorPacks()` (line 179) iterates
  enabled ids only — the Profiler pack's scripts never execute, its
  store registration never fires, its commands never register.
  Existing behaviour.
- For LIVE disable (no reload — Phase-2 nicety, not Phase-1
  required), the loader holds the script's returned teardown fn and
  calls it. Phase 1 of the Profiler can require a reload after
  disable. Document this in the Extensions tab tooltip.

---

## 6. EditorPackContext widening

The context surface the Profiler script needs. #30's baseline
will give us `registerCommand` + the script-invoke wrapper. The
Profiler-driven additions:

| API | Signature | Used by |
|---|---|---|
| `importLibrary(name)` | `(name: string) => Promise<unknown>` | setup.ts (chart.js) |
| `createStore(name, initial, actions)` | `(n, i, a) => UseBoundStore<…>` | setup.ts (profiler store) |
| `getCanvasRef(refName)` | `(name: string) => HTMLCanvasElement \| null` | chart-init.ts |
| `onPanelMount(panelId, cb)` | `(id, cb: (refs) => () => void) => () => void` | chart-init.ts |
| `share(key, value)` | `(k: string, v: unknown) => void` | setup → chart-init |
| `consume(key)` | `(k: string) => unknown` | setup → chart-init |

`_registerCanvasRef` / `_unregisterCanvasRef` are intentionally
underscore-prefixed — they're the **renderer**'s side of the canvas-
ref wiring, not script API. Pack scripts never call them; the Canvas
node renderer does (§3.3).

**Why not just expose `useDiagnosticsStore` directly to packs?**
Considered + rejected. A Blob-URL ESM module cannot resolve
`"@two_5_d/editor"` or `"../state/useDiagnosticsStore"` — there's no
host-bundle resolver in the browser. The context object is how the
shell hands store handles + APIs to pack scripts. This pattern
satisfies dogfooding by being the SAME surface a future
`core-editor-pack` (per EDITOR_ENGINE.md §2 / phase 4) would use to
get the diagnostics store. **The shell doesn't have a special editor
side-channel — every pack reaches the stores the same way.**

Important: `useDiagnosticsStore` (the log/problems store at
`apps/editor/src/state/useDiagnosticsStore.ts`) is NOT what the
Profiler uses. The Profiler's `useProfilerStore` is created by the
pack's setup.ts and holds fps/drawCalls/memoryMB/samples. The
existing diagnostics store is a `DiagnosticLine[]` log — wrong shape
for time-series numeric data. §10 lists this as a risk-actually-
fine-once-you-read-the-code finding.

---

## 7. Data collection

What setup.ts actually measures.

### 7.1 FPS — rAF loop, sliding window

```ts
const window: number[] = []; // timestamps
const SAMPLE_WINDOW_MS = 1000;
const FRAME_BUFFER = 60;
function tick(t: number) {
  window.push(t);
  while (window[0] !== undefined && t - window[0] > SAMPLE_WINDOW_MS) {
    window.shift();
  }
  const fps = window.length; // count over the last 1s
  // Push into rolling-samples buffer (60 entries → 60s @ 1s tick)
  // Actually push once per second, not per frame, or the buffer blows up.
  // Use a separate setInterval for the chart-feed.
  raf = requestAnimationFrame(tick);
}
```

Two-channel design: rAF for instantaneous fps update; a 1Hz
`setInterval` snapshots the current fps + drawCalls + memoryMB into
`samples` for the chart. Decoupling avoids 60 chart.update calls per
second (chart.js can hit 4-6ms per redraw — that itself becomes a
draw-call cost the Profiler reports on, which is meta-cute but bad
UX).

### 7.2 Draw calls — engine surface OR stub

The engine HAS a stats collector
(`packages/engine/src/Debug/stats.ts:50-121`) exposing
`EngineStats.drawCalls` — but that's wired to the GAME runtime's
WebGL context, not the editor's canvas-2D MapCanvas. The editor has
no comparable counter.

Decision: **ship Phase-1 Profiler with drawCalls = 0** and a TODO
comment pointing at the editor instrumentation gap. Adding it is a
parallel concern (the editor's MapCanvas needs a small wrap-and-
count layer over its `ctx.drawImage`/`fillRect` calls) and shouldn't
block the marketplace milestone. Add a console-warn the first time
drawCalls is read so it's loud:

```ts
console.warn(
  "[demo-performance-profiler] drawCalls stays 0 — editor MapCanvas has no draw-call counter yet. " +
  "See docs/plans/PERFORMANCE_PROFILER.md §7.2."
);
```

A follow-up commit can wire the editor MapCanvas to publish its
canvas-2D op count into a shell-exposed store; the Profiler then
reads from that store instead of stubbing 0. **The plan does not
gate the Profiler milestone on this work.**

### 7.3 Memory — `performance.memory`

```ts
function readMemoryMB(): number {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
  const bytes = perf.memory?.usedJSHeapSize;
  return typeof bytes === "number" ? Math.round(bytes / 1024 / 1024) : 0;
}
```

Chrome-only. Feature-detect; degrade gracefully. The chart's memory
line just stays flat at 0 on Firefox/Safari and the readout text
shows `—`.

---

## 8. UX

- **Panel discovery.** Panel appears in `DocksModal` (panel-add
  modal at `apps/editor/src/components/dock/DocksModal.tsx`) under
  the **Diagnostics** category — already in `CATEGORY_ORDER` at
  DocksModal.tsx:42-50, so no new category authoring is needed.
- **Chart presentation.** Line chart, three datasets (fps =
  cyan, drawCalls = amber, memoryMB = magenta), x-axis is
  "seconds ago" 0..60, y-axis auto-scaled per dataset.
- **Pause / Reset buttons.** Live in the panel header (see §2.7).
  Both go through `registerCommand` / `invokeScript` — same path
  every other JSON-authored button uses
  (`apps/editor/src/panel-renderer/invokeScript.ts:92`).
- **Status readouts.** Three `<Text>` nodes above the chart show
  current fps / drawCalls / memoryMB as text. Reads from the
  dynamic `profiler` store via `$store.profiler.fps` etc.
- **Extensions tab integration.** The pack ships with
  `enabled: true` in `useEditorPacksStore`'s initial state? **No.**
  Initial state at `useEditorPacksStore.ts:80-88` ONLY lists
  `cardboard-editor-pack-demo`. The Profiler pack needs to be added
  there if we want it on-by-default, OR users can install it via
  the Extensions tab "Install from file" flow (per
  EDITOR_ENGINE.md §7). Phase 1 Profiler: add it to the initial
  state so the demo works out of the box on a fresh clone; mark
  with a `default: true` note in the entry. Users can disable it
  via the tab if they don't want it.

---

## 9. Phased build

Each commit independently shippable + verifiable. Each section
ends with the verify step the implementation agent runs before
moving on.

### Phase P0 — Blockers (NOT this plan's work)

- **#30 — pack-bundled scripts.** Editor-side `editorPackLoader.ts`
  grows the "fetch script via `pack.textBody`, Blob-URL it, dynamic
  import, invoke default with `EditorPackContext`" path. Pack-
  builder side is done (build-packs.ts:798-807, 1033-1038).
- **#20 — pack-bundled libraries (basic).** Manifest type +
  pack-builder copy step + `libraryCache.ts` content-hash dedup +
  `ctx.importLibrary` API.

Sub-pieces of #20 the Profiler implementation depends on are
called out in §4 + §5; the Profiler plan can fold them into its
own commits if #20 hasn't landed (with a clear "this commit
implements #20" header).

### Phase P1 — Profiler workspace skeleton

Commit P1: create `packages/demo-performance-profiler/` with
manifest.json + package.json + empty `scripts/` + empty `panels/` +
empty `libraries/`. Add to root workspace if needed. Verify:
`bun install` succeeds; pack-builder runs and produces an empty
`demo-performance-profiler.apg` in `apps/editor/public/packs/`.

### Phase P2 — Library bundling end-to-end

Commit P2: implement §4 (manifest type, library-copy step in
pack-builder, `LIBRARY_ENTRIES` map) + §5.1 (`libraryCache.ts`) +
§5.2 (loader fetches libraries and exposes via
`ctx.importLibrary`). No script content yet — just verify the
bytes round-trip.

Verify: write a throwaway `scripts/probe.ts` that does
`const Chart = await ctx.importLibrary("chart.js"); console.log(typeof Chart);`
— see `function` in the editor's console. Delete the probe in
the next commit.

### Phase P3 — Canvas node + dynamic store registration

Commit P3: §3.1 (CanvasNode), §3.2 (dynamic store registration in
resolveBinding.ts), §3.3 (PackContextProvider wrapping). Add a
test in `PanelRenderer.test.ts` that renders a spec with a
`Canvas` node and asserts the ref-register callback fires with
the expected element.

Verify: bun test passes; a synthetic test panel with a Canvas
node renders + the ref-callback receives a real `HTMLCanvasElement`.

### Phase P4 — EditorPackContext widening

Commit P4: implement §6 surface (`createStore`, `getCanvasRef`,
`onPanelMount`, `share`, `consume`). Wire them through the loader's
context construction. Document via the TS interface so #30's
existing types extend cleanly.

Verify: a unit test creates a fake pack context, calls
`createStore("test", { x: 1 }, { setX: (v) => set({ x: v }) })`,
and reads back via `resolveBinding("store.test.x")`.

### Phase P5 — Profiler scripts + panel + library

Commit P5: write `scripts/setup.ts`, `scripts/chart-init.ts`,
`panels/profiler.json`, copy `chart.umd.js` into `libraries/`,
mutate `useEditorPacksStore.ts`'s initial state to include the
Profiler pack as enabled.

Verify (manual):
- `bun run build-packs` produces
  `apps/editor/public/packs/demo-performance-profiler.apg`.
- `bun --hot apps/editor/server.ts` boots the editor; navigate to
  the Scene workspace.
- Open the DocksModal — "Performance Profiler" appears under
  Diagnostics.
- Drop the panel in. Chart fills with a live FPS line within 2-3s.

### Phase P6 — Acceptance pass

Commit P6: full §11 acceptance run + bug-fix commits as needed.
After this commit lands, the Profiler is the marketplace milestone
and `docs/PLAN.md`'s phase status table for EDITOR_ENGINE phase 5
flips to "shipped".

---

## 10. Risks + open questions

Discovered during the read-first pass — none are blockers, but each
warrants the implementation agent's awareness.

### R1. ZipAssetPack.binaryBody — does it exist?

§5.2's loader code reads library bytes via `pack.binaryBody(path)`.
The current `ZipAssetPack` (`packages/engine/src/AssetPack/ZipAssetPack.ts`)
exposes `textBody(path)` (used at editorPackLoader.ts:147). I did
NOT verify a `binaryBody` exists. If it doesn't, add it — trivial
wrapper around the in-memory `Map<string, Uint8Array>` the pack
already holds. **Action for the implementation agent: verify and add
if missing as part of P2.**

### R2. Blob-URL dynamic import as ESM — does chart.js UMD load?

chart.js's `dist/chart.umd.js` is a UMD bundle, not ESM. Dynamic
`import()` of a UMD-flavoured module that does
`(global = global || self, factory(global.Chart = {}))` will run
but the export shape will be whatever the UMD wrapper assigns to
`globalThis.Chart`. The pack script can't `import { Chart } from
...` it — they have to read `globalThis.Chart` after the import
resolves. Awkward and fragile.

Two options:

1. **Use `chart.js/dist/chart.js` (the ESM build).** chart.js v4
   ships an ESM `dist/chart.js`. Switch `LIBRARY_ENTRIES["chart.js"]`
   to that path. The dynamic `import()` then resolves with a proper
   `{ Chart, registerables }` shape.
2. **UMD wrapper inside `libraries/chart.js-4.4.0.js`.** If we MUST
   ship UMD, pack-builder wraps the bytes in an ESM trampoline:
   `export default (() => { /* UMD bytes */; return globalThis.Chart; })();`
   Ugly + brittle.

**Recommendation: option 1.** Verify the path in
`node_modules/chart.js/package.json#exports` at P2 time and pick the
canonical ESM entry. Likely path: `node_modules/chart.js/dist/chart.js`
or `chart.js/auto`. Implementation agent verifies and updates
`LIBRARY_ENTRIES`.

### R3. `@vite-ignore` comment in a Bun build

The loader uses `import(/* @vite-ignore */ url)` so the bundler
doesn't try to statically resolve the Blob URL. Bun's bundler
doesn't recognise `@vite-ignore` — but it also doesn't statically
resolve runtime-string `import()` calls, so the comment is just
documentation. Test that Bun's bundle treats dynamic-string
`import(url)` correctly. If it doesn't, switch to a top-level
indirection (`const dyn = (u: string) => import(u); await dyn(url)`)
to defeat static analysis.

### R4. Pack-context React provider lifecycle

§3.3 wraps each panel-mount with a `PackContextProvider`. If the
same panel mounts twice (split into two dock tabs), both mounts
register the same canvas ref name. Phase 1 behaviour: last-mount-
wins + console.warn. Phase 2 nicety: pack-context can scope the
ref store by panel-instance-id (dockview exposes a stable instance
id per `addPanel` call).

### R5. Popout cross-window store sync

The dynamic `profiler` store is created via `createSyncedStore`?
Or plain `zustand.create`? Decision: **plain zustand** for Phase 1.
Reason: a popped-out window runs the SAME pack-load path
(`editorPackLoader.ts` runs in every window via `useEditorPackPanels`
at line 203), so each window's setup.ts creates its OWN rAF loop
+ its own store + its own chart. Two charts, both live, one per
window. This is correct behaviour — popout fps may legitimately
differ from main-window fps.

If we instead used `createSyncedStore`, both windows would render
the same data and the popped-out chart would be a duplicate, not
a separate measurement. **Each-window-its-own-store is the right
default.** Document this in the Profiler README.

### R6. `useDiagnosticsStore` is not what the Profiler uses

Verified by reading
`apps/editor/src/state/useDiagnosticsStore.ts:23-37`: it's a
log-line store (`{ id, severity, message, ts, cell? }`), not a
time-series numeric store. The original brief's "subscribes to
diagnostics Wave-3 store" was an architectural assertion, not a
literal binding. The Profiler creates its OWN store via
`ctx.createStore("profiler", ...)`. Documented in §6.

### R7. Chart.js bundle size

`chart.js/dist/chart.js` is ~250KB ungzipped. That's the whole pack.
EDITOR_ENGINE.md §10 budgets the **core editor pack** at ≤500KB
compressed; the demo Profiler pack is exempt from that budget, but
worth noting in the marketplace listing.

### R8. drawCalls reporting 0 is a real product gap

Documented at §7.2. The Profiler is **honest about it** —
console.warn on first read, JSON panel shows "drawCalls: 0 (editor
has no counter yet)". A follow-up commit instruments the editor
MapCanvas. This is a known gap, not a Profiler bug.

### R9. EditorPackContext needs typing for pack-author tooling

Pack authors should get TS typings for `ctx`. The auto-generated
`types/pack.d.ts` (generated by `generatePackTypes` at
build-packs.ts:641-647) covers PackComponents only; it doesn't
cover the context surface. Phase-2 work: publish a
`@two_5_d/editor-shell` types package that pack-builder consumes
+ writes into `types/pack.d.ts`. Phase 1 Profiler: hand-write the
context type at the top of setup.ts. Documented limitation.

---

## 11. Acceptance criteria

The implementation agent verifies each item before declaring the
Profiler milestone green. ✅ when checked.

- [ ] **Build.** `bun run build-packs` produces
  `apps/editor/public/packs/demo-performance-profiler.apg`. File
  size ~300KB compressed. `unzip -l` shows `manifest.json`,
  `libraries/chart.js-4.4.0.js`, `scripts/setup.js`,
  `scripts/chart-init.js`, `panels/profiler.json`.
- [ ] **Install via Extensions tab.** With the Profiler entry
  removed from `useEditorPacksStore.ts`'s initial state, the user
  toggles the pack on via Editor Settings → Extensions, reloads,
  and the panel becomes available. (Phase 1 may ship enabled by
  default — flip + verify both directions.)
- [ ] **Panel discovery.** "Performance Profiler" appears in
  `DocksModal` under the **Diagnostics** category card.
- [ ] **Live chart for 30s.** Dropping the panel in → chart renders
  a continuous FPS line for 30 seconds. fps readout matches the
  visual line within ±2 fps.
- [ ] **Pause + Reset.** Clicking Pause halts the line at the
  current x; Reset clears the sample window; both buttons route
  through the command registry (verified via console
  `useCommandStore.getState().commands["profiler.pause"]` exists).
- [ ] **Disable + reload.** Disabling the pack in Extensions tab +
  reload → panel disappears from DocksModal; chart-init.ts's chart
  destroys cleanly (no zombie rAF, no console warnings about
  unregistered commands).
- [ ] **Popout.** Pop the panel into a separate window. Chart
  renders + is live in the popped-out window. Per-window stores
  (R5) → main + popout charts can show different values; both
  are correct.
- [ ] **Pages deploy.** `bun run build:pages` produces a deploy
  artefact; pushing to the Pages branch + waiting for the deploy
  → opening the deployed URL → the Profiler pack loads from
  `/packs/demo-performance-profiler.apg` and the chart renders
  identically to dev. The URL is shareable.
- [ ] **No editor-only hooks.** Code review: every API the
  Profiler script uses is on `EditorPackContext`. No direct
  imports of `apps/editor/src/state/*` from inside the pack's
  `scripts/`. (The pack-builder's TS compile path would fail if
  you tried — but verify by inspection that the source doesn't
  attempt it.)
- [ ] **Dogfood verification.** Read the diff for any
  Profiler-driven shell additions (`registerDynamicStore` in
  resolveBinding.ts, the Canvas node, the pack-context APIs).
  Each one must be reachable from a hypothetical second pack
  author with no special editor permissions. Document any
  "smell" findings on this doc as a §10 risk for the next
  iteration.

When every box is ticked + the deployed URL has been handed to
someone outside the team, the platform is real (EDITOR_ENGINE.md
§9 line 271). Update `docs/PLAN.md`'s phase status table for
EDITOR_ENGINE phase 5 + append a one-liner to
`docs/SESSION_STATE.md`.

---

## 12. Cross-references

- `docs/plans/EDITOR_ENGINE.md` §5 (libraries), §9 (this milestone), §10 (risks).
- `docs/plans/PACK_CHAIN.md` — the loader the shell uses.
- `.claude/memory/project_dogfooding_principle.md` — what dogfooding
  means + how to validate every primitive against it.
- `.claude/memory/project_editor_package_injection.md` — the
  marketplace + Extensions tab story.
- `apps/editor/src/packs/editorPackLoader.ts` — current loader (#30
  extends this).
- `apps/editor/src/panel-renderer/types.ts` — renderer types (§3
  extends this).
- `apps/editor/src/panel-renderer/resolveBinding.ts` — store registry
  (§3.2 extends this).
- `apps/pack-builder/src/build-packs.ts` — pack-builder (§4 extends
  this).
- `packages/engine/src/AssetPack/types.ts:451` — PackManifest (§4.1
  extends this).
