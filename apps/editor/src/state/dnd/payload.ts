/**
 * DnD payload contract — the wire format shared by every drag source
 * and drop target in the cross-window DnD subsystem.
 *
 * Design rationale lives in `docs/plans/CROSS_WINDOW_DND.md` §3.1. The
 * short version: payloads carry **references** ({kind, id}) — never
 * asset bytes — because IndexedDB is the source of truth for asset
 * content. The drop handler is expected to resolve the reference via
 * `EditorProjectStore` / `useAssetStore` once the drop lands.
 *
 * Each `SemanticAssetKind` gets its own MIME so drop zones can filter
 * via `dataTransfer.types` in `dragover` without parsing the body. A
 * `FALLBACK_MIME` (`application/json`) is also set so debugging tools
 * and cross-app drags can still see the structured payload.
 *
 * No runtime behavior changes ship in this file — it's pure typing +
 * utility surface area consumed by D2+ (useDragStore, <DropZone>,
 * useAssetStore).
 */

/**
 * The semantic taxonomy of editor assets — what a user thinks of as
 * "a script" or "a tile preset". Distinct from
 * `AssetStorageKind` in `EditorProjectStore`, which is the serialization
 * shape (`"text" | "blob"`) of an IDB asset row.
 *
 * Superset of the legacy `scene-fixtures.AssetKind` — adds `sprite`,
 * `tilePreset`, and `scene` so future panels (TilePresetPanel,
 * SceneTree, sprite browser) can express their DnD contracts without
 * extending the taxonomy later.
 *
 * See `docs/plans/CROSS_WINDOW_DND.md` §4 (AssetKind reconciliation).
 */
export type SemanticAssetKind =
  | "script"
  | "texture"
  | "sprite"
  | "sound"
  | "music"
  | "prefab"
  | "tilePreset"
  | "scene";

/**
 * The structured payload carried by every drag. Serialized with
 * `encode` into `dataTransfer` under a per-kind MIME and the
 * `FALLBACK_MIME`.
 *
 * - `v` is the schema version; bump on breaking shape changes so
 *   `decode` can refuse stale payloads.
 * - `id` is the stable id within the kind's registry (e.g. the asset
 *   row id, the prefab id, the scene id). The drop handler resolves
 *   `id` against IDB; payloads never carry content.
 * - `label` is for UX (drop preview, aria, error toasts).
 * - `origin` is a per-session window correlator — populated by
 *   `useDragStore` so cross-window drops can tell which window
 *   started the drag.
 * - `meta` is kind-specific extras (e.g. tile-preset rotation hint).
 *   Never asset bytes.
 *
 * See `docs/plans/CROSS_WINDOW_DND.md` §3.1.
 */
export interface DndPayload<K extends SemanticAssetKind = SemanticAssetKind> {
  v: 1;
  kind: K;
  id: string;
  label: string;
  origin: string;
  meta?: Record<string, unknown>;
}

/**
 * Per-kind MIME type. Drop zones filter cheaply via
 * `dataTransfer.types.includes(MIME[kind])` in `dragover` without
 * paying the cost of parsing the JSON body.
 *
 * See `docs/plans/CROSS_WINDOW_DND.md` §3.1.
 */
export const MIME = {
  script: "application/x-cardboard-script",
  texture: "application/x-cardboard-texture",
  sprite: "application/x-cardboard-sprite",
  sound: "application/x-cardboard-sound",
  music: "application/x-cardboard-music",
  prefab: "application/x-cardboard-prefab",
  tilePreset: "application/x-cardboard-tile-preset",
  scene: "application/x-cardboard-scene",
} as const satisfies Record<SemanticAssetKind, string>;

/**
 * Fallback MIME — generic JSON. Set alongside the per-kind MIME so
 * non-cardboard targets (devtools, external apps) can still observe
 * the structured payload. Drop zones in the editor prefer the
 * per-kind MIME for filtering.
 */
export const FALLBACK_MIME = "application/json";

/** Set of every per-kind MIME — used by `decode` to validate kinds. */
const SEMANTIC_KINDS: ReadonlySet<SemanticAssetKind> = new Set(
  Object.keys(MIME) as readonly SemanticAssetKind[],
);

/**
 * Serialize a payload for `dataTransfer.setData`. Round-trips through
 * `decode` losslessly.
 */
export function encode(p: DndPayload): string {
  return JSON.stringify(p);
}

/**
 * Parse a raw string from `dataTransfer.getData`. Returns `null` on
 * any failure — malformed JSON, missing fields, version mismatch,
 * unknown kind — so callers never have to wrap calls in try/catch.
 *
 * Validation rules:
 *   - JSON parses to a plain object.
 *   - `v === 1` (schema version pin).
 *   - `kind` is a known `SemanticAssetKind`.
 *   - `id`, `label`, `origin` are strings.
 *   - `meta` is either absent or a plain object.
 */
export function decode(raw: string): DndPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) return null;
  if (typeof p.kind !== "string") return null;
  if (!SEMANTIC_KINDS.has(p.kind as SemanticAssetKind)) return null;
  if (typeof p.id !== "string") return null;
  if (typeof p.label !== "string") return null;
  if (typeof p.origin !== "string") return null;
  if (
    p.meta !== undefined &&
    (p.meta === null || typeof p.meta !== "object" || Array.isArray(p.meta))
  ) {
    return null;
  }
  return {
    v: 1,
    kind: p.kind as SemanticAssetKind,
    id: p.id,
    label: p.label,
    origin: p.origin,
    meta: p.meta as Record<string, unknown> | undefined,
  };
}

/**
 * Write a payload into a `DataTransfer` for `onDragStart`. Sets both
 * the per-kind MIME and `FALLBACK_MIME` so drop zones can filter by
 * kind while still leaving a generic JSON envelope for external
 * observers. Always sets `effectAllowed = "link"` — every cardboard
 * drag is a reference, never a copy/move of asset bytes.
 */
export function writeDataTransfer(dt: DataTransfer, p: DndPayload): void {
  const body = encode(p);
  dt.setData(MIME[p.kind], body);
  dt.setData(FALLBACK_MIME, body);
  dt.effectAllowed = "link";
}

/**
 * Read a payload from a `DataTransfer` in `onDrop`. Walks `accepts`
 * in order, returning the first payload whose per-kind MIME is
 * present and decodes cleanly. Returns `null` if no accepted MIME is
 * present or the body fails validation.
 *
 * Drop zones use the `accepts` list as the single source of truth for
 * filtering; MIMEs are derived from it so callers never name MIME
 * strings directly.
 */
export function readDataTransfer(
  dt: DataTransfer,
  accepts: readonly SemanticAssetKind[],
): DndPayload | null {
  const types = dt.types;
  for (const kind of accepts) {
    const mime = MIME[kind];
    let present = false;
    // `DataTransferItemList`'s `types` is `DOMStringList`-ish in older
    // engines; iterate defensively rather than relying on `.includes`.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === mime) {
        present = true;
        break;
      }
    }
    if (!present) continue;
    const raw = dt.getData(mime);
    if (!raw) continue;
    const decoded = decode(raw);
    if (decoded && decoded.kind === kind) return decoded;
  }
  return null;
}

/**
 * Classify an asset path into a `SemanticAssetKind`. Mirrors the
 * folder-prefix heuristics in `classifyAssetPath` (see
 * `apps/editor/src/state/useFileIndex.ts`), but returns the semantic
 * taxonomy used by DnD instead of the file-index taxonomy. Paths
 * outside the known folders return `"other"`.
 *
 * Folder layout (matches the editor's project conventions):
 *   - `scenes/`     → `"scene"`
 *   - `scripts/`    → `"script"`
 *   - `sprites/`    → `"sprite"`
 *   - `textures/`   → `"texture"`
 *   - `sounds/`     → `"sound"`
 *   - `music/`      → `"music"`
 *   - `prefabs/`    → `"prefab"`
 *   - `tile-presets/` → `"tilePreset"`
 *   - anything else (including `manifest.json`) → `"other"`
 */
export function classifySemanticKind(
  path: string,
): SemanticAssetKind | "other" {
  if (path.startsWith("scenes/")) return "scene";
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("sprites/")) return "sprite";
  if (path.startsWith("textures/")) return "texture";
  if (path.startsWith("sounds/")) return "sound";
  if (path.startsWith("music/")) return "music";
  if (path.startsWith("prefabs/")) return "prefab";
  if (path.startsWith("tile-presets/")) return "tilePreset";
  return "other";
}
