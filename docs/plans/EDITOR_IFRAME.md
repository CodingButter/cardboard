# Editor ↔ Game-Runner — iframe architecture

The editor (`apps/editor`) embeds the game runner (`apps/game`) via
**iframe** instead of mounting the engine directly in the editor's
React tree. This doc is the source-of-truth design and ships in
phases I1 → I3.

Cross-refs: [EDITOR.md](./EDITOR.md) for the editor architecture
this pivots, [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) for the
`AssetPack` interface the iframe consumes,
[PACK_CHAIN.md](./PACK_CHAIN.md) for the `?pack=` URL convention
this co-exists with.

---

## 1. Goals & non-goals

### Goals

- **One canonical engine boot path.** The same `apps/game/index.ts`
  the docs landing iframe uses also runs inside the editor. The
  editor doesn't fork the engine boot sequence.
- **Bounded engine viewport.** The engine renders into the iframe
  viewport — fullscreen INSIDE its document. Editor chrome (toolbars,
  inspectors, modals) lives in a different DOM tree entirely.
- **HUD / fixed overlays stay in their lane.** `position: fixed` on
  the engine's modal screens anchors to the iframe's viewport, not
  the editor window.
- **No engine plumbing leaks into editor code.** The editor mounts
  one `<iframe>` and talks to it via `postMessage`. It doesn't import
  `Game`, `applyConfigOverride`, `runPackScripts`, or `WebGLRenderer`.
- **Backwards compat.** The docs landing iframe at
  `/cardboard/play/?pack=...` keeps working byte-identical to today.
- **Same-origin data substrate.** The editor and the iframe load
  from the same origin, so `IndexedDB` is shared. The iframe reads
  the project the editor wrote, no message-passing of asset bytes.

### Non-goals

- **Not isolation/sandboxing.** Same origin is the point. The iframe
  is a CSS / DOM / `position: fixed` container, not a security
  boundary.
- **Not a generic JSON-RPC bridge.** Message protocol is small and
  task-specific (load, switch, reload, ready, error).
- **Not a step-debugger.** Edit-time pause / step-frame is future
  (I2 territory). I1 stops at "the engine runs, the editor talks to
  it, scene swaps work."
- **Not script hot-reload.** `.tsx` → `.js` compilation needs a
  browser-side bundler (esbuild-wasm or pre-compile worker). Out of
  scope for I1; surfaced as I3.

---

## 2. Why iframe — bug classes eliminated

Engine-in-React-tree fought us at every turn. Each item below was a
real symptom traced to the engine assuming "I own the document":

1. **HUD canvas leaks past the viewport pane.** The WebGL backend
   appends a stacked 2D HUD `<canvas>` to `document.body`. Inside the
   iframe, `document.body` IS the engine's surface — leak resolved
   by tautology.
2. **Modals overlay the entire editor.** The default-pack's
   `InventoryScreen` and `SettingsScreen` use `position: fixed`,
   which anchors to the layout viewport. Inside the iframe, that
   viewport is the iframe's bounding box. Modals are clipped to the
   pane automatically.
3. **`fitCanvasToWindow` ignored host-pane sizing.** The engine
   sized the canvas to `window.innerWidth/Height` (now patched to
   read `parent.clientWidth/Height`, but the iframe makes the patch
   irrelevant — `window.innerWidth` inside the iframe IS the pane
   size).
4. **Tailwind classes from `default-pack/scripts/ui/` weren't in
   editor's compiled CSS.** The editor's Tailwind compile only
   scans editor source; pack-shipped components rendered unstyled.
   Inside the iframe the pack runs under the game runner's HTML,
   whose Tailwind compile includes pack sources.
5. **ResizeObserver + `getBoundingClientRect` plumbing.** Required
   to convert "pane changed size" → "canvas should resize." Inside
   the iframe a `window` resize event fires naturally when the
   iframe's CSS box reflows.
6. **Pointer-lock + fullscreen + gamepad permissions.** Each one
   needs a permission policy on the iframe (`allow="…"`) — but
   they're per-iframe, so we don't pollute the editor's permission
   state.
7. **HMR/dev server hot-reload competing with engine reload.** The
   iframe reloads independently of the editor's HMR.
8. **Engine teardown races.** Edit → Play remount required
   `game.destroy()` + careful guard against double-dispose. Iframe
   reload throws everything away by browser-level invariant.

---

## 3. Architecture overview

```
┌───────────────────────────────────────────────────────────┐
│  EDITOR window (parent)                                   │
│  Origin: /cardboard/editor/   or   http://localhost:<E>/  │
│                                                           │
│  ┌────────────┐  ┌─────────────────────────────────────┐  │
│  │  Scene     │  │  Viewport pane                      │  │
│  │  list      │  │                                     │  │
│  │  Manifest  │  │  ┌──────────────────────────────┐   │  │
│  │  Inspector │  │  │ <iframe                      │   │  │
│  │            │  │  │   src="/cardboard/play/      │   │  │
│  │            │  │  │     ?source=editor           │   │  │
│  │            │  │  │     &projectId=…"            │   │  │
│  │            │  │  │   allow="pointer-lock        │   │  │
│  │            │  │  │           fullscreen         │   │  │
│  │            │  │  │           gamepad" />        │   │  │
│  │            │  │  │                              │   │  │
│  │            │  │  │   ENGINE                     │   │  │
│  │            │  │  │   ┌────────────────────┐     │   │  │
│  │            │  │  │   │ <canvas>           │     │   │  │
│  │            │  │  │   └────────────────────┘     │   │  │
│  │            │  │  │                              │   │  │
│  │            │  │  │   modal screens (fixed)      │   │  │
│  │            │  │  └──────────────────────────────┘   │  │
│  │            │  └─────────────────────────────────────┘  │
│  └────────────┘                                           │
│                                                           │
│       ↑                       │                           │
│       │   postMessage         ↓                           │
│       └───────────────────────────┐                       │
│                                   ↓                       │
└───────────────────────────────────────────────────────────┘
        ↓                       ↑
        │ shared IndexedDB (same-origin)
        │ two_5_d_editor DB → manifests + assets stores
        ↓                       ↑
┌───────────────────────────────────────────────────────────┐
│  IndexedDB (browser-managed)                              │
└───────────────────────────────────────────────────────────┘
```

**Editor (parent)** — React app. Owns the project list, manifest
editor, scene editor (GridEditor), and the iframe element itself.
Never mounts a `Game`.

**Iframe (child)** — runs the game runner exactly as the docs site
does, with one boot-path branch on the URL. In `?source=editor`
mode the runner constructs an `IdbAssetPack` instead of fetching a
`.apg` zip, sets up a message-bridge listener, and posts `ready`.

**Same-origin IDB substrate** — both windows share the
`two_5_d_editor` DB. The editor writes; the iframe reads. There is
no asset-shuttling over `postMessage`.

---

## 4. URL param convention

| URL form | Behavior | Source path |
|---|---|---|
| `?pack=<URL>` | Existing — fetch `.apg` zip from URL | `apps/game/index.ts` |
| `?pack=A&pack=B` | Chain — earlier are deps, last is root | `apps/game/index.ts` (P1 of PACK_CHAIN) |
| `?scene=<path>` | Override `manifest.startScene` | `packages/engine/src/main.ts` |
| `?source=editor&projectId=<id>` | **NEW** — construct `IdbAssetPack` from `two_5_d_editor` IDB | `apps/game/index.ts` |
| `?source=editor&projectId=<id>&scene=<path>` | Editor mode + start scene override | (combined) |

The branches are mutually exclusive — `?pack=…` and `?source=editor`
should not both appear in a single URL. If they do, `?source=editor`
wins (editor explicitly opted in).

---

## 5. IdbAssetPack — promote from editor to engine

`apps/editor/src/lib/EditorAssetPack.ts` already implements the
`AssetPack` contract against the editor's `EditorProjectStore`. To
let the game runner construct one without depending on editor code,
the implementation moves into the engine at
`packages/engine/src/AssetPack/IdbAssetPack.ts`.

### What moves

- The class body (`textBody` / `textureBlob` / `has` / `manifest`
  + `fromProject(projectId)` factory) moves verbatim, renamed
  `EditorAssetPack` → `IdbAssetPack`.

### What changes

- The engine module talks to IDB directly via the `idb` package
  rather than depending on the editor's store. The IDB schema is
  hard-coded to match what the editor writes — DB name
  `two_5_d_editor`, version `1`, stores `manifests` (keyed by
  project id) and `assets` (keyed by `[projectId, path]`). This is
  the schema defined in EDITOR.md §4.2 and shipping in
  `apps/editor/src/lib/EditorProjectStore.ts`.

### What stays in the editor

- `EditorProjectStore` itself stays in the editor — it owns project
  list, rename, delete, manifest save, asset save. The engine never
  writes to IDB.
- `apps/editor/src/lib/EditorAssetPack.ts` — the file becomes a
  thin re-export shim that imports `IdbAssetPack` from the engine
  and re-exports it as `EditorAssetPack` for any straggling
  consumers. If no consumers remain after the editor refactor, the
  file can be deleted outright. I1 chooses delete-outright since
  the only consumer (`EditorViewport`) no longer imports it.

### Public surface

```ts
class IdbAssetPack extends AssetPack {
  readonly manifest: PackManifest;
  readonly projectId: string;

  static async fromProject(
    projectId: string,
    dbName?: string,   // default "two_5_d_editor"
  ): Promise<IdbAssetPack>;

  has(path: string): boolean;
  textBody(path: string): Promise<string>;
  textureBlob(path: string): Promise<Blob>;
}
```

Re-exported from `packages/engine/src/AssetPack/index.ts` and from
the engine barrel `packages/engine/src/index.ts`.

---

## 6. Message protocol

Both directions use `window.postMessage` with `{ type, ... }`
payloads. All messages target `"*"` because same-origin guarantees
the receiver is who we expect (the editor verifies
`event.source === iframeRef.current.contentWindow`; the iframe
verifies `event.source === window.parent`).

### Editor → iframe

```ts
type EditorToIframe =
  | { type: "load-project"; projectId: string; scene?: string }
  | { type: "switch-scene"; path: string }
  | { type: "scene-changed"; path: string }        // re-read scene from IDB
  | { type: "script-changed"; path: string }       // I3 — full reload for I1
  | { type: "manifest-changed" }                   // I3 — full reload for I1
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "set-mode"; mode: "play" | "edit-camera" };  // I2
```

### Iframe → editor

```ts
type IframeToEditor =
  | { type: "ready"; projectId: string; scene: string }
  | { type: "scene-loaded"; path: string }
  | { type: "player-state"; position: { x: number; y: number; z: number }; facing: number }  // I2 — throttled
  | { type: "error"; message: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };
```

### I1 message subset

Only the bolded subset ships in I1:

- Editor → iframe: **`switch-scene`**, **`scene-changed`**, `pause`,
  `resume`, `reset`.
- Iframe → editor: **`ready`**, **`scene-loaded`**, **`error`**.

`load-project` is implicit — the editor mounts a new iframe with a
different `projectId` URL param when the project changes. `pause` /
`resume` / `reset` wire into existing `Game.start/stop`. The rest is
I2/I3.

---

## 7. Hot-reload semantics per asset type

| Asset | I1 reload path | Future path |
|---|---|---|
| Scene JSON | `scene-changed` → `Game.reloadScene(path)` | Same |
| Different scene | `switch-scene` → `Game.loadScene(path)` | Same |
| Image (texture) | `scene-changed` re-decodes via renderer | Granular invalidate |
| Manifest | Full iframe reload | I3 — partial in-place |
| Script | Full iframe reload | I3 — esbuild-wasm in worker |
| Pack-shipped shader | Full iframe reload | I3 |

### Scene reload

`Game.reloadScene(path)` re-reads the scene from `pack.scene(path)`
(IDB read is fresh every call), swaps `this.scene`, preserves the
player's `Position` / `Facing` / `Inventory` components when
compatible, and triggers a renderer cache invalidation. The world
is NOT rebuilt — entities other than the player persist with their
existing components. ECS-state preservation across geometry changes
is best-effort; for I1 a fresh scene rebuild that re-spawns ALL
entities + restores player position is acceptable.

### Script + manifest hot-reload — deferred

Today's `apps/pack-builder` compiles `.tsx` → `.js` at build time
with `Bun.build` (Preact externalized via `installPreactRuntime`).
The editor runs in a browser tab and has no `Bun.build`. Two
options for in-browser compile, both deferred to I3:

1. **esbuild-wasm in a Web Worker.** Browser-portable bundler with
   reasonable bundle size (~5 MB wasm). Tradeoff: cold-start cost,
   handling Preact externals.
2. **Pre-compile cache.** Editor runs an esbuild-wasm-backed worker
   on every script-file save, stores the compiled `.js` next to the
   `.tsx` in IDB. `IdbAssetPack.scripts()` reads the compiled
   variant.

For I1 the editor sends `manifest-changed` and `script-changed`
messages but the iframe responds by triggering a full
`location.reload()`. Users authoring scripts in I1 will live with
this; the editor's script panel isn't wired in this phase anyway.

### Manifest reload

I1: full iframe reload (re-mounts the iframe with the same URL).
The renderer's pack-config + shader uniforms + tile presets all
re-resolve from the fresh manifest. I3 can be smarter (diff +
patch).

---

## 8. EditorViewport refactor

```tsx
// I1 — apps/editor/src/views/EditorViewport.tsx
function EditorViewport({ projectId, sceneName, mode, ... }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState("Booting…");
  const [error, setError] = useState<string | null>(null);

  // Compose the URL. Project id is part of the URL, not a message —
  // changing project means a fresh iframe.
  const src = useMemo(() => {
    const base = GAME_RUNNER_URL;
    const u = new URL(base, window.location.href);
    u.searchParams.set("source", "editor");
    u.searchParams.set("projectId", projectId);
    if (sceneName) u.searchParams.set("scene", sceneName);
    return u.toString();
  }, [projectId, sceneName]);  // (see §10 for sceneName handling)

  // Listen for messages from this iframe specifically.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const m = ev.data as IframeToEditor;
      if (m.type === "ready") setStatus("Running");
      else if (m.type === "error") setError(m.message);
      else if (m.type === "scene-loaded") onSceneResolved?.(m.path);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSceneResolved]);

  return (
    <div className="relative h-full w-full bg-zinc-950 overflow-hidden">
      {/* Mode toggle, status / error overlays unchanged */}

      {mode === "edit" && editScene && editScenePath ? (
        <GridEditor /* unchanged */ />
      ) : null}

      <iframe
        ref={iframeRef}
        src={src}
        allow="pointer-lock fullscreen gamepad screen-wake-lock"
        title="Engine viewport"
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: mode === "play" ? "block" : "none",
          background: "#000",
        }}
      />
    </div>
  );
}
```

### What gets removed

Direct engine imports the file is currently using — every line
listed disappears from the file:

- `import { Game } from "Game";`
- `import { applyConfigOverride, CONFIG } from "GameConfig";`
- `import { WebGLRenderer } from "Renderers";`
- `import type { PartialGameConfig } from "Settings";`
- `import { EditorAssetPack } from "../lib/EditorAssetPack";`
- The `engineRef`/`EngineHandle` machinery, `disposeEngine` helper,
  pointer-lock release, `Game` boot effect.

What stays:

- `<GridEditor>` mount in edit mode.
- Mode toggle button + Tab keybinding.
- Status/error overlay (now driven by `ready` / `error` messages
  from the iframe).
- `onSceneResolved` callback semantics — driven by `scene-loaded`.

---

## 9. What gets deleted

| File | I1 status | Reason |
|---|---|---|
| `apps/editor/src/lib/EditorAssetPack.ts` | Deleted | Logic moved to engine `IdbAssetPack`; no in-editor consumers remain. |
| `apps/editor/src/views/EditorViewport.tsx` direct engine imports | Removed | Engine no longer mounts in editor. |
| `apps/editor/package.json` engine deps | Audited (kept as-is) | `@two_5_d/engine` is still imported for `PackManifest` types — kept. `@two_5_d/default-pack` no longer pulled in by editor source — kept as workspace dep so the editor build can import shared types if needed. |

The pre-existing `Game.fitCanvasToWindow` ResizeObserver patch
stays in place — it's still relevant inside the iframe when the
host (iframe element) resizes faster than `window.resize` fires.

---

## 10. Backwards compatibility

The game runner without `?source=editor` keeps working exactly
as today. The URL parsing in `apps/game/index.ts` checks for
`source=editor` first; absent, it falls through to the existing
`packUrls = params.getAll("pack")` path.

### Smoke verifications

1. `apps/game/dist/index.html` opened directly → fetches
   `/packs/default.apg`. Works.
2. `apps/game/dist/index.html?pack=/packs/default.apg` → fetches
   the explicit pack. Works.
3. `apps/docs/public/play/index.html?pack=/cardboard/packs/<pack>.apg`
   → docs landing iframe. Works (same code path as #2).
4. `?source=editor&projectId=…` opened directly (no editor) →
   `IdbAssetPack.fromProject` throws because the IDB is empty.
   Surfaced as a boot error.

### Editor's `scene-changed` flow

When the user finishes an edit in GridEditor and toggles to Play:

```
1. persistScene() → IDB write completes
2. iframe.contentWindow.postMessage({type: "scene-changed", path})
3. setMode("play") → iframe becomes visible, GridEditor hidden
   (iframe stays mounted across mode toggle to preserve engine
    state — the previous "tear down on mode switch" semantics go
    away with the engine itself)
```

Step 2 happens before step 3 so the engine is reading fresh bytes
before it becomes visible.

---

## 11. Dev-vs-prod iframe src

Three deployment shapes the editor must support:

| Shape | Editor URL | Game runner URL |
|---|---|---|
| Editor dev server | `http://localhost:<E>/` | `http://localhost:<G>/` |
| Editor static build, served standalone | `/` | (not applicable) |
| Editor staged into docs site | `/cardboard/editor/` | `/cardboard/play/` |

The dev-vs-prod resolution is **same-origin only**. Cross-origin
between editor and game runner would lose the shared IndexedDB,
which is the whole substrate. Therefore in dev the editor proxies
or fetches the game runner from its own origin, OR both run on
distinct ports but the editor's iframe src is left empty and the
user must `bun run build` + stage the game runner first.

For I1 the chosen strategy is:

```ts
// apps/editor/src/lib/gameRunnerUrl.ts
export const GAME_RUNNER_URL =
  typeof window !== "undefined" && window.location.pathname.startsWith("/cardboard/editor")
    ? "/cardboard/play/"
    : "/play/";
```

- In production (`/cardboard/editor/`) → `/cardboard/play/` works
  because the docs site stages both apps under the same origin.
- In development (`bun --hot server.ts` for editor) → expects the
  game runner staged at `<editor-origin>/play/`. The editor's
  `server.ts` is taught to proxy `/play/*` to
  `apps/game/dist/*` (read by `Bun.file`). The user pre-builds the
  game runner once (`bun run build` in `apps/game`) before opening
  the editor in dev; HMR is the editor's, not the game runner's.

This trades dev-time game-runner HMR for same-origin guarantees.
HMR for engine code is reachable by reloading the iframe (`Cmd+R`
inside it, or programmatically). I3 can grow a "editor dev server
fronts game runner with HMR" path if the loss of HMR proves
painful.

---

## 12. Phases

### I1 — ✅ Shipped (commit `ab9dbee`)

- Plan doc lands.
- `IdbAssetPack` lives in engine; exported from barrel.
- `apps/game/index.ts` URL branch — `?source=editor` →
  `IdbAssetPack.fromProject`; absent → existing zip flow.
- `apps/game/src/editor-bridge.ts` — message listener for
  `switch-scene`, `scene-changed`, `pause`, `resume`, `reset`.
  Posts `ready` + `scene-loaded` + `error`.
- Engine API additions: `Game.loadScene(path)`,
  `Game.reloadScene(path)`. Both go through `pack.scene(path)` so
  IDB reads are fresh.
- `EditorViewport` rewritten — iframe + postMessage replaces
  canvas + `Game()`.
- Edit→Play handoff posts `scene-changed` before showing the
  iframe.
- Editor dev server proxies `/play/*` to the staged game runner.
- GridEditor typecheck errors fixed.
- Existing `?pack=URL` flow still works (verified manually +
  smoke tests pass).

### I2 — telemetry + camera marker + pause-step (partial)

- ✅ Engine stats telemetry — iframe posts throttled `engine-stats`
  ({ fps, frameMs, entityCount, lightCount, … }) at 10 Hz via
  `apps/game/src/editor-bridge.ts` so the editor's Playtest panel
  can render a stable HUD. Resolves Q5 of `EDITOR_REDESIGN.md` §12.
- ⏳ Iframe posts throttled `player-state` (~10 Hz). Editor draws a
  marker on GridEditor in edit mode.
- ⏳ `set-mode {edit-camera}` puts the engine in a "free-fly camera"
  state that ignores `PlayerInput`. Editor's GridEditor can
  reposition the player by drag-and-drop while in edit mode.
- ⏳ `pause` / `resume` semantics for editor stepping.

### I3 — script + manifest hot-reload (future)

- esbuild-wasm worker in editor. On `.tsx` save, compile, write
  to IDB next to the source (or under `__compiled__/`).
- `IdbAssetPack.scripts()` reads compiled output.
- `script-changed` message triggers in-engine module re-import
  via Blob URL, calling the new script's setup against the live
  ModAPI. Existing pack-side systems would need a teardown hook
  (`api.onTeardown(...)`) which is its own design item.
- Manifest hot-reload — diff old vs new manifest, mutate only
  what changed (tile presets re-resolve, shader re-link).

---

## 13. Open questions

1. **Pointer-lock release on mode toggle.** When the user presses
   Tab to enter Edit mode, the iframe still holds pointer lock
   (engine captured it on canvas click). Browsers tie pointer lock
   to the active element; the iframe doesn't release it just
   because it gets `display: none`. Mitigation: send a `pause`
   message before hiding the iframe — engine releases pointer lock
   in response. Verify in I1.
2. **Iframe focus theft.** When the iframe is focused, the parent
   doesn't see key events. Editor-side hotkeys (Save, Undo) need
   to either bind via `iframe.contentWindow`'s `keydown` (via
   postMessage relay) or rely on the iframe defocusing. I1 punts
   — the user clicks outside the iframe to defocus before using
   editor hotkeys.
3. **GridEditor's player-position marker (I2).** The
   `player-state` channel is throttled but still chatty. ~10 Hz is
   the planned cap; below that the marker stutters, above it the
   message queue can back up. Verify with real usage in I2.
4. **Edit-time scene mutations propagating to running engine.**
   Today the editor saves on debounce; the iframe doesn't see the
   change until a `scene-changed` message OR mode switch. Should
   live painting in Edit mode push deltas in real-time? Out of
   scope for I1 (Edit mode hides the iframe so it doesn't matter
   for the I1 UX), reconsider when I2 introduces edit-camera.
5. **Multi-iframe scenarios.** Two editor tabs editing the same
   project simultaneously? Editor design says single-tab; if we
   relax that the IDB-write semantics need `BroadcastChannel`
   coordination so the second tab's iframe knows when the first
   tab saved. Not I1.
6. **Storage quota.** Same-origin IDB has finite quota; opening
   the editor while the docs site has already cached the game's
   pack zip in cache storage could compete. Unmeasured.

---

## 14. Acceptance criteria — I1 (✅ met in commit `ab9dbee`)

- `bun run typecheck` passes workspace-wide.
- `cd apps/editor && bun run typecheck` passes.
- `bun run build-packs` produces a working `default.apg`.
- `bun run build` (game runner) produces `apps/game/dist/index.html`
  that, opened with `?pack=/packs/default.apg`, plays the game.
- `cd apps/editor && bun run build` produces a static editor build.
- Opening the editor → creating a project → opening the project →
  iframe boots → ready message received → scene visible.
- Switching scenes in the project view → iframe receives
  `switch-scene` → engine swaps without iframe reload.
- Editing the scene in GridEditor → Play → engine sees edits.

---

## 15. Beyond I3 — directions worth tracking

- **Editor as a pack-chain consumer.** The editor itself could ship
  as a pack (`?source=editor` becomes `?pack=editor-runtime.apg`).
  Lets users develop the editor's own UI inside the editor. Far
  future.
- **Iframe → editor screenshot endpoint.** For pack thumbnails on
  the home screen, the iframe captures `canvas.toDataURL()` on
  demand. Trivial; defer until the home screen needs thumbnails.
- **Web Worker engine.** If iframe-rendering proves CPU-heavy in
  the editor's chrome layout, an OffscreenCanvas-based worker
  engine could relieve the editor's main thread. Almost certainly
  premature.
