# Pack chain — multi-pack loading + dependencies + override semantics

A plan for evolving the asset-pack system from "load one .apg" to
"load an ordered chain of packs with declared dependencies, override
rules, optional community store, and per-pack user controls."

Subsumes `ENGINE_PACK_SPLIT.md` R5. Where R5 had "default pack +
URL override" this plan generalises to any number of packs with
declared `requires` graphs.

---

## 1. Goals

- **Composable mods**: a pack can extend or override any other pack.
  A modder ships an `.apg` that depends on `base-doom` + their own
  weapons rebalance. Players load both via one URL or one chosen mod
  id. The dependency tree resolves automatically.
- **Decentralised hosting**: packs can declare a dep by raw URL (any
  static host: GitHub Releases, S3, the modder's own server). The
  community store is for discoverability, not gatekeeping.
- **User control**: the settings UI shows the resolved chain. Users
  can disable individual packs, see which assets each pack
  overrides, and clear trusted-URL caches.
- **Trust safety**: untrusted-source packs (not from the configured
  community store) trigger a one-time confirmation modal before
  fetch. SRI (`integrity` hash) optional but strongly recommended for
  pinned URL deps.
- **Backwards compat**: an existing single-`.apg` flow with no
  `requires` and no chain in the URL still works unchanged.

Out of scope (covered elsewhere):
- Pack-shipped shaders, components, systems, prefabs — see
  `ENGINE_PACK_SPLIT.md` R2-R4.
- Pack publishing flow (modder uploads to community store, store
  serves manifest metadata) — sketched here, full implementation
  later.

---

## 2. Manifest schema additions

Every pack `manifest.json` gains optional fields:

```jsonc
{
  "id": "dark-mod",                       // globally unique pack id
  "version": "0.2.1",                     // semver
  "engine": "two_5_d@0.1",                // engine version compat
  "name": "Dark Mod",                     // human label
  "description": "Adds dim corridors and creepy lights.",
  "author": "codingbutter",
  "homepage": "https://example.com/dark-mod",
  "requires": [
    {
      "id": "base-doom",                  // dep by id (store-resolved)
      "version": "^1.0.0"
    },
    {
      "id": "weapons",                    // dep by raw URL
      "url": "https://github.com/user/repo/releases/download/v1.0/weapons.apg",
      "integrity": "sha256-abc123..."     // optional SRI
    },
    {
      "id": "experimental",
      "url": "https://my-server.com/packs/foo.apg"
    }
  ],
  ...existing fields...
}
```

`id`, `version`, `engine` become load-bearing once mods reference each
other. `id` MUST be globally unique. `engine` is a semver range
constraint against the running engine version — pack refuses to load
if mismatched.

`requires[]` entry shapes:
- **Store-resolved**: `{ id, version }` — loader queries the community
  store for a URL.
- **URL-pinned**: `{ id, url, integrity? }` — loader fetches that URL
  directly. `id` MUST still be set so conflict detection works.
- **Both**: `{ id, url, version?, integrity? }` — fetch URL, verify
  the fetched manifest's `id` matches, verify `version` satisfies if
  provided. Defense-in-depth against "I told you this was X but it's
  actually Y."

Version constraint syntax (pick one to start):
- **Exact**: `"1.0.2"` — exact match only.
- **Caret** (`^1.0.0`): compatible-with-major. Standard npm range.
- **Tilde** (`~1.0.0`): compatible-with-minor.

Recommend **caret only** for v1 — minimum useful surface. Add tilde
+ explicit ranges later.

---

## 3. URL chain syntax

```
?pack=URL                              # single pack (existing)
?pack=URL1&pack=URL2&pack=URL3         # explicit ordered chain
?pack=community:dark-mod@0.2.1         # store shorthand
?pack=community:dark-mod               # latest available
?pack=URL&pack=community:other-mod     # mix
```

`?pack=` params parsed in URL order. That order is the "user-declared
intent" for override priority — later packs override earlier ones in
their declared chain. Auto-resolved transitive deps are inserted
BEFORE the pack that requires them in the topo sort.

The default pack (`packages/default-pack`) is always implicitly first
in the chain unless the user explicitly opts out with
`?pack=no-default&pack=...`. Most players never touch this.

---

## 4. Resolution algorithm

```pseudo
resolveChain(initialUrls):
  declared = parse(initialUrls)                # ordered list, may include `community:` shorthand
  expanded = []                                 # flat list with manifests
  visited = new Set()                           # by pack id

  for url in declared:
    pack = fetchAndIndex(url)                   # download .apg, parse manifest
    addWithDeps(pack)

  function addWithDeps(pack):
    if visited.has(pack.id):
      // Same id seen twice in the chain — must resolve to same version + same URL.
      // Otherwise: hard error "ambiguous dep".
      assertSamePack(pack, expanded.find(p => p.id === pack.id))
      return
    visited.add(pack.id)

    for dep in pack.requires:
      depPack = resolveDep(dep)                 // see § 5
      addWithDeps(depPack)                      // recurse
    expanded.push(pack)                          // insert AFTER its deps (topo order)

  detectConflicts(expanded)                     // see § 6
  return expanded
```

Output: an array of resolved packs in load order. Deps come before
dependents. Conflict report returned alongside (see § 6).

Cycle detection via the `visited` set + a recursion stack — if `addWithDeps`
re-enters for a pack id already on the stack, hard error.

---

## 5. Per-dep resolution

```pseudo
resolveDep(dep):
  if dep.url:
    bytes = fetch(dep.url)
    if dep.integrity:
      verifyHash(bytes, dep.integrity)          // hard error on mismatch
    pack = unzip(bytes)
    if dep.id and pack.manifest.id != dep.id:
      hard error "id mismatch"
    if dep.version and !satisfies(pack.manifest.version, dep.version):
      hard error "version mismatch"
    return pack

  // No url — must resolve via community store
  if !communityStoreConfigured:
    hard error "dep '$id' requires community store, none configured"
  url = communityStore.lookup(dep.id, dep.version)
  if !url:
    hard error "dep '$id@$version' not found in store"
  return fetchAndIndex(url)
```

The community store is configured per-pack-manifest OR globally:

```jsonc
// manifest.json
{
  ...
  "communityStore": "https://store.two_5_d.dev"   // optional; falls back to engine default
}
```

If a pack declares its own store URL, deps resolved via that one.
Otherwise the engine's default store (configured at build time in
`packages/engine/`) wins.

---

## 6. Conflict detection

Same-asset-from-multiple-packs is normal (it's how overrides work).
But the resolver flags any case where two enabled packs touch the
same named asset, so the UI can surface the override:

| Conflict type | Severity | Behaviour |
|---|---|---|
| Two packs claim same `manifest.id` | hard error | abort load |
| Same scene path | soft | last wins, flag in report |
| Same script path (e.g. `scripts/boot.js`) | soft | last wins, flag |
| Same prefab name registered via script | soft | registration order wins (last script in chain wins), flag |
| Same component name `defineComponent("Foo")` | soft | duplicate-define error UNLESS `api.overrideComponent` is used (post R3) |
| Same tile id `tileTextures["5"]` | soft | last wins, flag |
| Same sprite id `sprites["ammo_pack"]` | soft | last wins, flag |
| Same shader name (post-R4) | soft | last wins, flag |

The conflict report shape:

```ts
interface ConflictReport {
  hardErrors: Array<{ kind: string; message: string }>;
  overrides: Array<{
    asset: string;           // e.g. "scenes/scene1.json"
    winnerPack: string;      // pack id that wins
    overriddenPacks: string[];
  }>;
}
```

Hard errors abort the load entirely (UI shows error + lets user
disable packs to retry). Soft overrides are informational —
displayed in the Packs settings panel for transparency.

---

## 7. Override rules per asset type

Last-write-wins within the resolved chain order, per asset type:

| Asset type | Identity key | Merge / override |
|---|---|---|
| `manifest.config` (deep-merged into CONFIG) | path | deep merge |
| `tileTextures[id]` | numeric tile id | replace |
| `tileSheets[i]` | array order | concatenate (each pack contributes) |
| `items[id]` | item id string | replace (whole def) |
| `sprites[id]` | sprite id string | replace |
| `scenes/<path>` | scene path | replace whole scene file |
| `scripts/*` | script path | concatenate (each pack's scripts all run in chain order) |
| `images/*` | path | replace (last pack's bytes win) |
| `shaders/*` (post-R4) | shader name | replace |
| Prefab registrations (runtime) | prefab name | last-call-wins |
| Component definitions (runtime) | component name | duplicate = error unless `overrideComponent` |
| System registrations (runtime) | order | concatenate (all systems run) |

---

## 8. Trust model

Pack scripts run with full ModAPI access — they can register
systems, mutate world state, fetch external resources. Loading a
pack is loading arbitrary code. Same trust posture as Chrome
extensions / Steam Workshop / unsigned npm packages.

**Defenses**:

1. **Untrusted-source warning**. For any `requires` URL that's NOT
   resolved via the configured community store (i.e. a bare `url:`),
   prompt the user before fetch:

   > **Loading untrusted pack**
   > `dark-mod` requires `weapons` from
   > `https://github.com/user/repo/releases/download/v1.0/weapons.apg`
   > This pack is hosted outside the community store. It runs arbitrary
   > code in your browser. Only continue if you trust the source.
   > [ ] Don't ask me again for this URL
   > [ Cancel ] [ Load ]

   "Don't ask again" persists in `localStorage` keyed by URL. A
   "Forget all trusted URLs" button in settings clears the list.

2. **Subresource integrity (SRI)**. A `requires[].integrity` hash
   pins the exact bytes:

   ```jsonc
   { "id": "weapons", "url": "...", "integrity": "sha256-abc123..." }
   ```

   Loader computes the hash of fetched bytes; mismatch = hard abort.
   Defends against URL contents being replaced after the pack was
   authored. Tooling: `bun --cwd apps/pack-builder run hash-pack
   ./my.apg` outputs the line to paste into a manifest.

3. **CORS**. Some URLs may fail to fetch if the host doesn't send
   permissive CORS. The PWA service worker caches successful fetches
   by URL hash so transient CORS issues don't break repeat loads.

4. **Manifest mismatch defense**. If a `requires` entry has both
   `id` and `url`, the loader fetches the URL, parses its manifest,
   and aborts if `manifest.id !== requires.id`. Prevents URL swaps.

---

## 9. Settings UI — Packs panel

A new tab in the existing settings modal, next to controls /
graphics / io. Sections:

### 9.1 Loaded chain

Table of the resolved chain in topo order:

| Order | Pack | Version | Source | Enabled | Overrides |
|---|---|---|---|---|---|
| 1 | `two_5_d-default` | 1.0.0 | bundled | ✓ (locked) | – |
| 2 | `weapons` | 1.0.0 | github.com/.../v1.0 | ✓ | – |
| 3 | `dark-mod` | 0.2.1 | community | ✓ | `scenes/scene1.json` |
| 4 | `experimental` | 0.1.0 | example.com/foo.apg | ✓ | `scripts/prefabs/player.js`, `scenes/scene2.json` |

- **Enabled toggle** disables a pack without removing it from the
  chain. Disabling triggers a reload (chain re-resolves with that
  pack skipped).
- **Locked rows** (`✓ (locked)`) are packs another enabled pack
  declares as `requires`. Tooltip explains: "disabled by
  `dark-mod`'s `requires` — disable dark-mod to free this." Can be
  unlocked by disabling the dependent.
- **Source column** colour-codes by trust: `bundled` (engine ships
  it), `community` (resolved via store), `URL` (raw URL).
- **Overrides column** lists every asset this pack replaces from
  earlier packs. Hover for full path.

### 9.2 Conflict report

If the resolver emitted any soft conflicts, a "View conflicts"
button expands to show each one with the winner + overridden
list. Hard errors block the chain from loading entirely; the UI
shows them at the top with "Disable [pack] to retry" buttons.

### 9.3 Trust controls

- **Trusted URLs** list. Each entry: URL + "Forget".
- **Forget all trusted URLs** button.
- **Community store URL** field — defaults to the engine's
  configured store, can be overridden per session.

### 9.4 Add a pack

A simple text input for "Pack URL or `community:id@version`". Adds
to the chain (and to the URL on next reload) without manual URL
editing.

### 9.5 Persistence

Per-chain settings (which packs are enabled) persist in
`localStorage` keyed by a hash of the chain. Loading `?pack=A&B`
remembers your toggles for that combo. Loading `?pack=A&C` is a
fresh slate.

---

## 10. Community store API

A REST endpoint serving pack metadata. Same Supabase Postgres backing
the user accounts / pack-store metadata mentioned in
`MULTIPLAYER_PLAN.md`.

### Schema

```sql
create table packs (
  id text primary key,                  -- pack id
  name text not null,                   -- human label
  description text,
  author_user_id uuid references auth.users,
  homepage text,
  created_at timestamptz default now()
);

create table pack_versions (
  pack_id text references packs(id),
  version text not null,
  manifest jsonb not null,              -- full manifest snapshot
  download_url text not null,           -- where the .apg lives
  integrity text,                       -- SHA-256 hash of the .apg bytes
  published_at timestamptz default now(),
  primary key (pack_id, version)
);

create index pack_versions_pack_id_published_at_desc
  on pack_versions (pack_id, published_at desc);
```

### Endpoints

```
GET /api/packs                          -- search / list
GET /api/packs/:id                      -- pack metadata + version list
GET /api/packs/:id/latest               -- latest version manifest
GET /api/packs/:id/:version             -- specific version manifest
POST /api/packs                         -- publish new pack (auth required)
POST /api/packs/:id/versions            -- publish new version (auth required)
```

The `.apg` file itself lives on a CDN / blob store separate from
Supabase Postgres (Supabase row size limits aside, the Postgres
row is metadata only). Resolution flow:

1. Loader calls `GET /api/packs/:id/:version` → gets manifest +
   `download_url`.
2. Loader fetches `download_url` → gets the `.apg` bytes.
3. Loader verifies `integrity` from the manifest matches the fetched
   bytes (community-store-resolved packs get integrity for free).

### Publishing

Out of scope for this plan, but conceptually:

1. Modder runs `bun run publish-pack ./my.apg`. The tool:
   - Validates the manifest.
   - Uploads the `.apg` to the configured CDN.
   - Computes SHA-256 integrity.
   - POSTs metadata to the store API with the user's auth token.

Built later as part of the modder tooling pass.

---

## 11. Migration from current single-pack flow

Current code loads `?pack=URL` (one), defaulting to `/packs/default.apg`.
The migration:

1. **Schema-only first** — add `id`, `version`, `requires` to
   `PackManifest` types. No behaviour change. Single-pack load
   ignores `requires` (or warns if present).
2. **Resolver implementation** — `loadAssetPack` becomes
   `loadPackChain(urls: string[])`. Returns an ordered array of
   `AssetPack`. Internally walks the resolution algorithm.
3. **Multi-pack runtime apply** — `Game` consumes the chain,
   applying scenes / scripts / config in order. Existing single-pack
   callers wrap into a length-1 chain transparently.
4. **Trust modal + Packs settings panel** — `apps/game` adds the UI.
5. **Community store API** — Supabase tables + Edge Functions for
   the metadata endpoints. CDN upload tooling separate.
6. **Publishing tool** — last; only matters when the store is live.

Each step independently shippable.

---

## 12. Open questions

1. **Engine version constraint**. `manifest.engine: "two_5_d@0.1"` —
   semver-range or exact? Recommend caret-range (`^0.1` accepts
   `0.1.x`).
2. **Default community store URL**. Hardcode at build time, or
   leave configurable per-pack? Recommend per-pack with engine
   default fallback (covered in § 5).
3. **Locked-pack behaviour**. If user disables a pack that another
   pack requires, do we: (a) disable the dependent too,
   transitively, or (b) refuse to disable and explain why? Recommend
   (b) — explicit user action required.
4. **Implicit default pack**. Auto-prepend `two_5_d-default`, or
   require explicit `?pack=community:two_5_d-default`? Recommend
   implicit-by-default with `?nodefault` opt-out.
5. **CORS proxy**. Should the engine provide a CORS proxy fallback
   (via the configured server) for packs that fail direct fetch?
   Privacy/security implications. Recommend NOT — fail loudly so
   users know.

Decisions can be deferred until R5 implementation lands.

---

## 13. Files affected (when R5 implementation happens)

- `packages/engine/src/AssetPack/types.ts` — manifest schema
  additions.
- `packages/engine/src/AssetPack/loadAssetPack.ts` →
  `loadPackChain.ts`. Old single-pack loader becomes a thin wrapper.
- `packages/engine/src/AssetPack/resolveChain.ts` — new resolution
  algorithm.
- `packages/engine/src/AssetPack/communityStore.ts` — new client.
- `packages/engine/src/AssetPack/integrity.ts` — SRI verification.
- `apps/game/src/main.ts` — adapt boot flow to multi-pack.
- `apps/game/src/UI/SettingsScreen.tsx` — new "Packs" tab.
- `apps/game/src/UI/TrustModal.tsx` — new.
- Supabase migrations (separate repo / app, deferred).

---

## 14. Phases

- **P1**: schema additions + resolver + multi-pack load runtime.
  No store. Two-pack chain via `?pack=A&pack=B` works. Trust modal
  warns + persists per-URL trust. (1-2 sessions)
- **P2**: settings UI Packs panel. Conflict report rendering.
  Enable/disable toggles. (1 session)
- **P3**: SRI hashing tool + verification. (½ session)
- **P4**: Community store API (Supabase + REST endpoints). Loader
  resolves `community:` scheme. (2-3 sessions, partly out-of-repo
  on the Supabase side)
- **P5**: Publishing tool for modders. (2 sessions)

P1-P3 are deliverable inside this repo. P4-P5 require Supabase
project setup and the CDN for `.apg` hosting — coordinate with the
user.
