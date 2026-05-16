import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PackManifest } from "@two_5_d/engine";

/**
 * IDB-backed project store for the in-browser editor.
 *
 * Schema mirrors `docs/plans/EDITOR.md` §4.1 + §4.2: one shared DB
 * named `two_5_d_editor` with three object stores — `projects`,
 * `manifests`, `assets`. The fourth store described in §4.2
 * (`bakeCache`) lands with the bake button in **E4** and is not
 * created here yet; future migrations can add it without touching
 * the others.
 *
 * Composite keys: `assets` is keyed by `[projectId, path]` so a
 * single keyRange + cursor can iterate every asset belonging to a
 * project (used by `listAssets` + `deleteProject`).
 *
 * Public API per the E1 spec:
 *   listProjects / createProject / renameProject / deleteProject
 *   loadManifest / saveManifest
 *   loadAsset / saveAsset / deleteAsset / listAssets
 */

const DB_NAME = "two_5_d_editor";
const DB_VERSION = 1;

/**
 * Sidecar DB for AE1's sprite-source authoring metadata.
 *
 * Per `docs/plans/ANIMATION_EDITOR.md` §7.1 the metadata is editor-
 * only (never exported), so its lifecycle is decoupled from the
 * project DB. Why a sidecar instead of bumping the main DB to v2?
 *
 *   The engine reads the same `two_5_d_editor` DB via
 *   `IdbAssetPack.fromProject` (in `packages/engine`) at a constant
 *   `DEFAULT_EDITOR_DB_VERSION = 1`. Bumping our open to v2 would
 *   force the engine's v1 open to fail with a downgrade error.
 *   Splitting authoring metadata into its own DB keeps the wire
 *   contract with the engine untouched.
 *
 * Single-store schema; no migrations expected until AE2.
 */
const ANIM_DB_NAME = "two_5_d_editor_animation";
const ANIM_DB_VERSION = 1;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  /** Pack id this project was forked from, if any (store path; §9.2). */
  sourcePackId?: string;
  /**
   * Free-form provenance stamp for URL imports (§9.4). Stored
   * alongside the project meta rather than inside the manifest to
   * keep the manifest a clean export artifact.
   */
  forkedFrom?: {
    url?: string;
    id?: string;
    version?: string;
    hash?: string;
    openedAt: string;
  };
}

export interface ManifestRow {
  id: string; // manifestId — same as projectId for E1 (1:1)
  projectId: string;
  json: PackManifest;
}

export type AssetKind = "text" | "blob";

export interface AssetRow {
  projectId: string;
  path: string;
  kind: AssetKind;
  body: string | Blob;
  updatedAt: number;
  sizeBytes: number;
}

export interface AssetMeta {
  path: string;
  kind: AssetKind;
  sizeBytes: number;
  updatedAt: number;
}

/**
 * Authoring metadata for an editor-baked sprite — per
 * `docs/plans/ANIMATION_EDITOR.md` §7.1. Stored alongside the project
 * in IDB but explicitly NOT shipped in the `.apg`: the manifest entry
 * + the canonical sheet PNG are the engine-visible artefacts; this
 * row exists so re-opening the sprite reproduces the editor state
 * (grid dims, per-animation cell mappings, source pointer).
 *
 * AE1 only emits `kind: "spritesheet"`. Path B (`"fbx"`) and the
 * loose-frames Path A.2 stitching (`"loose-frames"`) shape the same
 * row with extra fields when those phases land.
 */
export type SpriteSourceKind = "spritesheet" | "fbx" | "loose-frames";

export interface SpriteSourceMeta {
  projectId: string;
  spriteId: string;
  kind: SpriteSourceKind;
  /** IDB asset path where the raw source PNG / FBX lives (e.g. `_source/zombie-source.png`). */
  sourcePath: string;
  /** Cell-grid dims authored in the editor — input shape, not output. */
  grid: {
    frameWidth: number;
    frameHeight: number;
    cols: number;
    rows: number;
    padding: number;
    offsetX: number;
    offsetY: number;
  };
  /** Default per-sprite angles count (manifest mirrors it). */
  angles: 1 | 2 | 4 | 5 | 8 | 16;
  /**
   * Per-animation cell-index lists. The author clicks cells in the
   * preview pane and the indices land here. Output layout is then
   * derived by `canonicalizeSpritesheet` — this map is the source of
   * truth for re-edits.
   */
  cellMappings: Record<string, number[]>;
  /** Per-animation runtime fields (frameDuration / loop / next / angles override). */
  animationsMeta: Record<
    string,
    {
      frameDuration: number;
      loop: boolean;
      next?: string;
      anglesOverride?: 1 | 2 | 4 | 5 | 8 | 16;
    }
  >;
  /** Optional ordered list of animation keys — preserves insertion order. */
  animationOrder?: string[];
  /** Last bake epoch ms. */
  bakedAt: number;
  /**
   * AE2 Path B (FBX) extension — present iff `kind === "fbx"`. Captured
   * at bake time so re-opening the sprite reproduces every config knob.
   * Per `docs/plans/ANIMATION_EDITOR.md` §7.1.
   *
   * The `sourcePath` for FBX sprites points at `_source/<id>.fbx` (the
   * raw FBX bytes, persisted to IDB as a binary asset). `grid` is still
   * populated, but reflects the OUTPUT cell size since the FBX has no
   * notion of input cells; `cols`/`rows` mirror the per-axis cell count
   * that landed in the canonical sheet.
   */
  fbx?: {
    /** Author-authored rotation applied to the model before rendering, in radians. */
    forwardRotation: { x: number; y: number; z: number };
    /** Camera elevation above horizon in radians (default ~0.14 ≈ 8°). */
    cameraElevation: number;
    /** Output cell size in pixels (mirrored into `grid.frameWidth`/`frameHeight`). */
    cellSize: number;
    /** Per-output-animation frame count, keyed by manifest animation name. */
    framesPerAnimation: Record<string, number>;
    /**
     * Map from FBX clip name → output animation name. The editor uses
     * this to surface the rename mapping; on bake the engine-visible
     * animation key is the value, not the key.
     */
    clipMapping: Record<string, string>;
    /** Subset of FBX clip names the author opted into baking. */
    enabledClips: string[];
    /**
     * Render controls — applied identically to the live preview and
     * the offscreen bake so the spritesheet matches what the author
     * sees. Optional for backwards compatibility with FBX sprites
     * baked before R-block landed; consumers should fall back to
     * `DEFAULT_FBX_RENDER_META` when absent.
     */
    render?: FbxRenderMeta;
  };
}

/**
 * Render-pipeline knobs for an FBX bake. Persisted inside
 * `SpriteSourceMeta.fbx.render` so re-opening a sprite restores the
 * lighting + tone setup. The same shape is consumed by both the live
 * preview in `FbxImporter.tsx` and the offscreen bake in
 * `fbxBaker.ts` so the spritesheet output matches the viewport pixel-
 * for-pixel (modulo orbit camera vs canonical angle camera).
 */
export interface FbxRenderMeta {
  /** Ambient light intensity (0..2). Drives `THREE.AmbientLight`. */
  ambient: number;
  /** Key (directional) light intensity (0..2). */
  keyIntensity: number;
  /** Preset for key-light direction relative to the model. */
  keyDirection: "front" | "side" | "back" | "overhead";
  /** Fill light intensity (0..1). Soft directional from the opposite side. */
  fillIntensity: number;
  /** Background — transparent for engine sprites, solid for QA renders. */
  background:
    | { kind: "transparent" }
    | { kind: "solid"; color: string };
  /**
   * Lit (use FBX materials with Three's default phong/standard
   * shading) vs flat (replace with MeshBasicMaterial — retro unlit).
   */
  tone: "lit" | "flat";
  /**
   * Toggle shadow casting + receiving on the FBX root. Cheap; just
   * flips `renderer.shadowMap.enabled` + `castShadow` / `receiveShadow`.
   */
  shadow: boolean;
}

/**
 * Documented defaults — also used by `defaultFbxBakeConfig` so a
 * freshly-loaded FBX renders with sensible lighting before the author
 * touches any knob. Existing FBX bakes without persisted render meta
 * fall back to these so re-opening an old sprite still looks lit.
 */
export const DEFAULT_FBX_RENDER_META: FbxRenderMeta = {
  ambient: 0.5,
  keyIntensity: 1.0,
  keyDirection: "front",
  fillIntensity: 0.3,
  background: { kind: "transparent" },
  tone: "lit",
  shadow: false,
};

interface EditorDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectMeta;
    indexes: { byModifiedAt: number };
  };
  manifests: {
    key: string;
    value: ManifestRow;
    indexes: { byProjectId: string };
  };
  assets: {
    key: [string, string]; // [projectId, path]
    value: AssetRow;
    indexes: { byProjectId: string };
  };
}

/**
 * Sidecar DB schema — see the `ANIM_DB_NAME` comment for the rationale
 * behind the split. One store keyed by `[projectId, spriteId]` so a
 * `byProjectId` range scan can list every sprite owned by a project.
 */
interface AnimDB extends DBSchema {
  spriteSources: {
    key: [string, string]; // [projectId, spriteId]
    value: SpriteSourceMeta;
    indexes: { byProjectId: string };
  };
}

/**
 * Decides text-vs-blob for an asset path based on its extension.
 * Mirrors `EDITOR.md` §9.1 / §9.4 import logic — also exported so
 * the import pipeline can share it. Anything not in the text set is
 * treated as a binary blob.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "json",
  "jsonc",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "txt",
  "md",
  "mdx",
  "glsl",
  "frag",
  "vert",
  "html",
  "css",
  "csv",
  "xml",
  "yaml",
  "yml",
]);

export function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function makeProjectId(): string {
  // crypto.randomUUID is GA in every browser the editor targets.
  // Falls back to a Math.random-derived id only if (impossibly) absent.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `proj-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function newManifest(name: string): PackManifest {
  return {
    name,
    version: "0.1.0",
    engine: "*",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
  };
}

let cachedDB: Promise<IDBPDatabase<EditorDB>> | null = null;
let cachedAnimDB: Promise<IDBPDatabase<AnimDB>> | null = null;

function getAnimDB(): Promise<IDBPDatabase<AnimDB>> {
  if (!cachedAnimDB) {
    cachedAnimDB = openDB<AnimDB>(ANIM_DB_NAME, ANIM_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("spriteSources")) {
          const spriteSources = db.createObjectStore("spriteSources", {
            keyPath: ["projectId", "spriteId"],
          });
          spriteSources.createIndex("byProjectId", "projectId");
        }
      },
    });
  }
  return cachedAnimDB;
}

function getDB(): Promise<IDBPDatabase<EditorDB>> {
  if (!cachedDB) {
    cachedDB = openDB<EditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("projects")) {
          const projects = db.createObjectStore("projects", { keyPath: "id" });
          projects.createIndex("byModifiedAt", "modifiedAt");
        }
        if (!db.objectStoreNames.contains("manifests")) {
          const manifests = db.createObjectStore("manifests", { keyPath: "id" });
          manifests.createIndex("byProjectId", "projectId");
        }
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", {
            keyPath: ["projectId", "path"],
          });
          assets.createIndex("byProjectId", "projectId");
        }
      },
    });
  }
  return cachedDB;
}

/**
 * For tests: lets a smoke script inject `fake-indexeddb`'s `openDB`
 * shim before the first real call. No-op in browsers.
 */
export function _resetDBCache(): void {
  cachedDB = null;
  cachedAnimDB = null;
}

function sizeOf(body: string | Blob): number {
  if (typeof body === "string") {
    // Byte length of UTF-8 — close enough for the size readout, and
    // avoids constructing a TextEncoder every call.
    let bytes = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        bytes += 4;
        i += 1; // surrogate pair
      } else bytes += 3;
    }
    return bytes;
  }
  return body.size;
}

export const EditorProjectStore = {
  /** Project metadata, newest-first. */
  async listProjects(): Promise<ProjectMeta[]> {
    const db = await getDB();
    const all = await db.getAll("projects");
    return all.sort((a, b) => b.modifiedAt - a.modifiedAt);
  },

  async getProject(id: string): Promise<ProjectMeta | null> {
    const db = await getDB();
    return (await db.get("projects", id)) ?? null;
  },

  /**
   * Create an empty project with a minimal manifest. Returns the
   * fresh `ProjectMeta`. The manifest's `startScene` field points at
   * a non-existent path — the caller is expected to add scenes
   * before opening the project in Play mode (E2).
   */
  async createProject(name: string): Promise<ProjectMeta> {
    const db = await getDB();
    const now = Date.now();
    const id = makeProjectId();
    const meta: ProjectMeta = { id, name, createdAt: now, modifiedAt: now };
    const manifest = newManifest(name);
    const tx = db.transaction(["projects", "manifests"], "readwrite");
    await tx.objectStore("projects").put(meta);
    await tx.objectStore("manifests").put({ id, projectId: id, json: manifest });
    await tx.done;
    return meta;
  },

  async renameProject(id: string, name: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["projects", "manifests"], "readwrite");
    const projects = tx.objectStore("projects");
    const manifests = tx.objectStore("manifests");
    const meta = await projects.get(id);
    if (!meta) throw new Error(`renameProject: no project ${id}`);
    meta.name = name;
    meta.modifiedAt = Date.now();
    await projects.put(meta);
    const manifestRow = await manifests.get(id);
    if (manifestRow) {
      manifestRow.json.name = name;
      await manifests.put(manifestRow);
    }
    await tx.done;
  },

  /**
   * Delete a project plus every manifest + asset belonging to it.
   * Uses a single transaction across all three stores so a partial
   * failure can't leave dangling rows.
   */
  async deleteProject(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(
      ["projects", "manifests", "assets"],
      "readwrite",
    );
    const assets = tx.objectStore("assets");
    const idx = assets.index("byProjectId");
    // Cursor-walk and delete by primary key. `IDBKeyRange.bound` on
    // the composite primary key is theoretically tighter, but
    // walking the index is simpler and the asset counts at editor
    // scale (hundreds, not millions) make it equivalent in cost.
    for await (const cursor of idx.iterate(IDBKeyRange.only(id))) {
      await cursor.delete();
    }
    const manifests = tx.objectStore("manifests");
    const mIdx = manifests.index("byProjectId");
    for await (const cursor of mIdx.iterate(IDBKeyRange.only(id))) {
      await cursor.delete();
    }
    await tx.objectStore("projects").delete(id);
    await tx.done;
    // Also cascade into the animation sidecar DB. Separate
    // transaction because the two DBs are unrelated — and the
    // sidecar may not exist yet on a fresh install (the upgrade
    // callback creates it on demand).
    const animDb = await getAnimDB();
    const animTx = animDb.transaction("spriteSources", "readwrite");
    const ssIdx = animTx.objectStore("spriteSources").index("byProjectId");
    for await (const cursor of ssIdx.iterate(IDBKeyRange.only(id))) {
      await cursor.delete();
    }
    await animTx.done;
  },

  async loadManifest(id: string): Promise<PackManifest | null> {
    const db = await getDB();
    const row = await db.get("manifests", id);
    return row?.json ?? null;
  },

  async saveManifest(id: string, manifest: PackManifest): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["projects", "manifests"], "readwrite");
    const manifests = tx.objectStore("manifests");
    const projects = tx.objectStore("projects");
    await manifests.put({ id, projectId: id, json: manifest });
    const meta = await projects.get(id);
    if (meta) {
      meta.modifiedAt = Date.now();
      // Keep the project name in sync with the manifest's `name` so
      // the home screen reflects renames performed inside the
      // manifest editor.
      if (manifest.name && meta.name !== manifest.name) {
        meta.name = manifest.name;
      }
      await projects.put(meta);
    }
    await tx.done;
  },

  /**
   * Upserts a project meta row directly. Used by the import
   * pipeline so it can stamp `forkedFrom` provenance alongside the
   * createdAt timestamp without a separate roundtrip.
   */
  async upsertProjectMeta(meta: ProjectMeta): Promise<void> {
    const db = await getDB();
    await db.put("projects", meta);
  },

  async loadAsset(
    id: string,
    path: string,
  ): Promise<string | Blob | null> {
    const db = await getDB();
    const row = await db.get("assets", [id, path]);
    return row?.body ?? null;
  },

  /**
   * Auto-detect text vs blob from the path's extension. Callers
   * supplying a `Blob` for a text path get text — we decode it
   * eagerly. Callers supplying a string for a binary path get a
   * blob — we wrap it.
   */
  async saveAsset(
    id: string,
    path: string,
    body: string | Blob | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    const db = await getDB();
    const isText = isTextPath(path);
    let storedBody: string | Blob;
    if (isText) {
      if (typeof body === "string") storedBody = body;
      else if (body instanceof Blob) storedBody = await body.text();
      else if (body instanceof ArrayBuffer)
        storedBody = new TextDecoder().decode(new Uint8Array(body));
      else storedBody = new TextDecoder().decode(body);
    } else {
      if (body instanceof Blob) storedBody = body;
      else if (typeof body === "string") storedBody = new Blob([body]);
      else if (body instanceof ArrayBuffer)
        storedBody = new Blob([body as ArrayBuffer]);
      else {
        // Force the Uint8Array view through `BufferSource` — TS's
        // `BlobPart` overload narrows `ArrayBufferLike` and rejects
        // the generic typed-array shape directly. Slicing into a
        // fresh `Uint8Array` over an `ArrayBuffer` keeps both lib.dom
        // and Bun's types happy.
        const u8 = body as Uint8Array;
        const ab = u8.buffer.slice(
          u8.byteOffset,
          u8.byteOffset + u8.byteLength,
        ) as ArrayBuffer;
        storedBody = new Blob([ab]);
      }
    }
    const now = Date.now();
    const row: AssetRow = {
      projectId: id,
      path,
      kind: isText ? "text" : "blob",
      body: storedBody,
      updatedAt: now,
      sizeBytes: sizeOf(storedBody),
    };
    const tx = db.transaction(["assets", "projects"], "readwrite");
    await tx.objectStore("assets").put(row);
    const projects = tx.objectStore("projects");
    const meta = await projects.get(id);
    if (meta) {
      meta.modifiedAt = now;
      await projects.put(meta);
    }
    await tx.done;
  },

  async deleteAsset(id: string, path: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["assets", "projects"], "readwrite");
    await tx.objectStore("assets").delete([id, path]);
    const projects = tx.objectStore("projects");
    const meta = await projects.get(id);
    if (meta) {
      meta.modifiedAt = Date.now();
      await projects.put(meta);
    }
    await tx.done;
  },

  async listAssets(id: string): Promise<AssetMeta[]> {
    const db = await getDB();
    const tx = db.transaction("assets", "readonly");
    const idx = tx.objectStore("assets").index("byProjectId");
    const out: AssetMeta[] = [];
    for await (const cursor of idx.iterate(IDBKeyRange.only(id))) {
      const v = cursor.value;
      out.push({
        path: v.path,
        kind: v.kind,
        sizeBytes: v.sizeBytes,
        updatedAt: v.updatedAt,
      });
    }
    await tx.done;
    return out.sort((a, b) => a.path.localeCompare(b.path));
  },

  // ---- AE1: spriteSources -------------------------------------------------
  //
  // Authoring-only metadata. Stored alongside the project but never
  // shipped — `Export/exportApg` filters this store entirely. Used by
  // the Animation editor mode to round-trip an in-progress sprite
  // (grid dims, per-animation cell-index lists, source PNG path).

  async loadSpriteSource(
    projectId: string,
    spriteId: string,
  ): Promise<SpriteSourceMeta | null> {
    const db = await getAnimDB();
    return (
      (await db.get("spriteSources", [projectId, spriteId])) ?? null
    );
  },

  async saveSpriteSource(
    projectId: string,
    spriteId: string,
    meta: SpriteSourceMeta,
  ): Promise<void> {
    const db = await getAnimDB();
    // Defensive: stamp the key fields so callers can pass partial
    // updates without re-specifying the composite key.
    const row: SpriteSourceMeta = { ...meta, projectId, spriteId };
    await db.put("spriteSources", row);
  },

  async deleteSpriteSource(
    projectId: string,
    spriteId: string,
  ): Promise<void> {
    const db = await getAnimDB();
    await db.delete("spriteSources", [projectId, spriteId]);
  },

  async listSpriteSources(projectId: string): Promise<SpriteSourceMeta[]> {
    const db = await getAnimDB();
    const tx = db.transaction("spriteSources", "readonly");
    const idx = tx.objectStore("spriteSources").index("byProjectId");
    const out: SpriteSourceMeta[] = [];
    for await (const cursor of idx.iterate(IDBKeyRange.only(projectId))) {
      out.push(cursor.value);
    }
    await tx.done;
    return out.sort((a, b) => a.spriteId.localeCompare(b.spriteId));
  },
};

export type EditorProjectStoreType = typeof EditorProjectStore;
