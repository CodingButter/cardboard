/**
 * draftsStore — JSON Visual Builder VB4 sidecar IDB.
 *
 * Per `docs/plans/JSON_VISUAL_BUILDER.md` §3.3 + §10 VB4, the panel-draft
 * library lives in a SIDECAR IndexedDB database — `two_5_d_editor_visual_builder` —
 * separate from the engine's pinned-v1 `two_5_d_editor` DB. The engine
 * (cf. `apps/editor/src/lib/EditorProjectStore.ts:36`) pins
 * `DEFAULT_EDITOR_DB_VERSION = 1`; bumping the editor DB to v2 would
 * cascade through `IdbAssetPack.fromProject`'s `openDB(... 1)` open and
 * raise a downgrade error. The animation-editor (AE1) hit the same
 * coordination problem and landed on a sidecar DB; this pack follows
 * that precedent.
 *
 * Schema (single object store):
 *
 *   drafts (keyPath: "name") → { name, spec, updatedAt }
 *
 * The `name` field is both the row key and the user-visible label —
 * collisions overwrite (a Save with a duplicate name updates the row),
 * matching the behaviour every "save with name" UX in the editor
 * delivers.
 *
 * Implementation note: the pack runs inside a bundled `.apg` and the
 * `idb` library is NOT in the visual builder pack's dependency closure
 * (only `apps/editor` ships it). We use the raw `indexedDB` global so
 * the pack has zero dependency on the editor-host's libraries.
 */

import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";

export interface PanelDraftRow {
  /** User-supplied name. Doubles as the primary key. */
  name: string;
  /** The canonical panel spec — directly mirrors what `Export` writes. */
  spec: PanelSpec;
  /** Epoch-ms of the most recent save. */
  updatedAt: number;
}

const DB_NAME = "two_5_d_editor_visual_builder";
const DB_VERSION = 1;
const STORE = "drafts";

let cachedDb: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

/**
 * Open (and cache) the sidecar DB. The handle stays open for the
 * lifetime of the window — every `idb` write is just a fresh
 * transaction over the same handle.
 *
 * Errors surface to the caller with a small wrapper so consumers don't
 * have to plumb the raw `IDBOpenDBRequest.onerror` mechanics.
 */
function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "[panelBuilder] indexedDB unavailable in this environment — " +
            "draft persistence requires a browser-like host.",
        ),
      );
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => {
      cachedDb = req.result;
      // If the host closes the DB for a version upgrade originating
      // elsewhere, drop the cache so the next call re-opens.
      cachedDb.onversionchange = () => {
        try {
          cachedDb?.close();
        } catch {
          /* ignore */
        }
        cachedDb = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("[panelBuilder] indexedDB open failed"));
    };
    req.onblocked = () => {
      // Another tab is holding an older version; this should not happen
      // for v1 but we log defensively.
      // eslint-disable-next-line no-console
      console.warn(
        "[panelBuilder] indexedDB open blocked — another tab may be holding the DB.",
      );
    };
  }).finally(() => {
    opening = null;
  });
  return opening;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Reset the cached handle. Test-only hook — production callers never
 * touch this. Mirrors `EditorProjectStore._resetDBCache`.
 */
export function _resetDraftsDbCache(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      /* ignore */
    }
  }
  cachedDb = null;
  opening = null;
}

/** Save (upsert) a draft row. Stamps `updatedAt` at write time. */
export async function saveDraft(name: string, spec: PanelSpec): Promise<PanelDraftRow> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("[panelBuilder] saveDraft: name is required");
  }
  const row: PanelDraftRow = {
    name: trimmed,
    spec,
    updatedAt: Date.now(),
  };
  const db = await openDb();
  await reqAsPromise(tx(db, "readwrite").put(row));
  return row;
}

/** Load a draft by name. Returns null when missing. */
export async function loadDraft(name: string): Promise<PanelDraftRow | null> {
  const db = await openDb();
  const v = await reqAsPromise(tx(db, "readonly").get(name) as IDBRequest<PanelDraftRow | undefined>);
  return v ?? null;
}

/** Delete a draft by name. No-op when the draft doesn't exist. */
export async function deleteDraft(name: string): Promise<void> {
  const db = await openDb();
  await reqAsPromise(tx(db, "readwrite").delete(name));
}

/**
 * List every draft row, sorted by `updatedAt` descending (newest
 * first). Loaded into the Panel Library dock-panel on mount and
 * refreshed by any save/delete.
 */
export async function listDrafts(): Promise<PanelDraftRow[]> {
  const db = await openDb();
  const rows = (await reqAsPromise(
    tx(db, "readonly").getAll() as IDBRequest<PanelDraftRow[]>,
  )) ?? [];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}
