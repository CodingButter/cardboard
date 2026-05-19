# Cross-Window Drag-and-Drop Subsystem — Plan

## 1. Overview / Goals

The Cardboard editor uses dockview, which can pop any panel into its own
browser window — same origin, separate JS context, separate React tree,
separate Zustand instance. DnD must work seamlessly across these
boundaries because **day-one user flows depend on it**: dragging scripts
onto Script Component slots, tile presets into MapCanvas cells, prefabs
into the scene tree, audio assets into sound triggers.

The hard constraint shaping this design: **IndexedDB is the source of
truth for project asset content.** `EditorProjectStore` writes;
`IdbAssetPack` reads. Pack export and playtest both read from IDB.
Therefore:

- Drag payloads carry **references** (`{kind, id}`), not asset bytes —
  the drop handler resolves the reference from IDB.
- The new `useAssetStore` is a **reactive view over IDB**, NOT a
  `createSyncedStore` (LocalStorage's 5–10 MB origin cap rules out asset
  content there).
- `useDragStore` IS a `createSyncedStore` — it tracks small UI state
  (current-drag descriptor), perfect for the LS + BroadcastChannel
  pattern.

The subsystem ships in slices so a minimum viable layer **unblocks
Wave 3.3 panel migrations** — every panel that becomes a drag source or
drop target should be migrated once, not twice.

## 2. Architecture

```
┌─────────────────────── Window A (Orchestrator) ─────────────────────────┐
│                                                                          │
│  AssetReferencesPanel (drag source)                                      │
│    │                                                                     │
│    │ onDragStart                                                         │
│    ▼                                                                     │
│  dataTransfer.setData("application/x-cardboard-script", JSON)            │
│  useDragStore.startDrag({kind:"script", id, label})                      │
│    │                                                                     │
│    ├── persist  → localStorage["cardboard.sync.drag"]                    │
│    │             → storage event fires in Window B                       │
│    │                                                                     │
│    └── broadcast → BroadcastChannel "cardboard:drag" (ephemeral lane)    │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────── Window B (Popout) ───────────────────────────────┐
│                                                                          │
│  useDragStore rehydrates from storage event                              │
│    │                                                                     │
│    ▼                                                                     │
│  <DropZone accepts={["script"]}>  ←── reads useDragStore.currentDrag     │
│    visual: idle / valid-hover / invalid-hover                            │
│    │                                                                     │
│    │ user moves mouse INTO this window, dragover, drop                   │
│    ▼                                                                     │
│  dataTransfer.getData("application/x-cardboard-script") → JSON           │
│  onDrop(payload) →                                                       │
│     1. assetStore.read(payload.id)        (READ IDB)                     │
│     2. assetStore.linkToSlot(entityId, slotId, payload.id)  (WRITE IDB)  │
│     3. EditorProjectStore.saveAsset(...)  →  IDB row updated             │
│     4. assetStore.notifyChange(payload.id) → BroadcastChannel            │
│        "cardboard:assets" {kind:"changed", id}                           │
│  useDragStore.endDrag()                                                  │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
       Every window (A, B, …) listening on "cardboard:assets"
       invalidates its in-memory snapshot for id `payload.id`
       and re-reads from IDB. Selectors rerun, UI refreshes.
```

**Linchpin assumption:** native HTML5 DnD works across same-origin popped
windows because dockview opens popouts via `window.open` — they're real
browser windows in the same tab tree. The OS surfaces a single drag
session that traverses both windows; `dataTransfer` is carried with it.
**Must be verified in D2 smoke test.**

## 3. Per-Piece Spec

### 3.1 Payload contract

**File:** `apps/editor/src/state/dnd/payload.ts` (new)

```ts
// All semantic asset kinds — see §4 (AssetKind reconciliation).
export type SemanticAssetKind =
  | "script" | "texture" | "sprite"
  | "sound"  | "music"   | "prefab"
  | "tilePreset" | "scene";

export interface DndPayload<K extends SemanticAssetKind = SemanticAssetKind> {
  v: 1;                  // schema version — bump for breaking shape changes
  kind: K;
  id: string;            // stable id within the kind's registry
  label: string;         // human label for previews / aria
  origin: string;        // window correlator (random per session)
  meta?: Record<string, unknown>;  // kind-specific extras (never asset bytes)
}

// Per-kind MIME so drop zones filter cheaply via dataTransfer.types.
export const MIME = {
  script:     "application/x-cardboard-script",
  texture:    "application/x-cardboard-texture",
  sprite:     "application/x-cardboard-sprite",
  sound:      "application/x-cardboard-sound",
  music:      "application/x-cardboard-music",
  prefab:     "application/x-cardboard-prefab",
  tilePreset: "application/x-cardboard-tile-preset",
  scene:      "application/x-cardboard-scene",
} as const satisfies Record<SemanticAssetKind, string>;

export const FALLBACK_MIME = "application/json";

export function encode(p: DndPayload): string;
export function decode(raw: string): DndPayload | null;
export function writeDataTransfer(dt: DataTransfer, p: DndPayload): void;
export function readDataTransfer(
  dt: DataTransfer,
  accepts: readonly SemanticAssetKind[],
): DndPayload | null;
```

**Key invariants**
- Payloads carry IDs ONLY. No asset bytes, no Blob URLs, no serialized
  scripts.
- Each kind has its own MIME so `dragover` can filter via
  `accepts.some(k => dt.types.includes(MIME[k]))` without parsing.
- Native HTML5 `dataTransfer` is structure-cloned across same-origin
  windows. Fallback path: derive payload from `useDragStore` if the OS
  drag session loses `dataTransfer` somehow.

### 3.2 `useDragStore`

**File:** `apps/editor/src/state/useDragStore.ts` (new)

```ts
export interface DragState {
  currentDrag: DndPayload | null;
  cursorWindowId: string | null; // throttled at 30 Hz
}
export interface DragActions {
  startDrag: (p: DndPayload) => void;
  endDrag: () => void;
  setCursorWindow: (id: string | null) => void;
}

export const useDragStore = createSyncedStore<DragState, DragActions>(
  "drag",
  { currentDrag: null, cursorWindowId: null },
  (set, _get, broadcast) => {
    const throttledCursor = throttle((id: string | null) => {
      broadcast({ kind: "cursor", windowId: id });
    }, 33);
    return {
      startDrag: (p) => set({ currentDrag: p }),
      endDrag:   () => set({ currentDrag: null }),
      setCursorWindow: (id) => {
        set({ cursorWindowId: id });
        throttledCursor(id);
      },
    };
  },
  { enableBroadcast: true },
);
```

**Key invariants**
- `currentDrag` is `null` between drags. Every drag-source MUST call
  `endDrag` from `onDragEnd` (fires regardless of drop success).
- Lives in LS so a window popped DURING a drag rehydrates the live drag.
- `App.tsx` startup clears stale `currentDrag` once per session
  (mitigates a crashed-mid-drag stale value).

### 3.3 `<DropZone>` primitive

**File:** `apps/editor/src/components/dnd/DropZone.tsx` (new)

```tsx
export interface DropZoneProps<K extends SemanticAssetKind> {
  accepts: readonly K[];
  onDrop: (payload: DndPayload<K>) => void | Promise<void>;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
  children: React.ReactNode | ((state: DropZoneState) => React.ReactNode);
}
export interface DropZoneState {
  isDraggingCompatible: boolean;
  isDraggingIncompatible: boolean;
  isOver: boolean;
}
```

**Visual states (Tailwind)**
- **idle**: no border treatment.
- **valid-hover** (compatible drag in flight, cursor elsewhere):
  `ring-1 ring-amber-500/40`.
- **drop-active** (compatible drag + cursor over):
  `ring-2 ring-amber-500 bg-amber-500/10`.
- **invalid-hover** (incompatible drag + cursor over):
  `ring-2 ring-red-500/50 cursor-not-allowed`.

**Handlers**
- `onDragOver`: `preventDefault()` ONLY if any MIME in `accepts` is in
  `dataTransfer.types`. Sets `dropEffect = "link"`.
- `onDragEnter` / `onDragLeave`: track `isOver` with child-containment
  guard.
- `onDrop`: `preventDefault()`; `readDataTransfer(dt, accepts)`; on null
  fall back to `useDragStore.getState().currentDrag` and re-validate.

**Key invariants**
- `accepts` is the single source of truth for filtering. MIMEs derived.
- The drop handler is the ONLY place that calls `assetStore` writes;
  `<DropZone>` never reads IDB itself.

### 3.4 `useAssetStore` — IDB-backed reactive view

**File:** `apps/editor/src/state/useAssetStore.ts` (new)

This is the trickiest piece. **NOT** `createSyncedStore`. Thin Zustand
store backed by IDB reads + a `BroadcastChannel("cardboard:assets")`
invalidation bus. Inspired by `useFileIndex.ts` but generalized.

```ts
export interface AssetEntry {
  id: string;
  kind: SemanticAssetKind;
  path: string;
  label: string;
  storageKind: "text" | "blob";
  sizeBytes: number;
  updatedAt: number;
}
interface AssetStoreState {
  byId: Map<string, AssetEntry>;
  byKind: Map<SemanticAssetKind, Set<string>>;
  loaded: boolean;
  projectId: string | null;
}
interface AssetStoreActions {
  reload: (projectId: string) => Promise<void>;
  invalidate: (id: string) => Promise<void>;
  linkToSlot: (entityId: string, slotId: string, assetId: string) => Promise<void>;
  paintCell: (cell: CellCoord, layerId: string, tilePresetId: string) => Promise<void>;
  loadText: (id: string) => Promise<string>;
  loadBlob: (id: string) => Promise<Blob>;
}
```

**IDB integration approach — extend, don't replace**

- `EditorProjectStore` stays the canonical writer. `useAssetStore` does
  NOT reach into IDB directly; it calls `EditorProjectStore.listAssets /
  loadAsset / saveAsset / deleteAsset`.
- Three additions on `EditorProjectStore`:
  1. `saveAsset` posts `{kind:"changed", id}` on `cardboard:assets` after
     commit.
  2. `deleteAsset` posts `{kind:"deleted", id}`.
  3. New `saveManifestFragment(projectId, patch)` for `linkToSlot`'s
     atomic manifest+asset write path.
- A new module `apps/editor/src/state/dnd/assetBus.ts` owns the
  BroadcastChannel. `EditorProjectStore` imports the publisher;
  `useAssetStore` imports the subscriber. No circular deps.
- `IdbAssetPack` is engine-side and remains read-only; engine listens on
  the same channel via a thin adapter
  (`packages/engine/src/AssetPack/assetBus.ts`) so the game runner
  invalidates its cached path index on writes.

**Cross-window IDB invalidation mechanism — hybrid**

| Mechanism | Used for | Why |
|---|---|---|
| `BroadcastChannel("cardboard:assets")` | Per-id change notifications | Low-latency, structured payload, no LS pollution. |
| `localStorage["cardboard.assets.epoch"]` (monotonic) | Late-joiner detection | Popout opened AFTER a write doesn't see the broadcast. On mount, `useAssetStore` reads epoch; if higher than last-seen, full `reload()`. |
| Per-entry `updatedAt` from IDB row | Stale-read detection | Selectors compare timestamps without flooding broadcasts. |

**Selector hooks**

```ts
useAssetsByKind(kind: SemanticAssetKind): AssetEntry[]
useAsset(id: string | null): AssetEntry | null
useAssetContent(id: string, mode: "text" | "blob"): { data, status }
```

**Key invariants**
- `useAssetStore` is **never** persisted. Snapshot rebuilt from IDB on
  project load and incrementally on bus events.
- Writers go through `EditorProjectStore` — which broadcasts. Never call
  `useAssetStore` setters directly to mutate IDB.
- Store holds metadata + ids, never full content. `loadText`/`loadBlob`
  are pull-only.

## 4. AssetKind Reconciliation

Two definitions exist today:

| Source | Type | Values | Purpose |
|---|---|---|---|
| `EditorProjectStore.AssetKind` | storage | `"text" \| "blob"` | How an asset row is serialized in IDB. |
| `scene-fixtures.AssetKind` | semantic | `"texture" \| "sound" \| "music" \| "prefab" \| "script"` | UX filtering + DnD typing. |

Different layers. Plan: **rename storage; promote+expand semantic.**

1. Rename `EditorProjectStore.AssetKind` → `AssetStorageKind`.
2. Promote `scene-fixtures.AssetKind` to
   `apps/editor/src/state/dnd/payload.ts` as `SemanticAssetKind`.
   Expand to: `"texture" | "sprite" | "sound" | "music" | "prefab" |
   "script" | "tilePreset" | "scene"`.
3. `scene-fixtures.ts` re-exports `SemanticAssetKind` for back-compat
   through D2, then migrate.
4. Add `classifySemanticKind(path: string): SemanticAssetKind | "other"`
   mirroring `classifyAssetPath` in `useFileIndex.ts`.

## 5. Integration Matrix

| Panel | Role | Notes |
|---|---|---|
| `AssetReferencesPanel` | **Source** | Each row gets `draggable={true}` + `onDragStart` building payload `{kind, id, label, origin}`. Per-kind MIME set per row. |
| `TilePresetPanel` | **Source** | Each preset chip drags `{kind:"tilePreset", id}`. |
| `PrefabBrowserPanel` | **Source** | Each prefab row drags `{kind:"prefab", id}`. |
| `MapCanvasPanel` | **Target** | Canvas wraps cells in `<DropZone accepts={["tilePreset","prefab"]}>`. Resolves cell coords from drop event. |
| `EntityInspector` (Wave 3.3+) | **Target** | Script component slot: `accepts={["script"]}`. Sound trigger: `["sound","music"]`. Texture overrides: `["texture"]`. |
| `LayersPanel` | **Target (deferred)** | Drop-onto-layer reorders. Reuses primitive with `"layer"` MIME (sibling taxonomy). |
| `SceneTree` (post-3.3) | **Both** | Drag entity nodes; drop prefab to instantiate; drop script to attach. |
| `NotesPanel` | Neither | No DnD surface. |
| `CellInspectorPanel` | **Target (deferred)** | Drop texture/preset onto an individual cell's face slot. |
| `BrushPanel` | **Target** | Drop a tile preset to set the active brush kind+preset — shortcut. |
| `AudioTriggers` (future panel) | **Target** | Reserve `MIME.sound` / `MIME.music`. |

## 6. Phased Plan

### D1 — Payload contract + AssetKind reconciliation
*Small, foundational. No runtime behavior changes.*

- Add `apps/editor/src/state/dnd/payload.ts` (MIME map, encode/decode,
  write/readDataTransfer).
- Rename `EditorProjectStore.AssetKind` → `AssetStorageKind`; update one
  engine import.
- Promote `SemanticAssetKind` to `payload.ts`; deprecate
  `scene-fixtures.AssetKind` (re-export only).
- Add `classifySemanticKind(path)` next to `classifyAssetPath`.

### D2 — `useDragStore` + cross-window smoke test

- Add `apps/editor/src/state/useDragStore.ts` (createSyncedStore,
  enableBroadcast).
- Bootstrap-clear `currentDrag` once on `App.tsx` mount.
- Smoke harness: temporary panel with draggable swatch + drop target
  rendered in popout. Verify native HTML5 DnD `setData`/`getData`
  round-trips between dockview-popped windows. **Assumption-validation
  step.** Tear down after.
- Document result in `state/README.md`.

### D3 — `<DropZone>` primitive

- Add `apps/editor/src/components/dnd/DropZone.tsx` + index export.
- Subscribes to `useDragStore`; native handlers; visual states;
  render-prop variant.
- Convert `EntityDropZonePanel` to consume `<DropZone>` for its
  native-file path.

### 🚦 GATE WAVE 3.3 AT END OF D3

At this point:
- **Sources:** any panel calls `useDragStore.startDrag(payload)` +
  `writeDataTransfer(dt, payload)` in `onDragStart`.
- **Targets:** any input wraps its UI in
  `<DropZone accepts={...} onDrop={...}>`.

The read side of `useAssetStore` is needed to **resolve** dropped IDs
into useful content, but the *contract* is stable enough that Wave 3.3
migrations can reference `EditorProjectStore` directly in the interim.
Heavy `useAssetStore` work lands **in parallel** with 3.3 migrations.

### D4 — `useAssetStore` read path + invalidation bus

- Add `apps/editor/src/state/dnd/assetBus.ts` (BroadcastChannel + epoch
  helpers).
- Add `apps/editor/src/state/useAssetStore.ts` with `reload`,
  `invalidate`, selectors, `loadText`/`loadBlob`.
- Hook `EditorProjectStore.saveAsset / deleteAsset` to publish on the
  bus.
- Hook `EditorShell` project-load path to call
  `useAssetStore.reload(projectId)`.
- Wire `IdbAssetPack` (engine) to subscribe and call `refreshPathIndex`
  on bus messages.

### D5 — `useAssetStore` write path (link / paint / instantiate)

- `linkToSlot(entityId, slotId, assetId)`: read manifest, patch the slot
  field, save manifest, broadcast.
- `paintCell(cell, layerId, tilePresetId)`: write into the active scene
  asset (delegates to `useSceneStore` for cell mutation + history;
  `useAssetStore` resolves preset id → asset row).
- `instantiatePrefab(prefabId, position)`: read prefab JSON from IDB →
  mint entity → write entity into scene asset.
- Drop handlers in 3.3-migrated panels swap from interim direct
  `EditorProjectStore` calls to these high-level methods.

### D6 — Edge cases + polish

- Drop-on-nothing → `dragend` clears `currentDrag` automatically.
- Window-closes-mid-drag → orchestrator-only `beforeunload` hook calls
  `endDrag()` if popout.
- Asset-deleted-mid-drag → drop handler always re-reads IDB by id; if
  the row is gone, toast: "Asset removed during drag". `useDragStore`
  listens on the asset bus and `endDrag`s if the dragged id was deleted.
- Esc-to-cancel → native; verify `dragend` fires.
- Cross-window cursor heatmap (nice-to-have) → use
  `useDragStore.cursorWindowId` to dim non-target windows during drag.

### D7 — Per-panel migrations (rides on Wave 3.3)

Per Integration Matrix. Each panel = one-commit change: declare source
draggable, wrap inputs in `<DropZone>`. Folded into the existing 3.3
commit cadence — no separate doc needed beyond the matrix.

## 7. Risks / Open Questions

1. **Native DnD across popped windows — verified or not?** dockview uses
   `window.open` to same-origin popouts. Chromium and WebKit maintain a
   single OS-level drag session that crosses windows in the same tab
   tree; Firefox is less consistent. The D2 smoke test is
   non-negotiable. Fallback: drag-source paints a follower div into
   every window using `useDragStore.cursorWindowId`; drops detected via
   `mouseup` + hit-test. Heavier but viable.

2. **`useDragStore` LS persistence vs ephemerality.** Persisting
   `currentDrag` is the only way a window popped DURING a drag can see
   it, but creates a stale-value risk. Recommendation: persist,
   clear-on-app-boot.

3. **`useAssetStore` vs `useFileIndex` overlap.** `useFileIndex` already
   mirrors IDB asset metadata for the command palette.
   - **Merge**: collapse into `useAssetStore`, rewrite palette's file
     mode.
   - **Layer**: keep `useFileIndex` for palette, populate from
     `useAssetStore` on bus events.
   Lean toward merge (two indices over the same IDB invites drift), but
   merge requires touching the palette → out of Wave 3.3 scope. Merge
   lands in D8.

4. **Epoch counter granularity.** Single global epoch makes every late
   popout do full `reload()`. For projects with thousands of assets,
   wasteful. Alternative: per-kind epochs. Defer — measure first.

5. **Cross-pack drag.** Out of scope. Design assumes single-project
   sessions. Multi-project DnD is future; payload `origin` field is the
   placeholder.

6. **Internal-DnD vs asset-DnD overlap.** Drag-to-reorder layers, tabs —
   reuse `<DropZone>` with different MIMEs
   (`application/x-cardboard-layer-reorder`). NOT in `SemanticAssetKind`
   — parallel taxonomy. Introduce sibling `InternalDndKind` in D6 if
   needed.

7. **Touch / mobile.** Native HTML5 DnD doesn't fire on touchscreens.
   Cardboard's editor target is desktop. Document; don't polyfill.

8. **Drop ghost preview.** Native `dataTransfer.setDragImage` is finicky
   across popouts in some browsers. Rely on per-zone visual state; skip
   custom ghost images for D-series.

## Critical Files

- `apps/editor/src/state/sync.ts`
- `apps/editor/src/lib/EditorProjectStore.ts`
- `apps/editor/src/state/useFileIndex.ts`
- `apps/editor/src/views/scene/scene-fixtures.ts`
- `packages/engine/src/AssetPack/IdbAssetPack.ts`
