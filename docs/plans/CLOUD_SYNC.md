# Cloud sync — IDB-canonical authoring with Supabase as the durable backplane

A plan for evolving the editor from "IDB-only single-device" to "IDB
is the working copy, Supabase is the canonical cloud state, sync is
background and content-addressed." Projects live in IndexedDB while
authored, get pushed to Supabase as a tiny manifest row + a content-
addressed asset blob store, and rehydrate from the cloud on next
open from any browser / device.

Cross-refs: [PACK_CHAIN.md](./PACK_CHAIN.md) already speaks the
content-addressed dialect (`requires[].integrity = "sha256-..."`)
— this plan reuses the same hashes for cloud blob keys, so a project
that publishes as a pack shares bytes with itself.
[STORE.md](./STORE.md) defines the community-store schema and RLS
posture this plan extends; private projects are private packs in the
same store, "Publish" flips a visibility bit, no bytes move.
[EDITOR.md §4](./EDITOR.md) owns the IDB schema the sync layer rides
on top of; [EDITOR_REDESIGN.md §7](./EDITOR_REDESIGN.md) owns the
TopBar / StatusBar surfaces where the sync indicator and sign-in flow
land. Source-of-truth IDB code:
[apps/editor/src/lib/EditorProjectStore.ts](../../apps/editor/src/lib/EditorProjectStore.ts).
Tone reference: [MATERIALS.md](./MATERIALS.md) +
[CONSOLE.md](./CONSOLE.md).

Date: 2026-05-17.

---

## 0. tl;dr

- **IDB stays canonical for the running editor session.** Every edit
  writes IDB first, returns synchronously, and never blocks on the
  network. Nothing else changes about the local authoring loop.
- **Supabase is canonical between sessions.** When you close the
  tab and re-open on another browser, the cloud is the source of
  truth and IDB rehydrates from it.
- **Two-table cloud schema.** `projects` (one row per project,
  ~few KB of manifest + metadata) + `project_assets` (one row per
  unique blob, keyed by `sha256(bytes)`). Assets are shared across
  every project that references them — a 4 MB sprite sheet uploaded
  once is referenced from every fork at zero additional cost.
- **Delta-only sync.** On push: compare local asset hash set against
  the cloud's hash set for this project; upload only the deltas.
  Manifest pushed gzipped (~few KB). On pull: same, in reverse.
- **Cadence: idle debounce + explicit save + before-unload.** ~30s
  after the last keystroke, on Cmd-S, and on tab close. Never on
  every keystroke; the editor remains fully usable offline and
  syncs opportunistically.
- **Auth: Supabase Auth with GitHub OAuth + magic link.** Anonymous
  local-only mode is the default; signing in is required only to
  sync to cloud. Anonymous projects migrate to the signed-in user's
  account on first sign-in.
- **RLS: users own their own projects; published packs are public.**
  Same store as STORE.md, same `auth.users` table, same Postgres
  project. "Publish to store" = flip `projects.published` and copy
  the manifest into `packs` / `pack_versions` — no asset re-upload
  because the blobs already live in the content-addressed store.
- **Phased rollout CS1–CS6.** This doc is CS1. CS2 is schema +
  auth, CS3 is manifest-only sync, CS4 adds blob sync + dedupe,
  CS5 is conflict UX, CS6 is multi-device hardening.

---

## 1. Goals & non-goals

### Goals

- **Cross-device authoring.** Same project, same state, on the
  desktop browser at work and the iPad at home. Open the editor,
  sign in, your project list is there; pick one and it rehydrates.
- **Zero-friction baseline.** First-run editor must work without
  an account, just like today. Cloud sync is opt-in via "Sign in."
  Anonymous users get the IDB-only experience, no degraded UX.
- **Cheap storage at scale.** Content-addressed assets make a 50-
  project user with heavy texture reuse pay for assets once, not
  fifty times. A modder forking three packs pays for the diff,
  not the parent's bytes.
- **Aligned with packs.** A project IS a private pack. Publishing
  is a visibility flip, not a data migration. The `sha256-…`
  integrity hashes [PACK_CHAIN.md §8](./PACK_CHAIN.md) already
  uses for SRI become the cloud blob keys verbatim — same string,
  same bytes.
- **Local-first feel.** Every edit lands in IDB synchronously.
  The network is a background process the user can ignore, fail,
  retry. The UI never blocks on a sync round-trip.
- **Conflict-aware single-device MVP.** Last-write-wins suffices
  for one user with multiple devices (the dominant case for an
  authoring tool). Detect cross-device drift via timestamps and
  offer a "keep local / use cloud / view diff" modal. Real
  multi-cursor collab is CS6+ future work.

### Non-goals

- **Not realtime collab.** No CRDT, no operational transform, no
  multi-cursor presence. One user authoring a project from
  whichever device they happen to be on. Multi-author projects
  share the URL of a published pack and fork instead.
- **Not a backup service.** We don't keep version history of every
  edit. The cloud holds the current state; if a user clobbers
  their own project they need their own version control (git, manual
  duplicates). Future: optional snapshot history in CS6.
- **Not a CDN for built `.apg` files.** The community store
  ([STORE.md](./STORE.md)) owns published-pack distribution. This
  plan is about *authoring* state in the cloud; the built `.apg`
  artefact is generated at publish time and lives in the store's
  CDN layer.
- **Not a sync-engine substitute.** No "I added a tile, you added a
  texture, merge"-style conflict resolution. Concurrent edits to
  the same project from two devices = last-write-wins with a
  warning modal.
- **Not a project-sharing mechanism.** "Share this project with
  another user" requires a copy or a published pack. No "team
  workspace" semantics in v1.
- **No cloud-only mode.** Even when signed in, the editor still
  writes IDB first and reads IDB first. The cloud is a backplane,
  not the runtime store. Users with flaky connections (or offline
  entirely) author normally and queue pushes.

---

## 2. Status quo (IDB-only today)

The editor today is single-device. Projects live in IndexedDB at
`two_5_d_editor` (DB version 1) with three stores:

- `projects` — keyed by `id`, holds `ProjectMeta` (id, name,
  createdAt, modifiedAt, plus optional `sourcePackId` and
  `forkedFrom` provenance stamps).
- `manifests` — keyed by `id` (1:1 with project for now), holds
  `ManifestRow.json: PackManifest`.
- `assets` — composite-keyed by `[projectId, path]`, holds
  `AssetRow { kind: "text" | "blob", body: string | Blob,
  updatedAt, sizeBytes }`.

A sidecar DB (`two_5_d_editor_animation`, v1) holds AE1 sprite-
source authoring metadata (`SpriteSourceMeta`); it is editor-only,
never exported, and likely IDB-only forever (animation-pipeline
intermediate state, not "the project").

Source: `apps/editor/src/lib/EditorProjectStore.ts`. The store
exposes `listProjects / createProject / renameProject /
deleteProject / loadManifest / saveManifest / loadAsset /
saveAsset / deleteAsset / listAssets`. Every editor view calls
these; no other persistence path exists.

Existing pain points:

1. **No cross-device.** Open the editor in a different browser =
   empty project list. Users with multiple workstations have to
   manually export `.apg` and re-import.
2. **No durability.** A wiped browser profile = lost work. Users
   who clear cookies habitually lose everything.
3. **No "go look at my project on my phone."** The editor is
   desktop-only as a side effect, even though the runner is fine
   on mobile.
4. **Forks are inefficient.** "Fork pack" via
   [STORE.md §11.4](./STORE.md) copies every asset blob into the
   new project. With a content-addressed cloud store, fork can be
   manifest-only (the parent's blobs are already there, the fork
   just references the same hashes).

None of these are blocking — the editor works for one user with
one browser. They're the cost of staying IDB-only past a certain
point of project maturity. This plan is the lift.

---

## 3. Architecture overview

```
+-------------------------+         +---------------------------+
| Editor (apps/editor)    |         | Supabase                  |
|                         |         |                           |
| IDB: two_5_d_editor     | <-----> | projects (one row / proj) |
|   - projects            |  sync   |   manifest_json jsonb     |
|   - manifests           |         |   asset_index jsonb       |
|   - assets (blobs)      |         |                           |
|                         |         | project_assets (blobs)    |
|                         |         |   sha256 primary key      |
| sync engine:            |         |   bytes -> Storage        |
|   - debounced push      |         |                           |
|   - explicit save       |         | (RLS: owner_id = uid)     |
|   - before-unload       |         +---------------------------+
|   - pull on open                       ^
|   - delta hash diff                    |
+-------------------------+              |
                                         |
                          [STORE.md publish flow]
                                         |
                                         v
                              +---------------------------+
                              | packs / pack_versions     |
                              | (PACK_CHAIN §10 schema)   |
                              | -- public when published  |
                              +---------------------------+
```

Three subsystems:

### 3.1 Content-addressed asset store

Every asset blob (PNG, FBX, audio, JS file, JSON, …) gets
SHA-256-hashed at sync time. Cloud key is the hex hash, prefixed
by the standard `sha256-` SRI tag for parity with
[PACK_CHAIN.md §8](./PACK_CHAIN.md) `integrity` fields. Two
projects referencing the same texture both point at the same blob
row; one upload, two references, one byte of storage.

The hash is computed on the *exact bytes* the editor would serialise
into the `.apg`. For text assets this is the UTF-8 encoding; for
Blob assets it is the underlying buffer. Both paths converge on a
`Uint8Array` before hashing, so the hash is stable across the
text/blob boundary.

A `project_assets` table row holds `{ sha256, size_bytes,
content_type, created_at, ref_count }` plus a pointer into
Supabase Storage (`storage_path: text`, computed as
`"a/" + sha256.slice(0, 2) + "/" + sha256`). Storage is the actual
byte sink; Postgres is the index. `ref_count` is a denormalised
"how many projects reference this hash" counter maintained by
triggers on the `projects.asset_index` jsonb column; when it hits
zero, a periodic GC job deletes the row + the Storage object.

Garbage collection runs lazily: a `pg_cron` job once a day scans
for `project_assets` rows with `ref_count = 0 AND created_at <
NOW() - INTERVAL '7 days'` and deletes them. The 7-day grace
buffer protects against the "I deleted a project then realised I
didn't mean to" recovery scenario. Restore-from-trash within 7
days is free; after that, the blobs are gone and the project is
manifest-only (which itself is fine for most projects — re-uploading
the missing assets restores the project).

### 3.2 Project manifest row

One row per project in the `projects` table. Schema (full SQL in
§4.1):

```sql
create table projects (
  id            uuid primary key,
  owner_id      uuid references auth.users on delete cascade,
  name          text not null,
  manifest_json jsonb not null,         -- the editor's PackManifest
  asset_index   jsonb not null default '[]'::jsonb,
                                        -- [{ path, sha256, size, kind }]
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  synced_at     timestamptz default now(),
  source_pack_id text,                  -- if forked from a store pack
  forked_from   jsonb,                  -- {url,id,version,hash,openedAt}
  published     boolean default false,  -- has this been published to packs?
  published_pack_id text                 -- if published, points at packs.id
);
```

The row is small — a few KB even for projects with hundreds of
assets, because the manifest is structured JSON (no blob bytes)
and the `asset_index` is a flat list of `{path, sha256, size,
kind}` records, ~100 bytes per asset. A pathological project with
10,000 assets is still ~1 MB of jsonb, well within Postgres row
limits.

The manifest is gzipped on the wire (Supabase REST supports
`Content-Encoding: gzip` for jsonb payloads via Edge Function
proxying; alternative is to gzip ourselves and store as `bytea`).
At the storage layer Postgres TOAST-compresses jsonb anyway, so
the gzip is mostly a wire-savings move.

### 3.3 IDB ↔ cloud sync model

The sync engine is a separate module
(`apps/editor/src/lib/CloudSync.ts`, new in CS3) that:

1. **Observes IDB writes** via a thin wrapper around
   `EditorProjectStore`'s mutator methods. Every `saveAsset` /
   `saveManifest` / `renameProject` call increments a per-project
   `localDirty` counter and updates `localUpdatedAt`.
2. **Schedules a push** when `localDirty > 0` and no push is
   in-flight. Scheduling logic per §5.4 (idle debounce + Cmd-S +
   before-unload).
3. **Resolves cloud state** via a single REST call:
   `GET /rest/v1/projects?id=eq.<id>&select=updated_at,synced_at,
   asset_index`. Returns `{ updated_at, asset_index }`.
4. **Computes the delta**: local asset hashes minus cloud asset
   hashes = blobs to upload; cloud hashes minus local = blobs that
   would be referenced from cloud but aren't locally (no-op on
   push; relevant on pull).
5. **Uploads deltas** to Supabase Storage, one PUT per blob, in
   parallel with a small concurrency cap (4-6). Each PUT uses the
   `Content-MD5` header (Storage requires it for integrity) and the
   `x-amz-meta-sha256` header for cross-checking.
6. **Posts the manifest row update** (PATCH on `projects` table)
   in a single transaction, atomically updating `manifest_json`,
   `asset_index`, and `updated_at`.
7. **Marks `localDirty = 0` + `cloudSyncedAt = now`** on success.
   On failure, leaves `localDirty` non-zero and schedules a retry
   with exponential backoff.

The same engine handles pull (§5.2) — on project open, fetches the
cloud row, diffs against IDB, and downloads any missing blobs.

---

## 4. Storage schema

### 4.1 Supabase tables

```sql
-- Per-project authoring state. Sized for ~10k projects/user worst-case.
create table projects (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users on delete cascade,
  name               text not null,
  manifest_json      jsonb not null,         -- the PackManifest body
  asset_index        jsonb not null default '[]'::jsonb,
                                              -- [{ path, sha256, size, kind, updated_at }]
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  synced_at          timestamptz default now(),
  device_id          text,                    -- last device that pushed
  source_pack_id     text,                    -- forked-from pack id (STORE §11.4)
  forked_from        jsonb,                   -- editor `ProjectMeta.forkedFrom`
  published          boolean default false,
  published_pack_id  text references packs(id) on delete set null,
  size_bytes_total   bigint default 0         -- denormalised for quota
);

create index projects_owner_id_idx on projects (owner_id);
create index projects_published_pack_idx on projects (published_pack_id)
  where published = true;

-- Content-addressed blob index. One row per unique sha256.
create table project_assets (
  sha256             text primary key,        -- "abc123..." (lowercase hex, 64 chars)
  size_bytes         bigint not null,
  content_type       text,                    -- best-effort mime, NULL = octet-stream
  storage_path       text not null,           -- "a/ab/abc123..." in Storage bucket
  ref_count          int not null default 0,  -- maintained by trigger on projects
  created_at         timestamptz default now()
);

create index project_assets_ref_count_zero
  on project_assets (ref_count, created_at)
  where ref_count = 0;
-- ↑ GC index: cheap scan for ref_count=0 rows older than the grace window.

-- Per-user manifest snapshots — optional history layer, ships in CS6.
create table project_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references projects(id) on delete cascade,
  manifest_json      jsonb not null,
  asset_index        jsonb not null,
  created_at         timestamptz default now(),
  reason             text                     -- "explicit" / "auto-pre-publish" / "auto-daily"
);

create index project_snapshots_project_idx
  on project_snapshots (project_id, created_at desc);

-- Per-user quota + metadata. Soft cap, enforced in app layer.
create table user_quotas (
  user_id            uuid primary key references auth.users on delete cascade,
  storage_bytes_used bigint default 0,        -- sum of project_assets.size_bytes per owner
  storage_bytes_max  bigint default 5368709120, -- 5 GiB default
  project_count      int default 0,
  project_count_max  int default 100,
  updated_at         timestamptz default now()
);
```

The `users` table is just `auth.users` from Supabase Auth; no
shadow table needed for sync. STORE.md adds a public-profile
shadow `users` table (handle, bio, reputation) — same `id`,
joined when needed, but the sync layer doesn't read it.

#### `asset_index` jsonb shape

Each entry:

```json
{
  "path": "sprites/hero.png",
  "sha256": "a1b2c3d4...",
  "size": 4096,
  "kind": "blob",          // "text" | "blob"
  "updated_at": "2026-05-17T14:30:00Z"
}
```

The `path` is the editor-side virtual path (matches IDB
`AssetRow.path`). The `sha256` keys the blob. The `kind` lets the
editor know whether to instantiate a `Blob` or a `string` when
rehydrating into IDB. The `updated_at` is the timestamp of the
last write to that asset in the editor — used by the conflict
detector when both local and cloud have changes since `synced_at`.

### 4.2 RLS policies

```sql
alter table projects enable row level security;
alter table project_assets enable row level security;
alter table project_snapshots enable row level security;
alter table user_quotas enable row level security;

-- Projects: owner-only for read/write; admin override via STORE.md is_admin().
create policy projects_owner_select on projects for select
  using (owner_id = auth.uid() or is_admin());

create policy projects_owner_insert on projects for insert
  with check (owner_id = auth.uid());

create policy projects_owner_update on projects for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy projects_owner_delete on projects for delete
  using (owner_id = auth.uid());

-- Project assets: readable by any authenticated user (they're
-- content-addressed and we don't want to copy blobs on fork).
-- Insert allowed by any signed-in user who can prove the bytes
-- match the hash — enforced via a Postgres function below.
-- Update is server-only (ref_count maintenance). Delete is GC-only.
create policy project_assets_authn_select on project_assets for select
  using (auth.role() = 'authenticated');

create policy project_assets_authn_insert on project_assets for insert
  with check (
    auth.role() = 'authenticated'
    -- bytes verification happens in the upload pipeline (Storage,
    -- not Postgres), so insert here is just "the row appears."
  );

-- Project snapshots: same RLS as projects (cascade follows owner).
create policy project_snapshots_owner_select on project_snapshots for select
  using (
    exists (select 1 from projects p
            where p.id = project_id
              and p.owner_id = auth.uid())
    or is_admin()
  );

create policy project_snapshots_owner_insert on project_snapshots for insert
  with check (
    exists (select 1 from projects p
            where p.id = project_id
              and p.owner_id = auth.uid())
  );

-- User quotas: self-select; updates server-only via triggers.
create policy user_quotas_self_select on user_quotas for select
  using (user_id = auth.uid() or is_admin());
```

The `project_assets` posture is the interesting one. Blobs are
**readable by all signed-in users** (not just the owner) because
otherwise forking a public pack would require re-uploading all
its bytes into the fork-owner's namespace. Read access on a hash
is harmless — the hash is unguessable without knowing the bytes,
and the data is identical anyway (content-addressed). Write access
is gated only by "are you signed in," because we can't actually
enforce "your bytes match the hash you claim" at the Postgres
layer — that check happens at the Storage layer (the upload
pipeline computes the hash server-side and rejects mismatches).

Public-pack reads layer on top via the STORE.md `packs` table.
Anonymous (non-authenticated) reads of `project_assets` go through
a separate edge-function endpoint that joins through
`pack_versions.manifest.asset_index → project_assets.sha256` and
only serves blobs referenced by `published = true` packs.

### 4.3 Indexes + query patterns

The query patterns the sync engine actually issues, in order of
frequency:

| Query | Index used | Frequency |
|---|---|---|
| `SELECT id, name, updated_at FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC` | `projects_owner_id_idx` (covers via `updated_at` in jsonb…) | Home tab load |
| `SELECT manifest_json, asset_index, updated_at FROM projects WHERE id = $1 AND owner_id = $2` | PK + RLS | Project open |
| `UPDATE projects SET manifest_json = $1, asset_index = $2, updated_at = NOW(), synced_at = NOW(), device_id = $3 WHERE id = $4 AND owner_id = $5` | PK + RLS | Every push |
| `SELECT sha256, size_bytes, storage_path FROM project_assets WHERE sha256 = ANY($1)` | PK | Pre-upload dedup check (batched) |
| `INSERT INTO project_assets (...) ON CONFLICT (sha256) DO NOTHING` | PK | New blob upload |
| `UPDATE project_assets SET ref_count = ref_count + $1 WHERE sha256 = ANY($2)` | PK (batched) | After successful push (via trigger, see §4.4) |

#### Triggers

```sql
-- Maintain project_assets.ref_count from projects.asset_index changes.
create or replace function _bump_asset_refs() returns trigger as $$
declare
  old_hashes text[];
  new_hashes text[];
  added text[];
  removed text[];
begin
  old_hashes := coalesce(
    (select array_agg(value->>'sha256')
     from jsonb_array_elements(OLD.asset_index) as value),
    '{}'::text[]
  );
  new_hashes := coalesce(
    (select array_agg(value->>'sha256')
     from jsonb_array_elements(NEW.asset_index) as value),
    '{}'::text[]
  );
  added := array(select unnest(new_hashes) except select unnest(old_hashes));
  removed := array(select unnest(old_hashes) except select unnest(new_hashes));
  if cardinality(added) > 0 then
    update project_assets set ref_count = ref_count + 1
     where sha256 = any(added);
  end if;
  if cardinality(removed) > 0 then
    update project_assets set ref_count = ref_count - 1
     where sha256 = any(removed);
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger projects_assets_refcount
  after insert or update of asset_index or delete on projects
  for each row execute function _bump_asset_refs();
```

Ref-counting in a trigger keeps the source of truth in the
`projects.asset_index` array and avoids a separate `pack_refs`
join table. The trigger is per-row and per-version
(`UPDATE OF asset_index`) so most edits (manifest text-only
changes) don't fire it.

#### Storage layout

Supabase Storage bucket `project-assets`, structured:

```
project-assets/
  a/00/0012ab...               <- sha256 starts with "0012ab"
  a/00/00ff...
  a/01/0123de...
  a/ff/ffabcd...
```

The two-char shard prefix (`a/<first2>/`) keeps directory listings
sane (max ~16M objects per shard, 256 shards). Bucket policy is
public-read-no-list (anonymous can GET by full path, can't list),
so even though the Postgres RLS lets all signed-in users see the
index, the Storage GETs work for anonymous published-pack reads
too — the gating is "do you know the hash," which for published
packs is "yes, the manifest tells you."

---

## 5. Sync protocols

### 5.1 Push (IDB → cloud)

Trigger sources (§5.4): idle debounce, Cmd-S, before-unload,
explicit "Sync now" button.

Algorithm:

```pseudo
push(projectId):
  if alreadyPushing(projectId): return
  markPushing(projectId)
  try:
    // 1. Snapshot local state into a push payload.
    meta = idb.loadProjectMeta(projectId)
    manifest = idb.loadManifest(projectId)
    assets = idb.listAssets(projectId)              // [{path, kind, size, body, updatedAt}]

    // 2. Hash everything (parallel, Web Crypto API).
    hashed = await Promise.all(assets.map(a => ({
      path: a.path,
      sha256: hex(await sha256(toBytes(a.body))),
      size: a.sizeBytes,
      kind: a.kind,
      updated_at: a.updatedAt,
      body: a.body                                  // keep for upload step
    })))
    localAssetIndex = hashed.map(({body, ...rest}) => rest)
    localHashes = new Set(hashed.map(h => h.sha256))

    // 3. Conflict check (see §6).
    cloud = await supabase.from("projects")
      .select("updated_at, synced_at, asset_index, device_id")
      .eq("id", projectId)
      .maybeSingle()
    if cloud && conflictDetected(cloud, meta):
      return showConflictModal(cloud, meta)        // §6.2

    // 4. Dedup check — which hashes does the cloud already have?
    cloudExisting = await supabase.from("project_assets")
      .select("sha256")
      .in("sha256", [...localHashes])
    cloudHashes = new Set(cloudExisting.map(r => r.sha256))
    toUpload = hashed.filter(h => !cloudHashes.has(h.sha256))

    // 5. Upload missing blobs (parallel, capped concurrency).
    await uploadAssets(toUpload, { concurrency: 4 })

    // 6. Patch the project row atomically.
    await supabase.from("projects").upsert({
      id: projectId,
      owner_id: auth.user.id,
      name: meta.name,
      manifest_json: manifest,
      asset_index: localAssetIndex,
      source_pack_id: meta.sourcePackId,
      forked_from: meta.forkedFrom,
      updated_at: new Date(meta.modifiedAt).toISOString(),
      synced_at: new Date().toISOString(),
      device_id: clientDeviceId(),
    })

    // 7. Mark clean.
    idb.markSynced(projectId, { syncedAt: Date.now() })
    emit("sync:success", { projectId, uploaded: toUpload.length })

  catch err:
    emit("sync:error", { projectId, err })
    scheduleRetry(projectId)                       // expo backoff
  finally:
    unmarkPushing(projectId)
```

Notes:

- **Step 4** is the dedup pre-check. `.in("sha256", […])` with up
  to ~1000 hashes per call (Postgres `IN` limit; chunk if more).
  Returns only the hashes the cloud already has; we upload the
  complement.
- **Step 5** uploads in parallel with concurrency 4 (configurable
  via `EditorSettingsModal` → Sync tab). Each upload is a `PUT
  /storage/v1/object/project-assets/<storage_path>` with the body
  bytes. On 409 ("already exists") we treat it as success (some
  other client uploaded between our check and our PUT — fine,
  it's the same bytes by hash). On other errors we retry with
  expo backoff (3 tries, 1s/2s/4s).
- **Step 6** is one Postgres write. The trigger from §4.3 updates
  `project_assets.ref_count` and `user_quotas.storage_bytes_used`
  in the same transaction.
- The total push for "edited one cell" is: ~2 KB manifest gzip, no
  blob uploads, one row update. Round-trip: ~200ms p50, ~600ms p99.
- For "added a 4 MB texture": ~2 KB manifest, one 4 MB blob upload.
  Bottleneck is the upload, ~1-3s on broadband.

### 5.2 Pull (cloud → IDB)

Trigger sources: project open, "Refresh from cloud" button in
project menu, post-sign-in for projects newer than the local copy.

```pseudo
pull(projectId):
  // 1. Fetch cloud state.
  cloud = await supabase.from("projects")
    .select("*")
    .eq("id", projectId)
    .single()

  // 2. Fetch local state.
  local = await idb.loadProjectMeta(projectId)
  localAssets = await idb.listAssets(projectId)
  localHashes = new Set(localAssets.map(a => a.sha256))   // requires local hash cache

  // 3. Conflict check — if local is dirty and cloud changed since our last sync.
  if local && local.localDirty > 0 && cloud.updated_at > local.lastSyncedAt:
    return showConflictModal(cloud, local)

  // 4. Compute blobs to download.
  toDownload = cloud.asset_index.filter(a => !localHashes.has(a.sha256))

  // 5. Download blobs in parallel.
  await downloadAssets(toDownload, { concurrency: 4 })
  for each downloaded blob:
    await idb.saveAsset({ projectId, path: a.path, body, kind: a.kind, sizeBytes: a.size })

  // 6. Remove local-only assets (deleted on the other device).
  cloudPaths = new Set(cloud.asset_index.map(a => a.path))
  for each localAsset where !cloudPaths.has(localAsset.path):
    await idb.deleteAsset(projectId, localAsset.path)

  // 7. Replace manifest + meta atomically.
  await idb.saveManifest(projectId, cloud.manifest_json)
  await idb.saveProjectMeta(projectId, {
    id: cloud.id,
    name: cloud.name,
    modifiedAt: Date.parse(cloud.updated_at),
    sourcePackId: cloud.source_pack_id,
    forkedFrom: cloud.forked_from,
    lastSyncedAt: Date.now(),
    localDirty: 0,
  })

  emit("sync:pulled", { projectId, downloaded: toDownload.length })
```

The local hash cache (step 2) is the one trick: hashing every IDB
asset on every pull is wasteful, so we maintain
`localAssetHashes: { [path]: sha256 }` in a new IDB store
(`assetHashes`, composite-key `[projectId, path]`). Saved alongside
`saveAsset` — the hash is computed once at save time and cached.
Invalidated on save (re-hashed on next access if stale).

### 5.3 Delta hash diff

The core primitive used by both push and pull: a set diff over
SHA-256 strings. Implementation lives in
`apps/editor/src/lib/CloudSync.ts`:

```ts
function hashDiff(
  local: AssetIndexEntry[],
  cloud: AssetIndexEntry[]
): {
  toUpload: AssetIndexEntry[];      // in local, not in cloud
  toDownload: AssetIndexEntry[];    // in cloud, not in local
  toDeleteLocal: AssetIndexEntry[]; // path in local, not in cloud
  toDeleteCloud: AssetIndexEntry[]; // path in cloud, not in local — only matters if local is canonical for this sync
  modified: AssetIndexEntry[];      // same path, different hash
} {
  // ...
}
```

The push uses `{ toUpload, toDeleteCloud, modified }` (local is
canonical), the pull uses `{ toDownload, toDeleteLocal, modified }`
(cloud is canonical). The "modified" set is where the conflict-
detector triggers (§6).

### 5.4 Cadence

Four trigger sources, in order of "user-facing immediacy":

1. **Explicit save (Cmd-S / Ctrl-S).** Fires `pushNow()` —
   synchronous queue flush, returns a Promise the UI can await.
   Used by "Save" button, keyboard shortcut, and the publish flow
   (publish triggers a pre-publish push). Indicator: spinner on
   the save icon, "Synced ✓" tooltip on success.
2. **Idle debounce.** A `localDirty` counter incremented on every
   IDB write; a `setTimeout(pushDebounced, 30_000)` resets on every
   write. When 30s of inactivity elapse, fires `pushSoon()`. Most
   common path in practice. User never sees this; the StatusBar
   indicator shifts from "Editing" → "Syncing" → "Synced." Idle
   threshold configurable in EditorSettingsModal (10s / 30s / 60s
   / never).
3. **Before-unload (tab close, navigation).** A `window.beforeunload`
   handler triggers a synchronous `navigator.sendBeacon` push if
   `localDirty > 0`. `sendBeacon` doesn't block the unload but
   guarantees the request is queued. Failure modes: the manifest
   PATCH likely makes it (~2 KB beacon), the blob uploads probably
   don't (`sendBeacon` only accepts small payloads). Mitigated by
   #4 — the unloaded state is recovered on next open via pull.
4. **On focus (tab regains focus after backgrounding).** If
   `localDirty > 0` and last push was > 60s ago, fires
   `pushSoon()`. Catches the "tabbed away for an hour" case where
   the idle debounce already fired but new edits came in.

Pull cadence is simpler — only on project open and explicit
"Refresh from cloud." We don't poll. Multi-device drift is
detected lazily on next push (the conflict check sees the cloud
`updated_at` is newer than our `synced_at` and triggers §6).

The sync engine exposes a single `getSyncStatus(projectId): {
state: "synced" | "editing" | "syncing" | "error" | "offline",
lastSyncedAt: number, pendingChanges: number, error?: string }`
for the UI to render. See §8.1.

---

## 6. Conflict resolution

### 6.1 Detection (timestamps)

Three pieces of state per project, three timestamps:

| Timestamp | Lives in | Updated on |
|---|---|---|
| `localUpdatedAt` | IDB `projects.modifiedAt` | Every IDB write |
| `lastSyncedAt` | IDB `projects.lastSyncedAt` (new field) | Push success, pull success |
| `cloudUpdatedAt` | Postgres `projects.updated_at` | Push success on any device |

Conflict states:

```
localUpdatedAt <= lastSyncedAt && cloudUpdatedAt <= lastSyncedAt
  → no changes anywhere. No-op.

localUpdatedAt > lastSyncedAt && cloudUpdatedAt <= lastSyncedAt
  → only local has changes. Normal push.

localUpdatedAt <= lastSyncedAt && cloudUpdatedAt > lastSyncedAt
  → only cloud has changes (another device pushed). Pull cleanly.

localUpdatedAt > lastSyncedAt && cloudUpdatedAt > lastSyncedAt
  → BOTH have changes since last sync. CONFLICT. §6.2.
```

The detector is a one-call read (`SELECT updated_at FROM projects
WHERE id = $1`) before every push. Adds ~100ms to push but is
cheap and prevents the silent-clobber failure mode.

A more granular detector (per-asset conflict via the modified set
from §5.3) is possible and ships in CS5: even if both sides
"updated" the project, only conflicts on assets that *both sides
modified* matter. A scene-edited-locally + texture-added-cloud
project is a clean merge — keep both — not a conflict.

### 6.2 Resolution UX

Three-button modal, fires when push detects a conflict:

```
+----------------------------------------------------------+
| Sync conflict on "Dark Mod"                              |
|                                                          |
| This project was changed on another device since you     |
| last synced.                                             |
|                                                          |
|  Your changes (this device):                             |
|   - Modified: scenes/scene1.json                         |
|   - Added:    sprites/zombie.png                         |
|   Last edit: 2 minutes ago                               |
|                                                          |
|  Cloud changes (other device):                           |
|   - Modified: scenes/scene1.json                         |
|   - Added:    audio/intro.mp3                            |
|   Last sync: 5 minutes ago, from "Firefox on Linux"      |
|                                                          |
|  [ Keep local ]  [ Use cloud ]  [ View diff ]            |
+----------------------------------------------------------+
```

- **Keep local.** Force-pushes the local state. Cloud is
  overwritten. The cloud row's previous state is snapshotted into
  `project_snapshots` first (CS6 phase; until then, just a hard
  overwrite with a warning).
- **Use cloud.** Discards local changes. Pull executes. A snapshot
  of the local state is written to IDB sidecar (`projects.discarded`
  store, retained 7 days) for "wait, I needed those changes"
  recovery.
- **View diff.** Opens a side-by-side comparison modal (one tab
  per conflicting asset path). For text assets, monaco diff
  viewer (already a dependency per
  [EDITOR_REDESIGN.md Q7](./EDITOR_REDESIGN.md)). For binary
  assets, side-by-side image previews + a hash comparison + a
  "keep mine / use theirs / keep both" selector. After per-asset
  resolution, the user clicks "Apply" which constructs a merged
  state and commits.

The "view diff" path is the only one that needs per-asset granular
merge. Both "keep local" and "use cloud" are coarse and ship in
CS5. The granular merge ships in CS5.1 or later.

### 6.3 Last-write-wins for single-device MVP

For CS3 and CS4 (manifest-only sync, then asset blob sync), the
conflict-resolution behaviour is **last-write-wins with a toast**:

- Push checks `cloudUpdatedAt`. If newer than `lastSyncedAt`,
  show a toast: "This project was updated on another device since
  you last synced. Your changes will overwrite the cloud version."
  Plus a "Pull first" button that runs §5.2 instead.
- The default action is overwrite. Single-device users (the
  dominant case) get auto-sync without modal interruptions.
- Conflict modal ships in CS5 once we have real per-asset diffing.

This is the same posture VS Code and most IDE-style tools take
for cloud-settings sync — assume one user, warn on drift, give an
escape hatch. Multi-cursor authoring is a different product.

---

## 7. Authentication

### 7.1 Supabase Auth providers

Two providers enabled at the Supabase project level:

1. **GitHub OAuth.** Primary for developer-leaning audience. Wires
   into Supabase's built-in OAuth flow:
   `supabase.auth.signInWithOAuth({ provider: "github" })`.
   Redirect URL: `https://editor.two5d.example/auth/callback`. The
   `redirectTo` in the call routes back to the editor's
   `?return=<original-url>` so deep-links survive sign-in.
   Scopes: `read:user user:email` — we read the user's GitHub
   profile for display name + avatar but do NOT request `repo`
   access. Scope expansion is opt-in later (e.g., "Publish to
   GitHub Releases" feature).
2. **Magic link (email).** Fallback for non-GitHub users.
   `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo:
   "https://editor.two5d.example/auth/callback" } })`. User
   receives a one-click sign-in link; no password to manage. The
   project doesn't issue passwords at all — neither provider
   needs them.

Future providers (Google, Discord) can be added without schema
changes; Supabase Auth abstracts.

### 7.2 Anonymous local-only mode (no account)

Default state. The editor boots without requiring sign-in. IDB
works, projects persist locally, exports work. The TopBar shows
a "Sign in" button instead of an avatar; the StatusBar shows
"Local only" instead of a sync status. Every existing user (today)
is implicitly in this mode.

Implementation: the sync engine checks
`supabase.auth.getSession()` and short-circuits all push/pull
calls when there's no session. Local IDB operations are
unchanged. The "Sync now" button is replaced by a "Sign in to
sync" button.

### 7.3 Migration when anonymous user signs in

The interesting case. User has been authoring anonymously, builds
up 4 projects in IDB, then clicks "Sign in." After successful
auth, we run a one-time migration:

```pseudo
onFirstSignIn(userId):
  localProjects = idb.listProjects()
  for each project in localProjects:
    // Generate a new uuid (anonymous IDB ids are local-scoped only).
    cloudId = uuid()
    // Insert the projects row with owner_id = userId.
    await supabase.from("projects").insert({
      id: cloudId,
      owner_id: userId,
      ...projectFields,
    })
    // Rewrite the IDB id from the old local id to the new uuid.
    await idb.renameProjectId(project.id, cloudId)
    // Trigger an immediate full push.
    await push(cloudId)
  showToast(`Migrated ${localProjects.length} local projects to your account.`)
```

Three subtleties:

1. **Local IDs are not UUIDs today.** `EditorProjectStore.createProject`
   generates an id via `crypto.randomUUID()` already (per the E1
   spec). So no rename needed — local UUIDs become cloud UUIDs
   verbatim. The migration is just "insert each local row to the
   cloud."
2. **What if the user signs in on a device that already has cloud
   projects?** Two cases:
   - **Different cloud projects + new local projects** → merge.
     Cloud projects pull down; local projects push up. No id
     collisions because UUIDs.
   - **Same project authored both locally and in the cloud** → can't
     happen, because the local-only state means the id was never
     cloud-side. If the user has the *same* project on two devices,
     they'd have signed in on one first, then on the other. The
     second device's local copy is then "I have a local-only
     project with id X" and the cloud also has "project X" — id
     collision → resolve via conflict UX (§6.2).
3. **Privacy posture.** Anonymous projects are local-only; no
   metadata is sent to Supabase before sign-in (no telemetry, no
   "anonymous user ID"). When the user signs in, the migration is
   explicit and visible (the toast confirms count). Users who
   change their mind can sign out and their projects remain in
   IDB; signing back in with a different account doesn't
   re-migrate (the IDB id is now associated with the original
   user's account; the new account would see empty cloud +
   pre-existing local, and the migration only triggers on first
   sign-in per device — tracked via a flag in localStorage).

Sign-out behaviour: clear `supabase.auth.session`, retain IDB.
Editor returns to local-only mode. Re-sign-in resumes cloud sync
where it left off. No data is deleted on sign-out.

---

## 8. Editor UX

### 8.1 Sync status indicator

Two surfaces, per [EDITOR_REDESIGN.md §7](./EDITOR_REDESIGN.md):

**TopBar** — right side, before the avatar / sign-in button.
Compact icon + tooltip:

```
[cloud icon] Synced 2m ago        ← state: "synced"
[cloud icon] Syncing... (3 of 7)  ← state: "syncing"
[warn icon]  Sync failed — retry  ← state: "error", clickable
[cloud-off]  Local only           ← state: "no-auth"
[cloud-off]  Offline — queued (5) ← state: "offline"
```

Clicking the indicator opens a small popover with:
- Last sync time (human + ISO tooltip).
- Pending changes count.
- "Sync now" button.
- "View sync log" link → EditorSettingsModal Sync tab.

**StatusBar** — left section, alongside project name / dirty
flag. More detail-oriented than the TopBar — shows the actual
text "Synced 2 minutes ago" without an icon, plus a small dot for
state (green/yellow/red/grey).

Both indicators read from a `SyncStatusContext` provided by the
shell. The sync engine pushes status updates via a
`useSyncStatus(projectId)` hook. No props-drilling.

### 8.2 Sign-in flow

A "Sign in" button on the TopBar (replaces the avatar slot when
signed out). Clicking opens a modal:

```
+-------------------------------------------+
| Sign in to sync your projects             |
|                                           |
| [ Continue with GitHub ]                  |
|                                           |
| or                                        |
|                                           |
| Email: [_____________________________]    |
| [ Send magic link ]                       |
|                                           |
| Your local projects will be uploaded to   |
| your account after sign-in.               |
+-------------------------------------------+
```

The "your local projects will be uploaded" copy makes the
migration explicit. Post-sign-in, a toast confirms the count;
the TopBar avatar appears with the user's GitHub avatar /
gravatar / initial.

Sign-out is in the avatar dropdown: "Sign out (cloud sync will
pause; your projects stay on this device)."

### 8.3 Conflict dialog

Wireframe in §6.2. The dialog blocks editing of the conflicting
project but doesn't block the rest of the editor — other projects
in the same session can be opened normally. The dialog auto-
opens when push detects a conflict; the user can also dismiss
("Resolve later") which queues the conflict and reopens the
dialog next time they edit that project.

### 8.4 Sync settings (EditorSettingsModal)

A new "Sync" tab in EditorSettingsModal (per the cog redesign in
[EDITOR_REDESIGN.md Q2](./EDITOR_REDESIGN.md)):

```
+------- EditorSettingsModal: Sync ---------+
|                                           |
| Account                                   |
|   Signed in as: codingbutter (GitHub)     |
|   [ Sign out ]                            |
|                                           |
| Sync cadence                              |
|   Idle debounce: ( 10s | 30s | 60s | never ) |
|   [✓] Sync on Cmd-S                       |
|   [✓] Sync on tab close                   |
|   [✓] Sync on focus regain                |
|                                           |
| Conflicts                                 |
|   On conflict: ( ask | keep local | use cloud ) |
|                                           |
| Storage                                   |
|   Used: 142 MB of 5 GB                    |
|   Projects: 4 of 100                      |
|   [ Refresh quota ] [ Manage projects ]   |
|                                           |
| Advanced                                  |
|   [✓] Show sync log                       |
|   [ Wipe local cache ]   (re-pull all)    |
|   Device ID: f3a91c2e (this browser)      |
+-------------------------------------------+
```

The "Wipe local cache" button drops the IDB and forces a fresh
pull from the cloud — used when local state is corrupted or the
user wants to "start over" on a device. Confirmation modal warns
"this will lose unpushed local changes."

---

## 9. Performance budget

### 9.1 Manifest size targets

Average manifest, measured against existing default-pack and
example modder packs:

| Project complexity | Manifest jsonb size | Asset index size | Total row |
|---|---|---|---|
| Trivial (1 scene, 10 sprites) | ~3 KB | ~1 KB | ~4 KB |
| Default-pack-equivalent | ~15 KB | ~5 KB | ~20 KB |
| Heavy modder pack (50 scenes, 500 sprites, 100 sounds) | ~80 KB | ~50 KB | ~130 KB |
| Pathological (10k assets) | ~50 KB manifest + 1 MB asset_index | n/a | ~1 MB |

Postgres jsonb columns are TOAST-compressed for rows > 2 KB, so
the storage cost is roughly 30-40% of the uncompressed size.
Wire cost (with gzip) is similar.

Target: the 99th-percentile manifest sync is < 100 KB on the wire
and completes in < 500 ms p50. Achievable with the schema as
defined.

### 9.2 Asset upload chunking + retry

Supabase Storage PUT supports up to 5 GB per object (with
multipart). The editor uploads single-shot for objects < 50 MB
(one HTTP PUT, one progress callback) and chunked multipart for
larger objects (5 MB chunks, with per-chunk retry).

Retry policy:
- Single-shot: 3 retries with exponential backoff (1s / 2s / 4s).
  Total worst-case: ~7s + the underlying transfer time.
- Multipart: per-chunk retry (same 3-try / expo backoff per
  chunk); the multipart upload session itself is resumable for up
  to 24h (Supabase default).
- After 3 failed retries on a blob, the push marks that blob as
  "failed" in IDB (`assets.syncStatus = "failed"`) and the
  StatusBar surfaces a "1 asset failed to sync — retry?" pill.
  Other assets in the same push continue uploading; the manifest
  PATCH is held until ALL blobs succeed (otherwise the
  asset_index would point at a hash the cloud doesn't have).

Per-asset failure mode: a single bad blob (e.g., over quota)
shouldn't block the rest of the project from syncing. The MVP
behaviour is "block manifest until all blobs succeed," but a CS6
refinement is "let the manifest sync with the un-failed assets;
mark the failed ones as `pending_upload` in the index so other
devices know they're missing." Defer.

### 9.3 Idle detection

Idle is measured by "time since last keystroke/mouse-down event
in the editor canvas." Implemented as a single throttled
`requestIdleCallback` + `pointerdown`/`keydown` event listener on
the editor root. The 30s threshold (or configurable) is a single
`setTimeout` that resets on activity.

False positives: a user pasting a 1 GB FBX into the asset
inspector counts as "activity" only at the moment of paste; the
30s timer starts immediately and fires while the user is still
waiting for the FBX to bake. This is fine — the sync triggers
while the user is idle, even if the editor is busy. Sync runs
on a Web Worker (see CS4 implementation note) so it doesn't
block the main thread regardless.

False negatives: a user authoring with a tablet/stylus might not
generate `pointerdown` events for some interactions. Mitigation:
also listen for `change` events on the EditorProjectStore's
mutators directly — the "edit happened" signal is the IDB write,
not the input event. This is the more reliable signal anyway; the
30s timer is reset on every IDB write.

---

## 10. Pack chain implications

Content-addressed blobs make pack-chain dependencies essentially
free in storage terms.

Scenario: Pack B `requires` Pack A. Both are published to the
store. Pack A has 500 MB of textures; Pack B adds 10 MB of new
content.

Today (pre-cloud-sync): Pack B's `.apg` is 10 MB (it doesn't
re-bundle Pack A — the chain resolver fetches A separately at
load time). The store hosts both `.apg`s separately. Storage:
500 + 10 = 510 MB.

With CS4 (asset blob sync + dedupe): Pack A's 500 MB of textures
are SHA-256-keyed in `project_assets`. Pack B's manifest references
the same hashes (the modder authored Pack B by forking Pack A in
the editor; the editor's fork-from-pack flow in
[STORE.md §11.4](./STORE.md) doesn't copy the bytes, just adds
`requires[0] = packA-id` and references PackA's hashes for the
shared assets). Storage:
- `project_assets` has 500 MB for Pack A + 10 MB unique to Pack B
  = 510 MB total. **Same total as today.**
- But: if a user forks Pack B to make Pack C with 1 MB of changes,
  Pack C is stored as 1 MB of new blobs + manifest references to
  Pack A's hashes (still in `project_assets`). Pack C's "cost" is
  1 MB, not 511 MB.

The dedupe wins on forks-of-forks and on cross-pack texture reuse
(every modder using the standard "stone wall" texture pays for it
once, shared across all packs that reference it).

Pack chain integrity (`requires[].integrity = "sha256-..."`) uses
the **same hash format** as the cloud blob keys. A pack's manifest
declaring `integrity = "sha256-abc123..."` resolves at load time
to "fetch the `.apg` whose bytes hash to that," which is
equivalent to "look up `project_assets` where `sha256 = abc123...`
and serve the bytes." The two systems are unified.

When CS4 ships, the pack-chain loader gets a new resolution path:
"if `requires[].url` is missing but `integrity` is set, look up
the hash in the cloud's `project_assets` and serve directly."
This makes the chain syntax `requires: [{ integrity:
"sha256-abc123..." }]` valid — no URL needed for blobs already in
the content-addressed store. Useful for forks where the parent
is private (so no public URL exists) but the dependency tree is
internal to the fork-owner's projects.

---

## 11. STORE.md integration

The relationship: **a project is a private pack.** Publishing
moves it from "private to me" to "public to all" by flipping
visibility, without moving bytes.

### 11.1 Schema unification

`projects` and `packs` (from [STORE.md §15](./STORE.md)) are
parallel tables, both holding the same `manifest_json` shape and
both keying blobs by `sha256`. The fields differ:

| Concept | `projects` | `packs` (STORE.md) |
|---|---|---|
| ID | uuid (project) | text (pack id, human-chosen) |
| Visibility | owner-only RLS | public RLS WHERE `hidden = false` |
| Versioning | none (live edit) | `pack_versions` table with semver |
| Lifecycle | infinite (until owner deletes) | versioned (each publish = new version) |
| Engagement | none | ratings, comments, downloads |

Publishing a project:

```pseudo
publishProject(projectId, newPackId, version):
  project = projects.get(projectId)
  // 1. Create the packs row (one-time per pack_id).
  insertOrIgnore("packs", {
    id: newPackId,
    name: project.name,
    author_user_id: project.owner_id,
    description: project.manifest_json.description,
    ...
  })
  // 2. Create the pack_versions row (per publish).
  insert("pack_versions", {
    pack_id: newPackId,
    version: version,
    manifest: project.manifest_json,
    asset_index: project.asset_index,
    download_url: `${storeRoot}/p/${newPackId}/${version}.apg`,
    integrity: computeApgIntegrity(project),    // hash of the bundled .apg
    published_at: now(),
  })
  // 3. Mark the project as published.
  update("projects", { published: true, published_pack_id: newPackId })
                  .where("id", projectId)
  // 4. NO BLOB MOVES. project_assets already holds every blob the
  //    pack needs. The published pack just references them.
```

The `.apg` "download_url" is interesting — there's no `.apg` file
on disk. Instead, a Supabase Edge Function at `/p/<pack-id>/<version>.apg`
synthesises the `.apg` zip on demand from `pack_versions.asset_index`
+ Storage blob reads, with aggressive Cache-Control. First request
takes ~1s (zip stream); subsequent requests are cached at the CDN
layer.

Alternative: pre-bake the `.apg` at publish time and store it as
a single blob (also content-addressed). Cheaper at read time,
costs storage for the zipped form. Recommend pre-bake — the
duplication is small (zip overhead) and the read path is simpler.

### 11.2 Unpublishing

Per [STORE.md §9.3](./STORE.md), "unstore" flips `packs.hidden =
true`. The `projects` row is unaffected — the author still owns
the private project. RLS is the only thing that changes.

### 11.3 Private vs published assets

For a private project: `project_assets.sha256` exists in the
content-addressed store but is only readable by signed-in users
who know the hash (RLS: `authn`). Anonymous users can't enumerate.

For a published pack: the same `project_assets` row, now also
referenced from `pack_versions.asset_index` for a `published =
true` pack. Anonymous reads of the blob are gated by a separate
edge-function endpoint that joins through `pack_versions →
project_assets` and only serves blobs whose hash appears in some
published pack's manifest.

This means: deleting a private project that shared blobs with a
published pack does NOT delete those blobs. The published pack
keeps them via `pack_versions.asset_index` references; the
ref-count trigger decrements when the project row dies, but the
pack_versions reference keeps `ref_count > 0`.

Symmetric: an author can delete their published pack (unpublish
+ delete pack_versions row), and the blobs remain available to
private projects that still reference them.

---

## 12. Phased rollout CS1–CS6

| Phase | Scope | State |
|---|---|---|
| **CS1** | This plan doc. | This commit. |
| **CS2** | Supabase project setup + auth scaffolding. Tables created (projects, project_assets, project_snapshots, user_quotas). RLS policies installed. GitHub OAuth + magic link configured. Editor TopBar gets a "Sign in" button + EditorSettingsModal Sync tab (account section only). No actual sync yet — just auth round-trip. | Not started. |
| **CS3** | Manifest-only sync. `projects.manifest_json` round-trips; assets stay IDB-only. Push on Cmd-S + idle debounce. Pull on project open. No conflict UX yet (last-write-wins with toast warning). Sync indicator on TopBar + StatusBar. Lets users sync project metadata (name, manifest, scene-level edits) across devices but not their asset blobs. | Not started. |
| **CS4** | Asset blob sync + content-addressed dedupe. The full §3.1 + §5.1-5.3 pipeline. `project_assets` populated; Storage uploads; ref-count triggers; delta hash diff. Idle debounce, before-unload, focus regain. EditorSettingsModal Sync tab full functionality. Pack-chain integrity resolves via `project_assets` when URL missing (§10). | Not started. |
| **CS5** | Conflict resolution UX. The three-button modal (§6.2). Per-asset diff via monaco for text + image preview + hash compare for blobs. Sidebar "Resolve later" queue. Per-asset conflict granularity (§6.1 — only conflicts where BOTH sides modified the same asset block). | Not started. |
| **CS6** | Multi-device + collab hardening. Snapshot history (`project_snapshots` writes). Per-device sync log + replay. CRDT exploration for "Notes" / lightweight collaborative editing of plaintext fields. NOT full multi-cursor; that's its own product. | Not started — speculative. |

Each phase independently shippable. CS2 is dependency-only (auth
without sync); users can sign in but nothing else changes. CS3
gives cross-device manifest sync; users can author a project on
their laptop, sign in on their iPad, and see the project list.
CS4 is the headline feature: full project sync, assets included.
CS5 makes it safe for power users with multiple devices. CS6 is
indefinitely scoped.

### Per-phase effort estimate

| Phase | Sessions | Sub-tasks |
|---|---|---|
| CS2 | 1-2 | Supabase project, migrations, auth flow, sign-in button. |
| CS3 | 2-3 | `CloudSync.ts` (push/pull manifest-only), debounce timers, status context, basic indicator. |
| CS4 | 3-5 | Hash cache in IDB, blob upload pipeline, ref-count triggers tested, delta diff, full status pill, EditorSettingsModal Sync tab. |
| CS5 | 2-3 | Conflict modal, monaco diff integration, per-asset selection UX, discard-snapshot side store. |
| CS6 | 2-4 | Snapshot writes, history UI, sync log. CRDT exploration is a research spike, not a delivery. |

Total: ~10-17 sessions across CS2-CS5 for a fully production-
worthy v1. CS6 is open-ended.

---

## 13. Open questions

1. **Q1**: Supabase Storage vs S3-compatible blob host. This doc
   assumes Supabase Storage because the rest of the stack
   (Postgres, Auth) is Supabase. Supabase Storage is fine at
   v1 scale (free tier: 1 GB; pro tier: 100 GB; enterprise:
   unlimited). For heavy modders shipping 5-50 GB packs of
   textures, the bill scales with `project_assets.size_bytes`.
   Alternative: own-S3 (or R2 / B2) keyed by sha256, with
   Supabase only holding the index. Recommend Supabase Storage
   for CS4; revisit if storage bill exceeds compute. Migration
   to S3 is "copy bucket + flip `storage_path` to a new prefix" —
   straightforward.

   **RESOLVED**: Supabase Storage. Same vendor as the rest of the backend stack; one less integration.

2. **Q2**: Free-tier quota for anonymous-then-signed-in users. Once
   migration runs (§7.3), the new account immediately holds
   whatever the user's local IDB had. A user with 5 GB of local
   projects who signs in hits the 5 GB default quota
   instantly. Options: (a) auto-bump quota on first sign-in to
   the local-data size + 100 MB headroom, (b) refuse migration
   over-quota and prompt the user to delete projects, (c)
   silently truncate (don't migrate biggest projects). Recommend
   (a) for a smooth first-run — quota raises are cheap server-side
   and a hostile sign-up flow defeats the whole purpose.

   **RESOLVED**: 50MB per user. Bumped by subscription tier (future).

3. **Q3**: Manifest-vs-asset push atomicity. If the manifest PATCH
   succeeds but a blob upload fails, the cloud sees a manifest
   referencing a missing hash. Mitigations: upload blobs first
   (current §5.1 step ordering), or use Storage's transactional
   bucket-level locks (not available). The current ordering
   protects against partial state; the failure mode is "blobs
   uploaded but manifest not patched" which is a free no-op
   (the orphan blobs sit in `project_assets` with `ref_count = 0`
   and get GC'd in 7 days). Confirm this is the desired posture
   before CS4 ships.

   **RESOLVED**: Push manifest first (validates references against existing cloud assets), then push new asset blobs. Two-phase to keep cloud state consistent even on mid-sync failure.

4. **Q4**: Hash cache invalidation on text edits. A user typing in
   Monaco rewrites a `.js` file every keystroke. Recomputing
   sha256 on every save is expensive (Web Crypto on small files
   is < 1ms but adds up if "save" is per-keystroke). Mitigation:
   debounce hash compute to the same idle window as the sync
   trigger (30s). Recommend: hash on save-to-IDB if file > 100
   KB, else hash lazily at push time. Confirm before CS4.

   **RESOLVED**: Recompute hash on every save. Cheap (text edits are <1KB scripts).

5. **Q5**: Sync engine threading. Push hashes + uploads + writes can
   happen on the main thread (current §5.1 pseudocode assumes
   it) or in a Web Worker. Worker = no main-thread jank during
   sync at the cost of `postMessage` overhead for transferring
   the asset bytes. Recommend: Web Worker in CS4 (using
   `Transferable` for the blob bytes to avoid copy). The hashing
   ALONE is enough reason — sha256 of 50 MB takes ~100ms even
   on M1; on a budget laptop it's longer.

   **RESOLVED**: Web Worker for SHA-256 hashing; main thread for storage API calls. Hash compute is the only CPU-heavy step.

6. **Q6**: Cloud storage quota at 100%. §8.4 sketches "Used 142 MB of 5 GB"
   in the Sync tab, but doesn't define what happens at 100%.
   Options: (a) refuse new pushes with a banner, (b) refuse new
   *asset* pushes but allow manifest-only edits to sync, (c)
   write to a sidecar "overflow" partition the user has to
   manually clean up. Recommend (b): manifest changes are tiny
   and shouldn't be gated by quota; new assets show a "Storage
   full" pill until the user clears space. Confirm.

   **RESOLVED**: Block new uploads, show modal explaining quota + offer "Delete old snapshots" / "Upgrade tier" actions.

7. **Q7**: Multi-device sign-in tracking. `projects.device_id` records
   the last device that pushed. Useful for the conflict modal's
   "Last sync: 5 minutes ago, from 'Firefox on Linux'." But the
   `device_id` is just a localStorage UUID — a user clearing
   localStorage gets a new id. Recommend: store device-id +
   user-agent string in a `user_devices` table (per-user, list of
   known devices, last-seen timestamp) so the UI can show
   meaningful device names. Defer to CS6.

   **RESOLVED**: `device_id` per session in a `user_devices` table. Sync uses last-write-wins per device pair.

8. **Q8**: Anonymous-to-account migration / anonymous-to-anonymous transfer. A user authoring
   anonymously on a laptop wants to "move" a project to a
   different anonymous browser without signing in. Currently
   impossible — IDB doesn't cross browsers. Workaround: export
   `.apg`, import on the other side. Recommend: do not solve this
   — the answer is "sign in." Cross-browser anonymous transfer
   is a strange use case and adds complexity.

   **RESOLVED**: On first sign-in from an anonymous device, migrate IDB projects up to the new account. User-confirmed via dialog: "Found 3 local projects — sync to your account?".

9. **Q9**: Magic-link email deliverability. Supabase's built-in email
   sender (Resend or similar) is fine at trial scale but gets
   rate-limited at production scale. For CS2, the default sender
   works. For CS5+ with growing user count, configure a custom
   SMTP (Postmark, SendGrid). Track delivery rates from CS3
   onward.

   **RESOLVED**: SendGrid via Supabase Auth providers config.

10. **`forked_from.openedAt` provenance after cloud round-trip.**
    The IDB `ProjectMeta.forkedFrom.openedAt` field is a local
    timestamp. After cloud sync to another device, what's it
    mean? Recommend: keep the original creation timestamp — it's
    "when the project was forked from a parent pack," not "when
    this row was last touched." Already implicit but worth
    documenting in the manifest schema.

11. **Subscription tier surface.** §4.1 defines
    `user_quotas.storage_bytes_max = 5 GiB` default. A future
    "Pro" tier ("100 GB, priority sync, snapshot history") would
    bump this. Schema is ready (just update the default per-tier).
    Defer until publish-monetization plans materialise (cross-ref
    [STORE.md §1 non-goals](./STORE.md) — billing is out of
    scope for v1).

12. **Q12**: Snapshot retention policy (CS6). When CS6 ships
    snapshot history, how many snapshots per project to keep?
    Recommend: last 10 explicit + last 30 days of auto-snapshots,
    with explicit snapshots immune to age-based pruning. Storage
    cost: each snapshot stores manifest + asset_index (no blobs;
    blobs already deduped). 10 snapshots × 100 KB = 1 MB per
    project. Manageable. Confirm at CS6 design time.

    **RESOLVED**: Keep last 10 snapshots OR 30 days, whichever is more. Beyond that, prune oldest.

13. **Audit log of sync events.** Should we keep a server-side
    log of "device X pushed project Y at time Z"? Useful for
    debug + abuse detection (someone using the API outside the
    editor). Cost: a row per push, ~100 bytes each, ~10/hour/user
    = ~1 MB/year/user. Recommend yes — small cost, big debug
    value. Sketch a `sync_events` table in CS4.

14. **Per-asset metadata schema growth.** Today `asset_index` is
    `{path, sha256, size, kind, updated_at}`. Future needs:
    `permissions` (read-only assets), `tags`, `mime_type`,
    `parent_id` (asset derived from another via the
    [IMAGE_LAB.md](./IMAGE_LAB.md) / [SOUND_LAB.md](./SOUND_LAB.md)
    recipe pipeline). Recommend: keep the schema additive; never
    rename a field once written. Migrations are SQL-only
    operations on a jsonb column, which is forgiving.

15. **Q15**: Concurrent push from same device. Two editor tabs of the
    same project on the same device: both observe the same IDB,
    both schedule pushes, both race. Mitigation: a
    `navigator.locks.request("sync:" + projectId, ...)` mutex
    around the push routine. Web Locks API is universally
    available. Confirm before CS3.

    **RESOLVED**: `navigator.locks` mutex on the sync key per project. Sync blocks until previous one completes.

16. **What if Supabase is down?** Editor remains fully usable
    offline. Push fails with retry; pull skipped on project
    open (uses cached IDB state). Status indicator shows
    "Offline — queued (N)." When Supabase comes back, queued
    pushes drain. No data loss, just delayed sync. Document this
    as the explicit posture; no special handling needed beyond
    what §5.1's error path already provides.

17. **Q17**: GDPR / data export. A signed-in user must be able to
    download their full project set. The export tool runs
    server-side (Edge Function) and produces a tarball of every
    `.apg` (synthesised from the project's manifest +
    `project_assets` blobs). Plus a JSON dump of profile data.
    Cross-ref STORE.md's per-user data export. Recommend
    shipping in CS4 alongside the publish flow — same
    `.apg`-synthesis primitive serves both.

    **RESOLVED**: Dedicated `/api/export` endpoint returning ZIP of user's projects (manifests + assets).

18. **Q18**: Account deletion cascade. "Delete my account" cascades through
    `auth.users` → `projects` (via RLS on delete) →
    `project_snapshots` → trigger-decrements
    `project_assets.ref_count`. Blobs no longer referenced get
    GC'd in 7 days. Author's published packs remain (the author
    is anonymised — `packs.author_user_id` set to NULL via
    `on delete set null`). Recommend documenting this in a
    short "data lifecycle" section of the editor's privacy
    notes. CS5 deliverable.

    **RESOLVED**: 30-day grace period (account hidden, recoverable); permanent cascade delete after grace.

Decisions can be deferred to the start of the relevant phase.
None block CS1 (this doc) or CS2 (schema + auth scaffolding).

---

## 14. Cross-references

| Doc | Direction | What |
|---|---|---|
| [PACK_CHAIN.md](./PACK_CHAIN.md) | This doc consumes | `requires[].integrity = "sha256-..."` hash format reused as cloud blob keys (§3.1, §10). `pack_versions.asset_index` schema mirrors `projects.asset_index` (§11). The chain resolver gains a new path: resolve a `requires[]` entry from `project_assets` when only `integrity` is given. PACK_CHAIN §8 should pick up a short note that the hash format aligns with cloud storage keys. |
| [STORE.md](./STORE.md) | This doc consumes | Supabase schema patterns (§15), RLS posture (§15.1), `auth.users` linkage. `packs` and `projects` are parallel tables; publishing is a visibility flip (§11). The `is_admin()` helper is shared. STORE.md §17 OQ16 ("pack hosting model") is partially answered by this plan: first-party hosting = Supabase Storage = the same content-addressed store used for private projects. STORE.md §15 should pick up a short reference that `project_assets` is the shared blob backend. |
| [EDITOR.md §4](./EDITOR.md) | This doc consumes | IDB schema. Sync layer rides on top of `EditorProjectStore`'s public API without modifying it. Adds an `assetHashes` IDB store sidecar for the hash cache (§5.2). EDITOR.md §4 should pick up a brief note that an additional store (`assetHashes`) lands in CS4. |
| [EDITOR_REDESIGN.md §7](./EDITOR_REDESIGN.md) | This doc consumes | TopBar + StatusBar surfaces for the sync indicator (§8.1). EditorSettingsModal "Sync" tab (§8.4). EDITOR_REDESIGN.md should pick up §8.1's wireframe spec when R3 (shell) defines the TopBar slots. |
| [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) | This doc surfaces | The editor-as-iframe ([STORE.md §11.2](./STORE.md) Mod-from-store) inherits cloud sync transparently — the iframe boot flow already calls into `EditorProjectStore`, so cloud sync layers on without iframe-specific changes. |
| [IDEAS.md](../IDEAS.md) | This doc materializes | The "Cloud sync architecture / Hybrid: content-addressed asset store + project manifest" entry. The idea-log entry should be reopened or back-referenced once this doc lands — currently the idea exists in conversation but no IDEAS.md entry was committed; recommend adding one with a `→ CLOUD_SYNC.md` pointer. |
| [MATERIALS.md](./MATERIALS.md) + [CONSOLE.md](./CONSOLE.md) | Tone reference only | Density + structural style. No functional dependency. |
| [MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) | Future cross-link | Multi-device collab (CS6) might overlap with multiplayer session sync. The two are orthogonal in v1 (cloud sync is single-author cross-device; multiplayer is multi-player same-session) but a CRDT layer would benefit both. Cross-ref deferred until CS6 has a concrete shape. |
| [IMAGE_LAB.md](./IMAGE_LAB.md) + [SOUND_LAB.md](./SOUND_LAB.md) | This doc surfaces | Procedural recipe outputs are assets like any other — they get hashed, synced, and dedup'd alongside hand-authored bytes. A pack whose primary content is recipes (cheap to author, cheap to share, cheap to store) is well-served by the content-addressed store. |

### 14.1 Suggested updates to neighbouring docs

The following updates are RECOMMENDED — they keep the cross-doc
graph consistent but are not blocking for CLOUD_SYNC.md to land:

- **PACK_CHAIN.md §8** — short note that the `integrity =
  "sha256-..."` format aligns with the cloud `project_assets`
  key format, so packs in the community store can resolve their
  bytes via either URL fetch or content-addressed lookup.
- **STORE.md §15** — short note that `project_assets` (CLOUD_SYNC
  §4.1) is the shared blob backend; `pack_versions.asset_index`
  is the same shape as `projects.asset_index`; publishing copies
  the manifest, not the bytes.
- **EDITOR.md §4** — short note that a fourth IDB store
  (`assetHashes`) lands in CS4 for the hash cache; current store
  list (`projects`, `manifests`, `assets`, `bakeCache`) gains an
  entry.
- **EDITOR_REDESIGN.md §7** — when the TopBar slot definitions
  are finalised in R3, reserve the right-edge "sync indicator"
  slot per §8.1 of this doc.
- **IDEAS.md** — add an entry referencing this doc:
  `2026-05-17 — Cloud sync architecture (CLOUD_SYNC.md)` with a
  one-paragraph summary and Status: Planning.
- **PLAN.md** — add a row to the phase status table for CS1
  ("Plan doc landed") and reserve rows for CS2-CS6.
- **SESSION_STATE.md** — note that CLOUD_SYNC.md is the new
  authoring artefact; next session can dispatch CS2.

---
