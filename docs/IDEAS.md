# Ideas log

Running record of design ideas thrown out in conversation, captured
before they become plan docs or tasks (or after, with a back-reference).

Newest at the top. Format:

```
## YYYY-MM-DD — short headline

One-paragraph description. Status: <Status>.

Refs: <#task>, <plan doc>, <commit>.
```

Status vocabulary:
- **Captured** — opened as a task; not yet started.
- **Planning** — plan doc exists or being written.
- **In progress** — task is being implemented.
- **Shipped** — landed, with commit ref.
- **Deferred** — explicitly punted to a later phase.
- **Discarded** — considered, rejected. With one-line "why not."

---

## 2026-05-16 — Procedural assets (image + audio recipe DSL)

Tiny recipe files (~200 bytes) replace rasterized assets (~50 KB).
Engine generates textures + audio at load via a layered op library
(noise / pattern / colorize / shadow for images; tone / noise /
filter / envelope / distortion for audio). Recipe DSL compiles to
deterministic WebGL fragments + Web Audio node graphs under the
hood. IDB cache after first generate. Per-instance variation via
seeded ops (every brick wall subtly different, zero ship cost).
Editor exposes node-graph or layer-stack UI for authoring.

Status: Captured (plan doc PROCEDURAL_ASSETS.md pending).

Refs: #202 (multi-phase: PROC1 plan / PROC2 image engine /
PROC3 audio engine / PROC4 image editor / PROC5 audio editor).

---

## 2026-05-16 — Idea log + plan-doc audit

This very file. Plus an audit pass that produced
`docs/AUDIT_2026-05-16.md` (767 lines) — 18 docs audited, top
findings: SESSION_STATE.md 12 commits stale, 6 plan docs with
"not started" rows for phases that shipped, ENGINE_PACK_SPLIT.md
§R4/§R5 should redirect to newer canonical docs.

Status: Shipped (audit report). Follow-up: apply recommendations.

Refs: #201 (audit), follow-up dispatch incoming for fixes.

---

## 2026-05-16 — Command policy / permissions system

Console commands gated by a `commands.json` config: build-time
stripping (e.g. `eval` excluded from publish builds entirely) +
runtime gating by role + custom predicates. Project Settings →
Commands tab with mode preview ("as a player in publish mode,
here's what's available").

Status: Captured. Folded into #199.

Refs: #199 (CONSOLE.md plan + impl phases C1–C4).

---

## 2026-05-16 — In-engine developer console

Quake/Source-style console with backtick toggle. `api.console`
namespace, built-in commands (help/spawn/tp/set/get/eval/scene),
pack-registered commands, autocomplete + history, themable via
`api.ui.registerModal("dev_console", ...)`.

Status: Captured. CONSOLE.md not yet written.

Refs: #199.

---

## 2026-05-16 — Tile preset workflow in cell inspector

Click preset path → edit in modal. Per-preset usage stats (this
scene + cross-scene). Highlight-all-cells button. Unlink cell to
anonymous-preset copy (preserves source link until user diverges).

Status: Captured.

Refs: #198 (TILE_PRESETS T4 territory).

---

## 2026-05-16 — Hybrid prefabs: declarative + initScript

Declarative prefabs can reference an optional `initScript` that
runs after static components attach, with (entity, opts, api).
Editor can convert existing JS prefabs to this hybrid via
`@babel/parser` AST walk — static `world.add` calls extract to
declarative, dynamic logic stays in the init script. Side-by-side
diff before commit.

Status: In progress.

Refs: #196 (agent running).

---

## 2026-05-16 — Project Settings modal reorg

Manifest editor moved out of the Map tab into a dedicated Project
Settings modal with tabs (Manifest / Dependencies / Export /
Advanced). Map tab becomes pure grid editor + scene list.

Status: Shipped.

Refs: #197 (commit `1961fd3`).

---

## 2026-05-16 — Dependency manager with auto-integrity-hash

Editor's Add-dependency flow: fetch URL → compute SHA-256 → parse
parent manifest → auto-populate integrity, version (^parent),
id (parent.manifest.id). On user-provided hash mismatch, show
both hashes side-by-side and let them [Update + proceed] / [Cancel].
Per-dep `enabled` checkbox, drag-to-reorder for priority
(bottom = highest precedence per last-wins).

Status: Shipped. Subsumed #194 fully.

Refs: #197, commit `1961fd3`.

---

## 2026-05-16 — Pack export modes (build full vs extend)

Two export options when publishing: BUILD FULL = self-contained
standalone .apg with flattened chain. EXTEND = lean .apg with
diffs only + requires[] pointing at parent. Modder picks at export.

Status: Captured.

Refs: #192 (folds into E5).

---

## 2026-05-16 — Semver enforcement on requires[].version

Tiny ChainResolver extension. `requires.version: "^1.2.3"` checks
parent's manifest.version satisfies the range; throws on mismatch
with both versions shown. Supports exact/caret/tilde subset.

Status: In progress.

Refs: #193 (agent running).

---

## 2026-05-16 — FBX → spritesheet via Three.js (the headline)

In-editor FBX importer using Three.js + FBXLoader. User picks
angle count, frame count, cell size, forward direction. Editor
renders the rigged model from each angle at each animation frame,
composites into a canonical multi-angle spritesheet matching
ANIMATIONS.md §5. Output is consumable by the engine's existing
Animation system — engine never knows it came from FBX.

Status: In progress.

Refs: #200, ANIMATION_EDITOR.md §6.

---

## 2026-05-16 — Multi-angle sprite convention (1/2/4/5/8/16)

Doom-style nearest-neighbor angle selection. 1 angle = view-
independent (pickups). 4 = N/E/S/W (NPCs). 8 = 45° split (classic
Doom enemies). Mirror optimization for 5-angle (symmetric flips).
Optional crossfade for non-pixel-art assets.

Status: Shipped (snap selection). Mirror + crossfade = A2.

Refs: ANIMATIONS.md §3, commit `ab9dbee`.

---

## 2026-05-16 — Per-entity shader attachment (Shader component)

ECS Shader component holding `{worldHooks?, spriteHooks?, skyHooks?}`
paths. Engine collects unique variants at scene load, assembles
all into one program, branches per-pixel on variant id. Tile
presets gain the same `shader` field for cell-level overrides.
Scene-level `shaders` block for global per-scene styling. Three-
tier hierarchy: pack → scene → material, most-specific wins.

Status: Shipped (M1+M2+M3+M5). M4 chain cascade also shipped.

Refs: MATERIALS.md, commits `bdab12a` / `be31fea`.

---

## 2026-05-16 — Editor iframe pivot

Editor embeds the game runner via iframe instead of mounting the
engine in React. Same-origin IDB sharing. Message protocol for
live invalidation (scene-changed, switch-scene, reset). Eliminates
HUD overlay leak / modal positioning bugs / Tailwind isolation /
ResizeObserver plumbing entirely.

Status: Shipped (I1). I2 = player-state telemetry + edit-camera.

Refs: EDITOR_IFRAME.md, commit `ab9dbee`.

---

## 2026-05-15 — Pack-proxy via Supabase Edge Function

Backstop CORS-hostile hosts. Edge function fetches the pack
server-side (no CORS issue server→server), validates it
(manifest exists, size limit, no directory traversal, basic
malware heuristics), returns bytes with permissive CORS headers.
Memory-only, no bucket storage. Layered with the GitHub URL
rewrite — direct fetch first, proxy fallback.

Status: Captured (plan doc not yet written).

Refs: PACK_PROXY task (not yet created, see conversation).

---

## 2026-05-15 — GitHub CORS URL rewrite

Client-side regex transforms `github.com/.../blob|raw/[refs/heads/]BRANCH/PATH`
→ `raw.githubusercontent.com/.../BRANCH/PATH`. Solves "I uploaded
my pack to GitHub" case without any backend.

Status: Shipped.

Refs: `packages/engine/src/AssetPack/rewriteUrl.ts`, commit `ab9dbee`.
