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
};

export type EditorProjectStoreType = typeof EditorProjectStore;
