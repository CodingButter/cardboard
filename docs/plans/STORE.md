# Store — hosted website + delivery layer for `.apg` packs

A plan for the public-facing pack discovery website at e.g.
`store.two5d.example` and the embedding contract between it and the
existing game runner. The store is a **convenience layer** on top of
the URL-pack-substrate already specified in
[PACK_CHAIN.md](./PACK_CHAIN.md): it browses, previews, and launches
packs in an iframe pointed at the standard game runner. Any pack
hosted anywhere remains playable via that same runner without going
through the store.

Cross-refs: [PACK_CHAIN.md](./PACK_CHAIN.md) owns the manifest schema,
Supabase tables, and REST API this site consumes;
[EDITOR.md](./EDITOR.md) §9.2 owns the round-trip publish flow that
lands a finished pack on a store page;
[MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) owns multiplayer hosting
— the store only surfaces "playable online" metadata, it is not
itself a multiplayer host.

Date: 2026-05-15.

---

## 1. Goals & non-goals

### Goals

- **Curated discovery on top of an open substrate.** A modder who
  uploads to the store gets a SEO-friendly pack page, screenshots,
  version history, and a one-click "Play" button. A modder who
  *doesn't* upload to the store still gets the same `?pack=URL`
  flow and can ship their pack however they want.
- **Iframe-embedded play.** The store never reimplements the engine.
  It mounts the existing `apps/game/` runner in an `<iframe>` with
  `?pack=<pack-url>` and lets the runner do its job. The store's
  chrome (nav, footer, breadcrumbs, "Open in editor" affordance)
  stays around the iframe.
- **Per-pack PWA installability.** When a player decides "this is
  the pack I play every day," they can install **just that pack** as
  a standalone app with its own name, icon, and start URL — courtesy
  of a dynamic webmanifest served by the game runner.
- **Embed-anywhere.** The same iframe contract works on any third-
  party site. A blogger writing a mod review pastes one `<iframe>`
  tag and their readers can play in-page. This is a side-effect of
  the URL-substrate principle, not a separate system, but the store
  surfaces it with a "Copy embed code" affordance.
- **Untrusted-pack safety by iframe isolation.** A cross-origin
  iframe means an arbitrary pack's scripts cannot read the store's
  cookies, localStorage, or DOM. The store can confidently embed
  community packs *and* untrusted-URL packs because the browser
  sandbox limits the blast radius.

### Non-goals

- **Not a closed ecosystem.** The store does not enforce that packs
  go through it. The URL substrate stays primary; the store is one
  of many ways to find packs.
- **Not a backend rewrite.** [PACK_CHAIN.md](./PACK_CHAIN.md) §10
  already specifies the Supabase schema and REST endpoints. This
  doc consumes them; it does not redesign them.
- **Not the engine.** The store does not run game code itself; the
  iframe runner does. The store ships zero game logic.
- **Not the editor.** [EDITOR.md](./EDITOR.md) owns authoring; the
  store owns presentation + launching. A "Publish to store" action
  in the editor uploads to the store's backend (§9 below).
- **Not a multiplayer host.** Multiplayer servers per
  [MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) are user-hosted. The
  store may render a "playable online" badge on packs whose manifest
  declares multiplayer support, but it does not relay sessions.
- **Not auth/billing/monetization.** Out of scope for this iteration.
  Authoring credentials reuse the Supabase auth that the publishing
  flow uses; nothing more. Donations, paid packs, marketplace
  payouts: deferred. Noted as future work.

---

## 2. Three surfaces

```
+---------------------+   +-----------------------+   +---------------------+
| apps/store          |   | apps/game             |   | apps/game (same)    |
| (NEW)               |   | (existing runner)     |   | serves dynamic      |
|                     |   |                       |   | manifest per pack   |
| store.two5d.example |   | game.two5d.example    |   |                     |
|                     |   |                       |   |                     |
| - catalog UI        |   | accepts ?pack=URL     |   | /p/<id>/manifest    |
| - SEO pack pages    |-->| renders the game      |-->| .webmanifest        |
| - iframe embed      |   | mouse/keyboard/PWA    |   |                     |
| - "Copy embed code" |   | install prompt        |   | PWA install scope   |
| - "Open in editor"  |   |                       |   | per pack id         |
+---------------------+   +-----------------------+   +---------------------+
      (origin A)                  (origin B)               (origin B again)
```

Three deployable things. Surfaces 2 and 3 share an origin (`game.…`)
because they're literally the same server with different routes;
surface 1 lives on a separate origin (`store.…`) so that the iframe
boundary actually exists in the eyes of the browser's same-origin
policy.

### 2.1 Store website (`apps/store/`, NEW)

The catalog UI. Tech recommendation:

- **Framework:** Next.js with `output: "export"` (static export). The
  catalog is mostly read-only and the pack pages benefit from SSG +
  per-pack metadata for SEO. Alternative: Astro. Either way the
  output is a folder of static HTML/CSS/JS deployable to any CDN.
- **Why not Bun-only?** Bun's `Bun.serve` is great for the dynamic
  game runner. The store is mostly static, with two dynamic
  considerations (search, OG cards) that work fine as serverless
  functions or edge functions on the same host as the static export.
  Picking Next/Astro buys SSG and `next/image`-style asset
  optimization for free; rewriting that on Bun is busywork.
- **Lives in workspace:** `apps/store/` alongside `apps/game/`,
  `apps/editor/`, `apps/pack-builder/`. Shares
  `packages/shared` for manifest types (the same types
  [PACK_CHAIN.md](./PACK_CHAIN.md) defines).

Pages: home, pack detail, modder profile, search, embed-snippet
generator (deep-linked into pack pages). Detailed routing in §7.

### 2.2 Game runner (`apps/game/`, existing)

No new logic. The runner already accepts `?pack=URL` per the
URL-pack-substrate principle (`apps/game/src/main.ts` boot flow).
What changes:

- **CORS / framing headers.** The runner must send permissive
  `Content-Security-Policy: frame-ancestors *` (or an env-var
  override) and `Permissions-Policy` granting the features the game
  needs. See §3 for the exact headers.
- **No `X-Frame-Options`.** Headers stripped; CSP `frame-ancestors`
  supersedes it and the two conflict when both are set.
- **Dynamic webmanifest route.** `game.two5d.example/p/<id>/manifest.webmanifest`
  returns a manifest synthesised from the pack's `manifest.json`.
  See §4 for the synthesis logic.

The runner's existing PWA (`apps/game/public/manifest.webmanifest`,
`apps/game/public/sw.js`) becomes a "default-pack PWA" — the
fallback when no `?pack=` is set. Per-pack PWAs use the dynamic
route and a per-pack SW scope.

### 2.3 Per-pack PWA (same origin as 2.2)

Same server, different route. The trick: `start_url` and `scope` in
the synthesised manifest both reference a path like
`/p/<pack-id>/`, so each installed pack gets its own service-worker
scope, its own cache namespace, and its own homescreen icon. The
service worker that lives at `/p/<pack-id>/sw.js` is logically the
same code as `/sw.js` but registered under the pack-scoped path so
installs don't collide.

---

## 3. Iframe embedding contract

The hard, specific part. This section is normative — both the
store's iframe element and the runner's response headers must comply
or embedding breaks.

### 3.1 HTTP response headers (game runner)

```
Content-Security-Policy: frame-ancestors *
Permissions-Policy: fullscreen=*, pointer-lock=*, gamepad=*, screen-wake-lock=*
Cross-Origin-Opener-Policy: same-origin-allow-popups
Cross-Origin-Embedder-Policy: unsafe-none
Cache-Control: (per-resource; HTML no-cache, hashed bundles immutable)
```

Header-by-header rationale:

- **`Content-Security-Policy: frame-ancestors *`**. Default: any site
  can embed. This is intentional — the URL-pack-substrate principle
  is that any pack URL can be played anywhere, and "anywhere"
  includes third-party blogs, itch.io-style portfolios, mod
  showcases. A per-deploy env var `STORE_FRAME_ANCESTORS` can narrow
  this for sites that want store-only (`"https://store.two5d.example"`).
  We do NOT use `default-src` to lock down the runner's own
  resource loads here; that's a separate CSP concern handled per the
  runner's existing build pipeline.
- **`X-Frame-Options`**. Explicitly **NOT** set. It's the
  predecessor of `frame-ancestors` and conflicts when both are
  present (older browsers prefer XFO and refuse the frame even
  though CSP would allow it). The runner's server must strip it if
  any upstream adds it.
- **`Permissions-Policy`**. The game is unplayable without
  `pointer-lock` (mouse-look) and benefits from `fullscreen`,
  `gamepad`, and `screen-wake-lock` (keeps the screen awake on
  mobile during play). Every feature granted with `*` so embedders
  on any origin can opt in via the iframe's `allow=` attribute.
- **`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`**.
  We do NOT enable cross-origin isolation. Doing so would unlock
  `SharedArrayBuffer` but require every embedded resource to send
  CORP/COEP headers — packs hosted on user-controlled URLs won't,
  and we'd lose the ability to load arbitrary pack URLs. The runner
  currently has no `SharedArrayBuffer` dependency, so this is a
  cheap tradeoff.

### 3.2 `<iframe>` attributes (store's embed element)

```html
<iframe
  src="https://game.two5d.example/?pack=<URL-encoded-pack-URL>"
  allow="fullscreen; pointer-lock; gamepad; screen-wake-lock"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
  style="width: 100%; aspect-ratio: 16/9; border: 0;">
</iframe>
```

- **`allow=`**. Must list every feature granted by `Permissions-Policy`
  that the game wants to use. Missing this attribute = the feature is
  blocked even if the policy permits it. Both the store-internal
  embed code and the "Copy embed code" snippet (§5) include this
  verbatim.
- **`sandbox=`**. **NOT** set. Setting `sandbox` would block
  pointer-lock and many other features the game needs. The cross-
  origin boundary already provides storage / cookie / DOM isolation
  without `sandbox`. We rely on origin-isolation, not sandbox-
  isolation, for the trust model in §6.
- **`loading="lazy"`**. The catalog page may render multiple pack
  cards with embedded preview frames; lazy-load avoids spinning up
  every game runner on scroll.
- **`referrerpolicy`**. Sends origin info to the runner so the runner
  can log "which embedder loaded this pack" for usage stats, without
  leaking full paths.

### 3.3 Cross-origin storage partitioning

Modern browsers (post-Chromium 115, Safari 17, Firefox 103) partition
`IndexedDB`, `localStorage`, `sessionStorage`, and Cache Storage by
the **tuple of (storage origin, top-level site)**. That means:

- A pack opened directly at `game.two5d.example/?pack=foo` has its
  save data scoped to `(game.two5d.example, game.two5d.example)`.
- The **same pack** opened inside an iframe at `store.two5d.example`
  is scoped to `(game.two5d.example, store.two5d.example)`.
- The **same pack** embedded on `someblog.com` is scoped to
  `(game.two5d.example, someblog.com)`.

All three are separate storage partitions. A save game from one is
invisible to the others.

Two responses possible:

1. **Accept it.** Document the limitation, advise players that
   "playing on the store" and "playing standalone" are separate save
   slots. Cheapest implementation.
2. **Recommended: explicit pack-id-scoped storage with cross-
   partition handoff.** The engine's storage layer keys saves by
   `(pack-id, slot-id)` rather than relying on the browser to do
   it implicitly. Then we add an optional `postMessage`-driven
   handoff: when the iframe boots, the store's wrapping page can
   post `{ kind: "saves-handoff", saves: SavesPayload }` and the
   runner imports them into its partition. This makes "I played on
   the store, then installed as PWA" feel continuous, even though
   the underlying storage really is partitioned. The handoff is
   opt-in per pack — packs that don't care can ignore it.

Recommend (2) but ship (1) as ST1's behaviour with (2) folded into
ST3 (per-pack PWA phase). The engine work for explicit pack-id-
scoped storage is independent of the store website and folds into
ENGINE_PACK_SPLIT.

### 3.4 Audio autoplay

Browsers gate `AudioContext.resume()` and `<audio>.play()` behind a
user gesture. Inside a cross-origin iframe the gesture must happen
*inside the iframe* — the store's "Play" button click does **not**
satisfy autoplay policy for the runner.

The runner already has its own user-gesture-to-unlock flow (click
anywhere to focus + capture pointer); this naturally serves as the
audio unlock. The store's job is only to NOT auto-load audio in the
iframe — i.e., the store cannot `postMessage({ kind: "play" })` and
expect audio to start. The iframe owns its own first-gesture
handler.

Documentation requirement: the store's pack page renders a small
"Click inside the game to enable sound" hint over the iframe until
the runner posts back `{ kind: "ready", audio: "unlocked" }`.

### 3.5 postMessage protocol

Minimal, defined here. The store and the iframe runner exchange
small structured messages on `window.postMessage`. Schema:

```ts
// store → iframe
type ParentMessage =
  | { kind: "request-install-prompt" }      // user clicked "Install as app"
  | { kind: "saves-handoff"; saves: unknown } // optional, see §3.3
  | { kind: "request-fullscreen" };

// iframe → store
type IframeMessage =
  | { kind: "ready"; audio: "locked" | "unlocked"; packId: string }
  | { kind: "install-prompt-result"; outcome: "accepted" | "dismissed" }
  | { kind: "error"; phase: "boot" | "load" | "runtime"; message: string }
  | { kind: "pack-info"; manifest: PackManifestSummary };
```

Origin checks: the runner verifies `event.origin` matches an
allowlist of known embedders (the store's origin, plus any explicit
embed-host registry). The store verifies `event.origin` is the
runner's origin. Both sides ignore messages with the wrong origin
silently.

This protocol is **load-bearing only for install + saves-handoff**.
The game itself plays fine if no messages are exchanged.

---

## 4. Per-pack PWA design

The clever bit. Each pack gets its own installable PWA without the
runner needing to ship a manifest per pack.

### 4.1 Dynamic webmanifest synthesis

The runner serves `game.two5d.example/p/<pack-id>/manifest.webmanifest`
dynamically:

```
GET /p/<pack-id>/manifest.webmanifest
  1. Look up pack-id in the store backend (PACK_CHAIN.md §10) OR
     accept ?packUrl= query param for unstored packs.
  2. Fetch the pack's manifest.json from the resolved URL.
  3. Extract: name, description, author, icon path.
  4. Read the icon image, possibly resize to 192/512 sizes via an
     image-transform CDN, OR cache pre-generated sizes (cheap path).
  5. Return a webmanifest JSON:
     {
       "name": <pack.name>,
       "short_name": <pack.short_name ?? pack.name>,
       "description": <pack.description>,
       "start_url": "/p/<pack-id>/?pack=<original-pack-url>",
       "scope": "/p/<pack-id>/",
       "display": "fullscreen",
       "orientation": "landscape",
       "background_color": <pack.theme.bg ?? "#0f172a">,
       "theme_color": <pack.theme.fg ?? "#0f172a">,
       "icons": [
         { "src": "/p/<pack-id>/icon-192.png", "sizes": "192x192", ... },
         { "src": "/p/<pack-id>/icon-512.png", "sizes": "512x512", ... }
       ]
     }
```

Notes:

- `start_url` includes the pack URL (or a backend-resolved alias) so
  the installed PWA always launches with the right pack pre-loaded.
- `scope` is path-scoped per pack-id. This is the key that lets
  multiple installed packs coexist as separate apps. Each pack gets
  `/p/<pack-id>/` as its scope and its service worker stays inside
  that scope.
- Icons are cached on the server side keyed by pack-id + version, so
  the runtime cost of serving the manifest is one Supabase lookup
  plus a static-file response.

### 4.2 Service worker scoping

The existing `apps/game/public/sw.js` registers at `/sw.js` with
default scope `/`. For per-pack PWAs we serve the same logic at
`/p/<pack-id>/sw.js` with header `Service-Worker-Allowed: /p/<pack-id>/`.
This is straightforward — the server already special-cases `/sw.js`
in `apps/game/server.ts`; extend the route matcher to match
`/p/*/sw.js` and add the right header.

Each pack-scoped SW caches:

- The runner bundle (shared across all packs via `/index-<hash>.js`
  in the cache — the SW just opens the global cache by URL and
  reuses bytes if already fetched by another scope).
- The pack's `.apg` itself.
- The pack's manifest + icons.

Cache version key: `${PACK_ID}-${PACK_VERSION}`. Activating a new
version cleans up the previous version's cache for that pack id.

### 4.3 Install flow

`BeforeInstallPromptEvent` fires inside the iframe (the runner's
origin) — not in the store. So the install flow goes:

1. Runner catches `beforeinstallprompt`, stores it, posts
   `{ kind: "ready", canInstall: true }` to the parent.
2. Store renders an "Install as app" CTA in its chrome around the
   iframe.
3. User clicks the CTA → store posts `{ kind: "request-install-prompt" }`.
4. Runner calls the stored prompt's `.prompt()` method, awaits the
   user choice, posts back `{ kind: "install-prompt-result", outcome }`.
5. Store updates the CTA accordingly ("Installed" / "Try again later").

If the user is browsing directly on `game.two5d.example/?pack=URL`
(no store chrome), the runner can show its own install affordance
inline. Both flows reuse the same prompt object.

### 4.4 PWA capabilities

Each installed pack PWA gets:

- A standalone window with the pack's name + icon in the OS dock /
  taskbar / homescreen.
- Offline play (SW caches `.apg` + bundle).
- Push notifications, IF the pack opts in via a manifest field
  (deferred; not in ST3 scope).
- File-handler / protocol-handler registration is OUT of scope for
  v1 — they're nice-to-have for "open .apg files in the installed
  app" but require additional manifest fields and OS plumbing.

---

## 5. Embed-anywhere widget

A side-effect of §3, surfaced explicitly so modders know to use it.

### 5.1 The snippet

Each pack page renders a "Copy embed code" button. The copied HTML:

```html
<!-- Play <Pack Name> by <Modder> — powered by two_5_d -->
<iframe
  src="https://game.two5d.example/?pack=https%3A%2F%2F...%2Fpack.apg"
  allow="fullscreen; pointer-lock; gamepad; screen-wake-lock"
  loading="lazy"
  style="width: 100%; aspect-ratio: 16/9; border: 0;"
  title="<Pack Name>"></iframe>
```

Customisation knobs (rendered as form fields next to the snippet
preview):

- **Pack URL** — defaults to the store-resolved URL but the user can
  paste any URL (so the snippet works for self-hosted packs too).
- **Width** — `100%` / fixed pixel / responsive.
- **Aspect ratio** — `16/9` / `4/3` / `1/1` / custom.
- **Start scene** — appended as `&scene=<path>` per the existing
  `?scene=` URL param.

### 5.2 The warning

The copy dialog includes a clear notice that embedding a pack runs
that pack's code:

> Embedding this pack will load `<pack-url>` from `<host>`. The pack
> can run JavaScript inside the embed (sandboxed to its iframe). If
> you're embedding a pack you didn't author, only do so from sources
> you trust.

This warning is most relevant for embeds of *untrusted-URL* packs.
Store-curated packs whose `.apg` integrity matches the published
hash get a softer dialog ("This pack is curated by the two_5_d
store"). See §6 for the curated-vs-untrusted distinction.

### 5.3 Who benefits

- **Modders' own sites** — drop the snippet on a personal portfolio
  and you have a playable demo.
- **Game-mod blogs / reviewers** — embed the pack alongside the
  review text for an "in-page demo" experience.
- **itch.io / Game Jolt-style portfolios** — even without those
  platforms officially supporting two_5_d, the `<iframe>` works
  inside their HTML embed fields.
- **Discord / forum link unfurls** — not directly, since Discord
  unfurls don't run iframes, but the store's pack page gets an OG
  card with the same pack art so links unfurl into a "Play" CTA.

The store's contribution here is purely the snippet generator and
the warning text. The underlying capability comes from `<iframe>`
+ the runner's permissive frame-ancestors.

---

## 6. Trust model interaction

The iframe boundary is **strictly better** than direct pack-loading
for untrusted-URL packs, and this is worth saying out loud.

### 6.1 Why iframe-isolation helps

Cross-origin iframe means the embedded pack:

- Cannot read the store's `document.cookie`.
- Cannot read the store's `localStorage` / `sessionStorage` / IDB
  (the runner has its own, partitioned per §3.3).
- Cannot read the store's DOM (no `parent.document.querySelector`).
- Cannot navigate the top-level page (without user consent).
- Cannot exfiltrate data via `postMessage` unless the store
  explicitly listens for and trusts that message.

The pack can still:

- Run JavaScript inside its iframe.
- Make network requests (subject to CORS).
- Open popups (if user-gesture-initiated).
- Use ~50% of the browser's storage quota *for its own origin's
  partition* — none of which is the store's.

This is a **better** trust posture than direct pack loading, where
all of the above lives in the same origin as whatever site loaded
the pack.

### 6.2 Store curation tiers

Two tiers, both embeddable:

- **Store-curated packs.** Published via the editor's publish flow
  (§9), uploaded to the store's CDN, manifest + integrity hash
  recorded in the Supabase tables. The store embeds these without
  warning; the integrity hash gives byte-for-byte trust.
- **Untrusted-URL packs.** A user pasted a pack URL into the store's
  search-by-URL field, or arrived via a deep link like
  `store.two5d.example/play?packUrl=https%3A%2F%2F...`. The store
  embeds these but renders a persistent banner overlaying the
  iframe:

  > This pack is from a source we don't curate. It runs in a
  > sandboxed iframe, so it cannot access this site. We can't
  > verify its content; play at your own discretion.

Both tiers use the same iframe contract. The only difference is the
banner and the absence of an integrity guarantee.

### 6.3 Composition with PACK_CHAIN's trust modal

[PACK_CHAIN.md](./PACK_CHAIN.md) §8 specifies a trust modal inside
the engine for untrusted dependency URLs. That modal still triggers
inside the iframe — it's the runner's responsibility, not the
store's. So an untrusted-URL pack that depends on a *further*
untrusted URL will:

1. Store renders the iframe with the untrusted-source banner.
2. Iframe runner boots, parses the manifest, sees an untrusted
   `requires[].url`.
3. Runner renders its own trust modal asking the user to confirm.
4. User confirms (or not) → runner proceeds.

The store does NOT need to know anything about the transitive trust
chain. That's the runner's job.

---

## 7. Routing

### 7.1 Store website

| Path | Purpose | Render |
|---|---|---|
| `/` | Home: featured packs, "what's new," browse-by-tag entry. | SSG. |
| `/p/<pack-id>` | Pack detail page: description, screenshots, version history, modder profile, license, "Play" / "Install" / "Open in editor" / "Copy embed code" CTAs. | SSG per pack at build/deploy time; ISR or on-demand revalidation on new versions. |
| `/p/<pack-id>/play` | Full-screen play page: iframe at center, minimal chrome (back button, install CTA, copy-embed). | SSG. |
| `/m/<modder-id>` | Modder profile: bio, links, list of their packs. | SSG. |
| `/search` | Search page: text + tag filters + sort. | Client-side over a pre-built search index, OR a serverless function hitting Supabase full-text search. |
| `/embed-builder` | Standalone tool: paste a pack URL, configure dimensions, get a snippet. Works even for non-store packs. | Static. |
| `/play?packUrl=<URL>` | "Untrusted-URL play" entrypoint. Renders iframe with untrusted banner. | Static. |
| `/sitemap.xml`, `/rss.xml` | Discoverability. | Generated at build. |
| `/og/<pack-id>.png` | OpenGraph card image, dynamically composed from the pack's icon + name. | Edge function. |

### 7.2 Game runner

| Path | Purpose |
|---|---|
| `/` | The default-pack runner (current behaviour). Also accepts `?pack=URL`. |
| `/?pack=<URL>` | Runner with arbitrary pack URL (existing). |
| `/p/<pack-id>/` | Pack-scoped runner. Same code, scoped path for PWA SW + manifest separation. Resolves `pack-id` via the store backend; loads the pack's current latest version (or `?version=…` to pin). |
| `/p/<pack-id>/manifest.webmanifest` | Dynamic per-pack webmanifest (§4.1). |
| `/p/<pack-id>/sw.js` | Pack-scoped service worker (§4.2). |
| `/p/<pack-id>/icon-192.png`, `/p/<pack-id>/icon-512.png` | Pre-generated pack icons. Cached on the CDN keyed by `<pack-id>-<version>`. |

### 7.3 Cross-linking

- Store `/p/<id>` "Play" → opens `game.two5d.example/p/<id>/` in
  iframe inside `store.two5d.example/p/<id>/play`.
- Store `/p/<id>` "Install as app" → triggers BIP via postMessage
  per §4.3.
- Store `/p/<id>` "Open in editor" → opens
  `editor.two5d.example/?openPackUrl=<resolved-pack-url>` per
  [EDITOR.md §9.2](./EDITOR.md).
- Editor's "Publish to store" → uploads and redirects to
  `store.two5d.example/p/<new-pack-id>` per §9.

---

## 8. Backend integration

Thin layer over the API specified in
[PACK_CHAIN.md §10](./PACK_CHAIN.md). The store website consumes
that API; it does not extend it materially.

### 8.1 Read endpoints consumed

```
GET  /api/packs?q=&tag=&sort=&page=        — list/search
GET  /api/packs/:id                         — full pack metadata
GET  /api/packs/:id/latest                  — latest version manifest
GET  /api/packs/:id/:version                — specific version
GET  /api/packs/:id/versions                — version history list
GET  /api/modders/:id                       — modder profile (added)
GET  /api/modders/:id/packs                 — modder's pack list (added)
```

The `modders` endpoints are net-new on top of PACK_CHAIN's schema —
two small additions to the existing Supabase tables:

```sql
-- Already specified in PACK_CHAIN.md §10:
--   create table packs ( id, name, description, author_user_id, ... )
--   create table pack_versions ( pack_id, version, manifest, download_url, ... )

-- Added by the store layer:
create table modder_profiles (
  user_id uuid primary key references auth.users,
  handle text unique not null,            -- slug for /m/<handle> URLs
  display_name text,
  bio text,
  homepage text,
  created_at timestamptz default now()
);

create table pack_tags (
  pack_id text references packs(id),
  tag text not null,
  primary key (pack_id, tag)
);
```

These are additive and live in the same Supabase project as
PACK_CHAIN's tables. The migration is small enough to ship alongside
the store's ST2 phase.

### 8.2 Caching strategy

The store is SSG: every pack page is rebuilt on a schedule or
on-demand when its version changes. Two triggers:

- **Webhook from Supabase** → re-export the affected pack page on
  publish.
- **Scheduled rebuild** every N hours catches anything missed.

The runtime cost of an individual pack-page visit is "fetch a
static HTML file from the CDN." This keeps store-side hosting cheap
and predictable.

### 8.3 Search

Two viable paths:

1. **Client-side over a build-time index.** Lunr.js or a custom
   tiny inverted-index serialised to JSON. Works for catalogs up to
   ~10k packs (~MB-scale index). Zero backend cost.
2. **Supabase full-text search via a serverless function.**
   `tsvector` index on `packs(name, description) || tags`. Scales
   better.

Recommend (1) for ST2 and (2) when the catalog crosses ~1k packs.

---

## 9. Publishing round-trip

The editor's "Publish to store" action (an EDITOR phase-E6+ item,
not yet detailed in EDITOR.md) is owned here on the consuming side.
Contract:

### 9.1 Upload flow (editor → store)

```
Editor "Publish to store" clicked:
  1. Confirm: prompt for visibility (public / unlisted) + tags.
  2. Run §8 export pipeline to produce a .apg blob in-memory.
  3. Compute SHA-256 (already part of export modal in EDITOR.md §8).
  4. POST <store-api>/api/packs (or /api/packs/:id/versions if updating):
       Content-Type: multipart/form-data
       fields:
         - file: <the .apg blob>
         - manifest: <JSON of the pack manifest>
         - integrity: "sha256-..."
         - visibility: "public" | "unlisted"
         - tags: ["fps", "horror", ...]
       auth: Bearer <Supabase session JWT>
  5. Server-side (Supabase Edge Function):
       - Verify JWT, resolve author_user_id.
       - Validate manifest against the schema in PACK_CHAIN.md §2.
       - Verify integrity hash matches uploaded bytes.
       - Reject if pack-id is taken by a different user.
       - Reject if version is older than current latest (no
         backdated versions).
       - Store .apg in Supabase Storage / configured CDN.
       - Insert/update rows in packs + pack_versions + pack_tags.
       - Return { id, version, page_url }.
  6. Editor redirects user to <page_url> = store.two5d.example/p/<id>.
```

### 9.2 First-publish vs update

- **First publish** (`POST /api/packs`): server picks the pack id
  from `manifest.id`. Conflict → 409 with suggestion (`my-pack-2`).
- **Update** (`POST /api/packs/:id/versions`): server requires
  caller to be the original `author_user_id`. New version must be
  strictly greater than current latest per semver.

### 9.3 Unstoring

Modders can mark a version as "yanked" (still downloadable for
existing pinned deps, hidden from the store's listing) via a
`PATCH /api/packs/:id/:version { yanked: true }`. Full deletion is
deferred — keeps PACK_CHAIN's URL-stable promise for downstream
deps that pinned a version + integrity.

---

## 10. Phases

Each phase ships independently with a usable result.

### ST1 — Static store + iframe embedding

**Smallest shippable thing.** No Supabase, no auth, no publish flow.

- Scaffold `apps/store/` (Next.js static export).
- Hard-code the catalog from a JSON file (`apps/store/src/catalog.json`)
  with two or three known packs (default-pack, plus whatever sample
  packs the project has).
- Pack pages render: name, description, screenshots, "Play" button.
- "Play" mounts the iframe pointing at `game.two5d.example/?pack=<URL>`.
- Game runner side: add the `Content-Security-Policy: frame-ancestors *`
  and `Permissions-Policy` headers in `apps/game/server.ts`.
- Acceptance: visit `store.local/p/default-pack`, click Play, walk
  around scene1 inside an iframe with store nav above it.

### ST2 — Supabase integration

- Migrate to the Supabase-backed API once
  [PACK_CHAIN.md §10](./PACK_CHAIN.md) P4 lands.
- Replace `catalog.json` with API calls to `/api/packs`.
- Add modder profile + tags tables (§8.1).
- Implement search (client-side index for v1).
- Acceptance: publish a test pack via raw SQL insert + Supabase
  Storage upload, see it appear on the store front page and have a
  working `/p/<id>` page.

### ST3 — Per-pack PWA

- Dynamic webmanifest route on the game runner.
- Path-scoped service worker registration.
- Engine work: explicit pack-id-scoped storage so saves are
  partition-survivable.
- postMessage protocol for `request-install-prompt` + `saves-handoff`.
- Acceptance: install a pack as a PWA, launch it from the OS
  app launcher, see it open standalone with its own icon and load
  straight into the right pack.

### ST4 — Embed-anywhere widget

- Pack-page "Copy embed code" affordance.
- `/embed-builder` standalone page (works for non-store packs).
- Warning text for untrusted-URL embeds.
- `/play?packUrl=<URL>` entrypoint with untrusted-source banner.
- Acceptance: copy snippet from a pack page, paste into an
  external HTML file, open in a browser, play the game in-page.

### ST5 — Publish flow integration

- Editor "Publish to store" button per §9 (lives in EDITOR.md as a
  later phase; STORE side is the upload-handling endpoint).
- Supabase Edge Function for `POST /api/packs` and
  `POST /api/packs/:id/versions`.
- Auth UI on the store (sign in via Supabase OAuth) for managing
  one's own packs.
- "My packs" dashboard at `/dashboard` for modders to see / yank /
  retag their published packs.
- Acceptance: author a pack in the editor, click Publish, complete
  OAuth, see the new pack appear at `/p/<id>` within seconds.

---

## 11. Open questions

1. **Framework choice for `apps/store/`.** Next.js vs Astro vs
   pure-Bun + a static-site generator. Recommend Next with
   `output: "export"` for SSG + image optimisation + per-page SEO,
   deployable to any static host. Confirm before ST1.
2. **Single-origin vs split-origin.** This doc assumes
   `store.two5d.example` and `game.two5d.example` are separate
   origins so the iframe cross-origin boundary actually exists.
   Alternative: put both behind one origin and use COOP/COEP +
   `sandbox` for isolation. The split-origin approach is simpler,
   gets storage partitioning for free, and matches the
   "embed-anywhere" goal (embedders live on yet-other origins).
   Recommend split. Confirm naming convention before ST1
   (`store.two5d.dev` vs `store.two5d.example` vs whatever the
   project's actual production domain is — depends on user
   preference).
3. **CSP `frame-ancestors *` default vs allowlist.** The doc
   recommends `*` so any site can embed. Alternative: allowlist
   the store origin + an opt-in registry. `*` is more aligned with
   the URL-pack-substrate principle but invites embed abuse
   (clickjacking the install prompt, e.g.). Mitigation: the install
   prompt is fired from inside the iframe via BIP, which the browser
   gates with its own UI; clickjacking the postMessage doesn't get
   you anything more than what the user can do themselves. Recommend
   `*` with the env-var override hatch documented.
4. **OG card generation.** Build-time vs edge-function. Build-time
   is simpler but stale when manifest changes. Edge function
   (Vercel OG / Cloudflare Workers) regenerates on demand. Recommend
   build-time for ST2, migrate to edge function in ST5 when
   "publish" can mutate manifests.
5. **Multiplayer playable-online badge.** Manifest field name and
   surfacing. Recommend `manifest.multiplayer = { hostUrl?: string,
   maxPlayers?: number }` and a simple "Playable online" badge on
   pack cards. Resolve with MULTIPLAYER_PLAN author before ST2.
6. **Untrusted-URL play entrypoint anti-abuse.** `/play?packUrl=<URL>`
   could be abused to load malicious packs and frame them with the
   store's chrome (visually implying endorsement). Mitigation:
   render the untrusted banner over the iframe AND mark the page
   `<meta name="robots" content="noindex">` so untrusted plays
   don't get search-indexed. Confirm before ST4.
7. **Cross-partition saves handoff (§3.3).** Whether to ship the
   postMessage saves-handoff in ST3 or defer to a later phase.
   Recommend ship in ST3 — the per-pack PWA is the moment players
   notice "wait, my save's gone."
8. **Monetization placeholder.** Out of scope for ST1–ST5, but the
   schema should not preclude paid packs. Recommend adding a
   `pricing` field to the `packs` table at ST2 schema-design time
   with a default of `"free"`, even though no payment plumbing
   exists. Avoids a costly migration later.

Decisions can be deferred to the start of the relevant phase. None
block ST1.
