import { AssetPack } from "./AssetPack";
import type { PackManifest } from "./types";

/**
 * IDB-backed pack adapter — engine-side.
 *
 * Lets the game runner construct an `AssetPack` directly against
 * the editor's IndexedDB schema, so `apps/game` can boot against
 * an in-IDB project without any editor code in its dependency tree.
 *
 * The DB layout is hard-coded to match `EditorProjectStore` in
 * `apps/editor/src/lib/EditorProjectStore.ts` (the writer side) —
 * see EDITOR.md §4.2 for the spec. The two halves form one
 * contract; if the editor's schema bumps, this file moves in
 * lock-step.
 *
 * No `idb` package dependency on purpose — the engine consumes
 * IndexedDB via the native API to keep the engine's dependency
 * surface minimal. The editor still uses `idb` for the writer
 * side (the ergonomic ergonomics matter more there).
 *
 * Construction is async (the manifest + asset-path index live in
 * IDB), so callers go through `IdbAssetPack.fromProject(projectId)`.
 * The private constructor mirrors `ZipAssetPack`'s pattern — the
 * public factory does the awaits, then hands a fully-formed pack
 * back.
 *
 * No internal caching. The engine wraps `textureBlob` results in
 * `URL.createObjectURL` at point of use and the renderer maintains
 * its own decode cache; double-caching here would just bloat
 * memory and defeat write-through invalidation when the editor
 * mutates an asset.
 */

/** Default editor DB name — matches `EditorProjectStore.DB_NAME`. */
export const DEFAULT_EDITOR_DB_NAME = "two_5_d_editor";
/** Schema version — matches the editor's `DB_VERSION`. */
export const DEFAULT_EDITOR_DB_VERSION = 1;

interface ManifestRow {
  id: string;
  projectId: string;
  json: PackManifest;
}

interface AssetRow {
  projectId: string;
  path: string;
  kind: "text" | "blob";
  body: string | Blob;
  updatedAt: number;
  sizeBytes: number;
}

/**
 * Open the editor's IDB database in read-only mode. We don't
 * declare an `upgrade` callback because the engine is strictly a
 * reader — if the DB doesn't exist or is at a different version,
 * we'd rather fail loudly than create an empty store the editor
 * never wrote to.
 */
function openEditorDB(
  dbName: string,
  dbVersion: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVersion);
    req.onerror = () => reject(req.error ?? new Error(`Failed to open ${dbName}`));
    req.onsuccess = () => resolve(req.result);
    req.onblocked = () =>
      reject(new Error(`IndexedDB open blocked: ${dbName} v${dbVersion}`));
  });
}

/** Promise-wrap an `IDBRequest` for use inside `await`. */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
    req.onsuccess = () => resolve(req.result);
  });
}

/** Load the manifest row for `projectId`. Returns `null` when missing. */
async function loadManifestRow(
  db: IDBDatabase,
  projectId: string,
): Promise<PackManifest | null> {
  const tx = db.transaction("manifests", "readonly");
  const row = await reqAsPromise(
    tx.objectStore("manifests").get(projectId) as IDBRequest<ManifestRow | undefined>,
  );
  return row?.json ?? null;
}

/**
 * Enumerate every asset path under `projectId`. Uses the
 * `byProjectId` index the editor creates so we don't have to
 * scan the entire store.
 */
async function listAssetPaths(
  db: IDBDatabase,
  projectId: string,
): Promise<string[]> {
  const tx = db.transaction("assets", "readonly");
  const idx = tx.objectStore("assets").index("byProjectId");
  const paths: string[] = [];
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.only(projectId));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(paths);
        return;
      }
      paths.push((cursor.value as AssetRow).path);
      cursor.continue();
    };
  });
}

/** Read a single asset body. Returns `null` when missing. */
async function loadAssetBody(
  db: IDBDatabase,
  projectId: string,
  path: string,
): Promise<string | Blob | null> {
  const tx = db.transaction("assets", "readonly");
  const row = await reqAsPromise(
    tx.objectStore("assets").get([projectId, path]) as IDBRequest<AssetRow | undefined>,
  );
  return row?.body ?? null;
}

export class IdbAssetPack extends AssetPack {
  readonly manifest: PackManifest;

  /** Project id this pack is bound to — used for every IDB lookup. */
  readonly projectId: string;

  /** In-memory mirror of every asset path in the project. */
  private readonly paths: Set<string>;

  /** Live DB handle — kept open for the lifetime of the pack. */
  private readonly db: IDBDatabase;

  private constructor(
    projectId: string,
    manifest: PackManifest,
    paths: Iterable<string>,
    db: IDBDatabase,
  ) {
    super();
    this.projectId = projectId;
    this.manifest = manifest;
    this.paths = new Set(paths);
    this.db = db;
  }

  /**
   * Build a pack rooted at `projectId` against the default editor
   * IDB schema (`two_5_d_editor` DB, version 1). Loads the manifest
   * + the path index in parallel; throws if the project (or its
   * manifest) doesn't exist so the caller can surface a useful
   * error instead of letting the engine fall over on an undefined
   * manifest later.
   *
   * The `dbName` / `dbVersion` overrides exist for tests — the
   * fake-indexeddb-backed smoke script can plug in a different DB
   * name to keep test runs isolated. Production callers stick with
   * the defaults.
   */
  static async fromProject(
    projectId: string,
    dbName: string = DEFAULT_EDITOR_DB_NAME,
    dbVersion: number = DEFAULT_EDITOR_DB_VERSION,
  ): Promise<IdbAssetPack> {
    const db = await openEditorDB(dbName, dbVersion);
    const [manifest, paths] = await Promise.all([
      loadManifestRow(db, projectId),
      listAssetPaths(db, projectId),
    ]);
    if (!manifest) {
      db.close();
      throw new Error(
        `IdbAssetPack.fromProject: no manifest for project ${projectId} in ${dbName}`,
      );
    }
    return new IdbAssetPack(projectId, manifest, paths, db);
  }

  /**
   * Refresh the path index from IDB. The editor mutates IDB
   * out-of-band; calling this on a `scene-changed` message picks
   * up new assets without rebuilding the pack from scratch.
   */
  async refreshPathIndex(): Promise<void> {
    const fresh = await listAssetPaths(this.db, this.projectId);
    this.paths.clear();
    for (const p of fresh) this.paths.add(p);
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  override listPaths(): string[] {
    return Array.from(this.paths);
  }

  override listPaths(): string[] {
    return Array.from(this.paths);
  }

  async textBody(path: string): Promise<string> {
    const body = await loadAssetBody(this.db, this.projectId, path);
    if (body === null) {
      throw new Error(
        `IdbAssetPack.textBody: ${path} not found in project ${this.projectId}`,
      );
    }
    if (typeof body === "string") return body;
    // The store decides text-vs-blob from the path extension; if a
    // caller asks for textBody on something stored as a blob (e.g.
    // someone manually saved a `.txt` payload as a Blob) decode it
    // here so the engine still gets a string. `Response.text()` is
    // the cheapest portable decode path on both browser + Bun.
    return new Response(body).text();
  }

  async textureBlob(path: string): Promise<Blob> {
    const body = await loadAssetBody(this.db, this.projectId, path);
    if (body === null) {
      throw new Error(
        `IdbAssetPack.textureBlob: ${path} not found in project ${this.projectId}`,
      );
    }
    if (body instanceof Blob) return body;
    // Mirror image of `textBody`'s coercion — if a caller stored a
    // string under a binary path, wrap it on the way out so the
    // engine's `URL.createObjectURL` consumer doesn't blow up.
    return new Blob([body]);
  }
}
