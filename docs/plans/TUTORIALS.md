# Tutorial system — guided tours for every editor surface

A plan for cardboard's **guided tutorial system**: JSON-authored,
spotlight-rendered, reactive walkthroughs that teach a new user how
to use a given editor view. Tutorials launch from the `EmptyState`
primitive's `tutorial?: string` prop (already wired as a no-op in R2
per [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) §12 Q10), from the
TopBar **Help** menu, and from deep links. Every empty view gets a
"▶ Start tutorial" launcher for free the day this system ships; no
per-view migration is required.

Tutorials are **declarative JSON trees of steps**. Each step
highlights a DOM element, shows a speech bubble, and advances on a
specified condition (clicked element, key press, scene event, timer,
or explicit Next). Built-in tutorials ship with default-pack; mods
ship their own via the pack-chain.

Source-of-truth for implementation. Phases T1–T5 below. Cross-refs:
[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) §12 Q10 (entry point —
`EmptyState.tutorial` prop), §4.24 (the `EmptyState` primitive
itself), §6 (shell — TopBar Help menu),
[MATERIALS.md](./MATERIALS.md) (tone reference — declarative
hierarchy with a code escape hatch),
[UI_BUILDER.md](./UI_BUILDER.md) (parallel pattern — JSON-first
authoring, pack-distributable, editor authoring tab),
[PACK_CHAIN.md](./PACK_CHAIN.md) (T5 — pack-authored tutorials ride
the pack-chain),
[STORE.md](./STORE.md) (T5 — shareable tutorial artefacts),
[CONSOLE.md](./CONSOLE.md) (tutorials may emit + listen for engine
events through the same telemetry channel),
[IDEAS.md](../IDEAS.md) (2026-05-16 Q10 follow-up — "tutorial system
gets its own task / plan doc after editor-redesign R5 ships").

Last revised: 2026-05-17.

---

## 0. tl;dr

A `.tutorial.json` is a small tree (~500 B – 8 KB) of `Step` objects
inside a top-level `Tutorial` record. Each step pairs a **target**
(a CSS selector or a registered editor element id) with a **hint**
(a short string) and an **advance condition** (`click`, `key`,
`event`, `timer`, or `next`). The editor renders an overlay: a
full-viewport dim layer punched out by an SVG mask around the
target, plus a speech bubble anchored to the target's edge with the
hint, a Skip button, and (for `next`-advance steps) a Next button.
When the advance condition fires, the overlay re-targets to the next
step's element. When the last step's condition fires, the tutorial
records "completed" in `localStorage` and dismisses.

The launcher surface is **the `EmptyState` primitive's
`tutorial?: string` prop**. Every empty view already passes a slug
(`scripts-intro`, `entities-intro`, etc.) — once this system ships,
`EmptyState` renders a secondary "▶ Start tutorial" button when the
slug is set, and clicking it invokes
`api.tutorials.start("<slug>")`. Other launchers — the TopBar Help
menu's "Tutorials…" submenu and `?tutorial=<slug>` deep-link query
parameters — wire to the same dispatch.

Built-in tutorials cover the nine top-level views (Home, Map,
Entities, Animation, Scripts, Image Lab, Sound Lab, UI Builder,
Project). Pack-authored tutorials are first-class — a community-
shipped pack drops `.tutorial.json` files in `tutorials/` and they
register at pack-load time, alongside (or replacing) the built-ins
per the pack-chain's last-pack-wins semantics. T5 enables pack
tutorials.

Determinism is the same contract as the other declarative systems
(Image Lab, Sound Lab, UI Builder): the JSON is the only input;
given the same JSON + the same editor build, the overlay sequence
is identical. No code lives inline in tutorial JSON — advance
conditions reference **named events** registered by the editor
runtime, never arbitrary JS.

Why bother? Two reasons. First, **discoverability**: cardboard's
editor has ~16 top-level surfaces (R4a–R4i + R5), each with its own
inspector / canvas / palette idiom. A new user landing on a blank
Scripts tab has no idea what a "pack script" is, where to type, or
how to bind one to an entity. A 60-second guided tour, anchored to
real DOM elements that the user is *about* to interact with, turns
that 0-to-1 cliff into a hand-rail. Second, **mod onboarding**: a
pack that introduces a new mechanic (a survival-mode pack, a 4-
player co-op pack, an Image-Lab graph template pack) can ship its
own tutorial explaining its conventions. Discovery of mod features
piggy-backs on the same surface that teaches the engine itself.

---

## 1. Goals & non-goals

### Goals

- **JSON-authored tutorials.** A `.tutorial.json` describes a
  complete walkthrough as a flat array of step objects. No
  hand-rolled `.tsx` per tutorial; authoring is editable in any
  text editor and (T-future) in a visual builder.
- **Reactive advance conditions.** Steps advance on user actions
  the user is *about to take anyway* — click the New Project
  button, press `S` to save, navigate to the Scene tab, open the
  Prefabs inspector. Tutorials feel like onboarding, not lecture.
- **Spotlight rendering.** The currently-targeted DOM element is
  visually isolated by a full-viewport dim layer with an SVG mask
  punching a hole (with rounded corners + padding) around the
  target. Standard pattern; familiar from every product-tour SaaS.
- **Per-tutorial persistence.** "Completed" state lives in
  `localStorage` keyed by `cardboard:tutorial:<slug>:completed`.
  Already-completed tutorials don't auto-launch; users can manually
  re-launch from the Help menu or by clicking the EmptyState
  launcher.
- **Pack-authored tutorials.** Mod packs ship `.tutorial.json` files
  in their pack root's `tutorials/` directory. At pack-load time,
  the registry imports them via the same pack-chain semantics as
  shaders / UI trees — last-pack-wins on slug collision.
- **First-run auto-launch.** On the very first launch of the editor
  in a given browser (no `cardboard:firstrun:done` key yet), the
  `home-intro` tutorial auto-starts. Subsequent launches don't
  re-trigger. The first step of `home-intro` includes a "Don't
  show tutorials automatically" toggle that writes a global
  preference flag.
- **Keyboard + screen-reader accessible.** Tab navigates between
  the speech bubble's actions (Next, Skip, Close); the target
  element is announced via `aria-describedby`; the overlay uses
  `role="dialog"` and traps focus when modal-blocking.
- **Reduced-motion respect.** When `prefers-reduced-motion: reduce`
  is set, the overlay skips its fade-in/fade-out animations and
  the spotlight teleports between steps rather than tweening.
- **No new ModAPI surface for the tutorial runtime.** The editor
  ships `api.tutorials.start(slug) / .stop() / .completed(slug) /
  .markCompleted(slug)`. Modders use the same API to launch
  pack-shipped tutorials programmatically (e.g. from a pack's
  custom modal's "Show me how" button).

### Non-goals

- **In-game tutorials.** This system targets the **editor**, not the
  shipped game's pack UI. Pack UI does its own onboarding via
  whatever surfaces its game needs (probably via `api.ui` modals
  + UI Builder); engine-shipped tutorials don't render into the
  iframe playtest. T4 may expose `api.tutorials.start` to the
  playtest context for advanced cases, but the rendering substrate
  is editor-DOM only.
- **Branching tutorials.** Steps are a flat array; no `if user
  did X, jump to step 7` logic. If a tutorial needs to branch,
  ship two tutorials and have one chain to the other via the
  `next` field (§3.1).
- **Inline arbitrary code in JSON.** Same rule as UI Builder — no
  function strings, no `eval`, no JSX. Conditions resolve names
  against a runtime registry the editor populates at boot. Pack-
  authored tutorials extending the registry register named events
  via `api.tutorials.registerEvent(name, ...)` — they ship a tiny
  amount of code alongside the JSON, but the JSON itself stays
  inert.
- **Video / GIF embedding.** A step's `hint` is plain text +
  inline `<kbd>` for key glyphs + inline `<icon>` for Lucide
  glyphs. No images, no videos. If a step needs to show
  something the editor can't physically present, the tutorial
  is the wrong tool — write a docs page instead.
- **Long tutorials.** Each tutorial should be ≤ 12 steps. The
  schema doesn't enforce a cap (a few may want 15 for an
  IL-graph walkthrough), but the **authoring guide** (§8.2)
  pushes hard for ≤ 8. If a tutorial wants 30 steps, it's three
  tutorials.
- **Live remote tutorial updates.** Built-in tutorials ship in the
  editor build; pack tutorials ship in `.apg` packs. No "fetch
  tutorial JSON from a CDN" path. Adding one later is additive
  (a `remoteSource` field) but not in scope.
- **Replacing the docs site.** Tutorials teach the *editor flow*
  for a specific task. They are not API reference, not exhaustive
  manuals; they live alongside docs, not in place of them. The
  speech bubble may include a "Read more →" link to a docs URL
  (§3.2), but the docs are the system-of-record for depth.

---

## 2. Status quo

Today, **nothing**. There is no tutorial framework, no overlay
component, no JSON schema, no registry. The only artefact pointing
at this system is the `EmptyState` primitive's
`tutorial?: string` prop, declared and wired through every
`<EmptyState>` callsite in R2 (`apps/editor/src/components/ui/
EmptyState.tsx` lines 26–27, 39) but **discarded** in the component
body — the comment reads `eslint-disable-line @typescript-eslint/
no-unused-vars` on the destructure. Per [EDITOR_REDESIGN.md](./
EDITOR_REDESIGN.md) §12 Q10:

> Optional `tutorial` prop wired into the primitive from R2 day-one
> as a no-op. When the guided-tour system ships (future task — see
> follow-up), this prop renders a secondary "▶ Start tutorial"
> button that launches the named tutorial. Every empty view gets
> the launcher for free once tutorials exist; no migration churn.

This plan is that "future task." The single code change required
to **light up every EmptyState's launcher button** is roughly:

```tsx
{tutorial && api.tutorials.has(tutorial) && (
  <Button variant="secondary" onClick={() => api.tutorials.start(tutorial)}>
    ▶ Start tutorial
  </Button>
)}
```

(plus the surrounding runtime — see §5.) The R2 EmptyState callsites
already pass slugs; T2 wires the prop through. The slugs already
present in code (audit from EDITOR_REDESIGN R2 callsites):

| EmptyState callsite | Slug already passed | Built-in tutorial |
|---|---|---|
| Home view (no projects) | `home-intro` | §6.1 |
| Map view (no scenes) | `map-intro` | §6.2 |
| Entities view (no prefabs) | `entities-intro` | §6.3 |
| Animation view (no clips) | `animation-intro` | §6.4 |
| Scripts view (no scripts) | `scripts-intro` | §6.5 |
| Image Lab view (no graphs) | `image-lab-intro` | §6.6 |
| Sound Lab view (no patches) | `sound-lab-intro` | §6.7 |
| UI Builder view (no trees) | `ui-builder-intro` | §6.8 |
| Project view (no metadata) | `project-intro` | §6.9 |

All nine slugs need built-in tutorials — see §6 for content
sketches per slug.

No telemetry / no analytics today. T2 is greenfield.

---

## 3. Tutorial JSON schema

JSON files have the extension `.tutorial.json` and live either in
`apps/editor/src/tutorials/` (built-in) or `<pack>/tutorials/`
(pack-authored). Each file declares **one** tutorial. The shape:

### 3.1 Tutorial definition

```jsonc
{
  "$schema": "tutorial/1",
  "id": "scripts-intro",
  "title": "Scripts: 60-second tour",
  "description": "Learn how scripts attach to entities and run on every tick.",
  "tags": ["scripts", "intro"],
  "estimatedSeconds": 60,
  "next": null,                    // optional — slug to chain to on completion
  "prerequisites": [],             // optional — slugs that must be completed first
  "steps": [
    /* see §3.2 */
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `$schema` | string | yes | Version pin. `"tutorial/1"` for V1. Engine refuses unknown schemas (mirror of UI_BUILDER §11 Q13). |
| `id` | string | yes | Slug. Lowercase, `-`-separated. Globally unique within the active pack-chain; last pack wins on collision. Used as the localStorage key suffix, as the `EmptyState.tutorial` prop value, as the deep-link query param value, and as the `api.tutorials.start()` argument. |
| `title` | string | yes | Human-readable label shown in the Help menu and at the start of the tutorial. ≤ 60 chars. |
| `description` | string | yes | One-sentence summary, shown in the Help menu under the title and on the launch confirmation dialog. ≤ 140 chars. |
| `tags` | string[] | no | Filter/category tags for the Help menu's tutorial picker. Default `[]`. Suggested tags: `intro`, `advanced`, `scripts`, `art`, `audio`, `ui`. |
| `estimatedSeconds` | number | no | Author-provided estimate, shown as "~60 seconds" in the launcher. No runtime enforcement; purely informational. Default `null` (hides the estimate). |
| `next` | string\|null | no | On completion, auto-prompt to start this tutorial. Modal: "Continue with **`<next.title>`**? [Yes / Not now]". Used to chain `home-intro → map-intro → scripts-intro` for the first-run flow. Default `null`. |
| `prerequisites` | string[] | no | Slugs that must have `completed=true` in localStorage before this tutorial can launch. Used for advanced tutorials. If unmet, the launcher shows: "Complete *<prereq.title>* first." Default `[]`. |
| `steps` | Step[] | yes | The walkthrough. Min length 1, max length 30 (warning above 12 — see §8.2). |

### 3.2 Step definition

```jsonc
{
  "id": "open-new-script",          // optional, defaults to step index
  "target": "[data-tutorial='scripts.new-button']",
  "hint": "Click **New script** to create your first pack script.",
  "detail": "Pack scripts are TypeScript files that run on engine ticks.",
  "advance": { "kind": "click", "selector": "[data-tutorial='scripts.new-button']" },
  "placement": "right",
  "modal": false,
  "skippable": true,
  "highlightPadding": 6,
  "highlightRadius": 8,
  "onEnter": null,                  // optional — registered event name to dispatch
  "onExit": null,
  "docsUrl": null                   // optional — URL for "Read more →" link
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | no | Stable identifier for analytics + for `goto(<id>)` step jumps (T4-future). Defaults to `step-<index>`. |
| `target` | string\|null | yes | CSS selector for the highlighted element. The editor scans live DOM via `document.querySelector(target)`; the matched bounding box drives the spotlight punch. **Stable selectors**: every interactive editor element gets a `data-tutorial="<view>.<id>"` attribute as part of T2 — see §5.3. Tutorials should target the `data-tutorial` attribute, not class names or DOM structure. `null` is legal for **viewport-centred steps** (intro / outro, no DOM anchor). |
| `hint` | string | yes | Speech bubble body. Supports a tiny Markdown subset: `**bold**`, `_italic_`, `` `code` ``, `[link](url)`, `<kbd>Cmd-S</kbd>`, `<icon name="..." />` (Lucide). ≤ 240 chars. |
| `detail` | string | no | Secondary line shown below `hint`, smaller font. For optional context. ≤ 320 chars. Default `null`. |
| `advance` | AdvanceCondition | yes | What user action progresses to the next step. See §3.3. |
| `placement` | enum | no | Bubble anchor: `"top" \| "bottom" \| "left" \| "right" \| "center"`. Default `"auto"` (the overlay picks the side with the most free space, biased toward `right` for LTR locales). `"center"` means viewport-centre, for `target: null` steps. |
| `modal` | boolean | no | If `true`, the dim layer blocks clicks outside the target (the user *must* interact with the target or Skip). If `false`, clicks pass through to the editor and the user can wander freely; the tutorial waits for the advance condition regardless. Default `false`. Use `true` sparingly — it's coercive. |
| `skippable` | boolean | no | If `false`, hide the per-step Skip button (the global Skip Tutorial button always remains). Default `true`. |
| `highlightPadding` | number | no | Pixels of padding around `target`'s bounding rect for the spotlight hole. Default `6`. |
| `highlightRadius` | number | no | Border radius (px) of the spotlight hole. Default `8`. |
| `onEnter` | string\|null | no | Named event to fire on step entry. Resolves against the editor's event registry (§4). Use for side-effects like "ensure the Scripts tab is open before highlighting its toolbar." Default `null`. |
| `onExit` | string\|null | no | Named event to fire on step advance (before moving to the next step). Default `null`. |
| `docsUrl` | string\|null | no | If set, the speech bubble renders a "Read more →" link below the hint that opens the URL in a new tab. Default `null`. |

### 3.3 Advance conditions

The `advance` field is a discriminated union; one of five `kind`s.

#### 3.3.1 `click`

```jsonc
{ "kind": "click", "selector": "[data-tutorial='scripts.new-button']" }
```

Fires when a DOM element matching `selector` receives a `click`
event (capture phase, listener attached at `document.body`). If
`selector` is omitted, defaults to the step's `target` — by far the
common case (highlight a button, advance when clicked).

#### 3.3.2 `key`

```jsonc
{ "kind": "key", "combo": "Cmd-S" }
```

Fires on a global `keydown` matching `combo`. Combos use the
internal hotkey-string format from R3 (e.g. `"Cmd-S"`, `"Ctrl-Shift-N"`,
`"Escape"`, `"Enter"`). Platform-normalised — `Cmd` maps to `Meta`
on macOS, `Ctrl` elsewhere.

#### 3.3.3 `event`

```jsonc
{ "kind": "event", "name": "tutorial.editor.scene-loaded" }
```

Fires when the editor dispatches a named tutorial event via
`api.tutorials.emit(name)`. The editor runtime emits a fixed set
out-of-the-box (§4 registry). Pack-authored tutorials may listen
for pack-emitted events. This is the **bridge for non-DOM
conditions**: "user successfully saved a project", "user added an
entity to the scene", "the playtest iframe finished loading."

#### 3.3.4 `timer`

```jsonc
{ "kind": "timer", "ms": 3000 }
```

Auto-advances after `ms` milliseconds. Used for **intro splash
screens** (a step that just says "Welcome to Scripts!" and moves on
after 3 s) and for **transitions** that need to wait for animation.
Hard cap at 10 000 ms by the schema validator; longer timers should
use `next` advance with a Next button.

#### 3.3.5 `next`

```jsonc
{ "kind": "next" }
```

Renders an explicit "Next" button in the bubble. The user clicks it
to advance. The fallback for steps that don't naturally have a user
action (an intro splash, a "you've reached the end" outro, a "look
at this read-only thing" callout).

#### 3.3.6 Composite — `any` and `all`

```jsonc
{ "kind": "any", "conditions": [
  { "kind": "click", "selector": "..." },
  { "kind": "key", "combo": "Cmd-S" }
] }
```

`any` advances when **any** sub-condition fires. `all` advances
when **all** sub-conditions have fired (in any order). Sub-conditions
may not themselves be `any` / `all` (depth-1 only — keeps the
runtime tractable). Used sparingly — `any` is useful for "click the
button OR press the shortcut"; `all` is useful for "fill in name AND
press OK." Default `any` over `all` for accessibility (multiple paths
to advance).

---

## 4. Tutorial registry

### 4.1 Where tutorials live

**Built-in tutorials**: `apps/editor/src/tutorials/*.tutorial.json`.
Each file imported via Bun's JSON import + bundled into the editor
build. The registry's bootstrap (`apps/editor/src/tutorials/index.ts`,
new) is:

```ts
import homeIntro from "./home-intro.tutorial.json" with { type: "json" };
import mapIntro from "./map-intro.tutorial.json" with { type: "json" };
// ... etc.

export const BUILTIN_TUTORIALS = [
  homeIntro, mapIntro, /* ... */
];
```

**Pack-authored tutorials** (T5): `<pack-root>/tutorials/*.tutorial.json`.
Discovered at pack-load time by the pack loader's existing
asset-walk (cf. PACK_CHAIN.md §4). The pack manifest also opts in:

```jsonc
// pack.manifest.json
{
  "id": "survival-mode",
  "tutorials": ["survival-mode-intro", "stamina-system"]
}
```

The `tutorials` field is informational only (used by the Store
listing); the actual registration is via JSON-file discovery, so a
pack can add a tutorial without touching its manifest.

### 4.2 Registration

The registry is a singleton at `api.tutorials`. At editor boot:

1. The editor mounts the built-in tutorials from `BUILTIN_TUTORIALS`
   (synchronous; no async loading).
2. For each loaded pack (in pack-chain order — base first, top
   last), the pack loader walks the pack's `tutorials/` directory
   and calls `api.tutorials._register(json)` for each file.
3. On `id` collision, **last-pack-wins** (matches the broader
   pack-chain semantics). A console warning prints when an
   override happens: `[tutorials] survival-mode pack overrides
   built-in 'scripts-intro'`.
4. Each tutorial JSON is validated against the V1 schema. Failed
   validation logs an error to the editor console and **skips**
   the tutorial (the rest of the registry still loads).
5. After all packs load, the registry is **frozen** for the
   session. Hot-reloading a tutorial requires a full editor
   refresh — same constraint as `.glsl` and `.ui.json` hot-reload
   (none).

The internal `_register` is prefixed because **packs don't call
it directly** — the pack loader does. Pack code that wants to
emit events for its own tutorial uses `api.tutorials.emit(name)`
(public).

### 4.3 Lookup by id

```ts
api.tutorials.has(id: string): boolean
api.tutorials.get(id: string): TutorialDef | null
api.tutorials.list(): TutorialDef[]      // sorted by id, then by pack order
api.tutorials.listAvailable(): TutorialDef[]  // .list() minus those with unmet prerequisites
api.tutorials.start(id: string): Promise<TutorialResult>  // resolves when completed/skipped
api.tutorials.stop(): void                // dismiss the active tutorial, no completion mark
api.tutorials.completed(id: string): boolean
api.tutorials.markCompleted(id: string): void  // manual override (used by Settings's "Mark all completed" debug button)
api.tutorials.reset(id?: string): void    // clears completion state for one tutorial, or all
api.tutorials.emit(name: string): void    // fire a tutorial event (advance condition kind=event)
api.tutorials.registerEvent(name: string, desc?: string): void  // pack-side registration of new events (T5)
```

`TutorialResult` is `{ id, status: "completed" | "skipped" | "stopped", durationMs, stepReached }`.
The Promise resolves once the overlay dismisses for any reason.

The runtime is wired by `apps/editor/src/tutorials/runtime.ts` (new
file, T2). The runtime owns the overlay React tree and the active-
tutorial state machine.

---

## 5. Editor runtime

### 5.1 Tutorial launcher surfaces

Three surfaces invoke `api.tutorials.start(slug)`:

#### 5.1.1 EmptyState button (primary surface)

Per §2, every `EmptyState` that has a `tutorial` prop renders a
secondary "▶ Start tutorial" button alongside its primary CTA. The
button's visibility logic:

```tsx
{tutorial && api.tutorials.has(tutorial) && (
  <Button variant="secondary" leadingIcon={<PlayIcon />}
          onClick={() => api.tutorials.start(tutorial)}>
    Start tutorial
  </Button>
)}
```

- If `tutorial` is unset, the button is absent (preserves R2
  behaviour for views that don't ship a tutorial).
- If `tutorial` is set but no matching id exists in the registry
  (typo, deleted, pack uninstalled), the button is absent — the
  primary CTA still renders. No error visible to the end user.
- The `variant="secondary"` matches the design tokens
  established for R2's button variants — amber outline, no
  background fill.

The icon is the right-pointing triangle (`PlayIcon` from the R2
icon set). Label is "Start tutorial" in en-US.

#### 5.1.2 TopBar Help menu (catalogue surface)

The TopBar's existing Help dropdown (R3) gets a "Tutorials…"
submenu. Items: `api.tutorials.list()` sorted alphabetically by
title, grouped by:

- **In progress** (started but not completed — `localStorage` has
  a `lastStepReached` key but no `completed`).
- **Available** (not yet started, and prerequisites met).
- **Completed** (with a check-mark icon).
- **Locked** (prerequisites not met) — rendered grayed-out with
  the prereq title shown beneath ("Complete _Home_ first.").

Each item shows: title, description (truncated), estimated
seconds, and an icon. Clicking an item invokes
`api.tutorials.start(item.id)`.

The Help menu also gains a single top-level "Tutorial settings…"
item that opens the EditorSettingsModal's Tutorials tab (§5.4).

#### 5.1.3 Deep links

The editor honours a `?tutorial=<slug>` query param on load. If
present and the slug exists in the registry, the editor:

1. Routes to the slug's "associated view" if known (each tutorial
   may declare `viewHint: "scripts"` to auto-navigate before
   launching — see §3.1's optional fields). Defaults to `home`.
2. Calls `api.tutorials.start(slug)` after the route lands and one
   `requestAnimationFrame` ticks (ensures the view's DOM is
   mounted before the overlay queries selectors).
3. Strips the `?tutorial=` param from the URL (history replace),
   so refreshing doesn't re-launch.

Deep links are used for docs cross-links ("[Start the Scripts
tutorial →](?tutorial=scripts-intro)") and for the "Share this
tutorial" button (right-click a Help menu item, copy a shareable
URL).

### 5.2 Active-tutorial overlay

The runtime mounts a portal at `<body>` (above all other editor
chrome including modals). The portal renders a `<TutorialOverlay>`
component bound to the runtime's state:

```ts
type RuntimeState =
  | { kind: "idle" }
  | {
      kind: "active",
      tutorial: TutorialDef,
      stepIndex: number,
      startedAt: number,
      targetRect: DOMRect | null,   // recomputed on resize + step change
    };
```

The overlay's tree:

```tsx
<div className="tutorial-overlay" role="dialog" aria-modal={step.modal}>
  <SpotlightMask rect={targetRect} padding={step.highlightPadding} radius={step.highlightRadius} />
  <SpeechBubble
    anchor={targetRect ?? viewportCenter}
    placement={step.placement}
    hint={step.hint}
    detail={step.detail}
    progress={{ current: stepIndex + 1, total: tutorial.steps.length }}
    showNext={step.advance.kind === "next"}
    onNext={advance}
    onSkip={skip}
    onClose={stop}
  />
</div>
```

The overlay updates on:

- **Window resize** — recompute `targetRect` from `document.querySelector(step.target).getBoundingClientRect()`.
- **MutationObserver** on `document.body` (subtree, attributes,
  childList) — if the target's bounding rect changes (e.g. the
  user scrolls a panel, an animation moves a button), reanchor.
  Throttled to 50 ms.
- **Step advance** — re-query the new target, animate the
  spotlight from old to new rect (`requestAnimationFrame` tween,
  200 ms, eased; skipped under `prefers-reduced-motion`).

If `document.querySelector(step.target)` returns `null` (target
not on screen), the overlay enters a **degraded mode**: spotlight
fades to a viewport-centred hole with a "Couldn't find the next
element. Click here to continue or skip." bubble. This recovers
gracefully from "the user closed the panel the tutorial was
pointing at." Logged to console as a warning.

### 5.3 Spotlight rendering

The spotlight is a **single inline SVG** covering the full
viewport (`position: fixed; inset: 0; pointer-events: none;`),
with a `<rect>` covering the viewport filled with the dim colour
(`#000` at 60% opacity), and a `<mask>` punching a rounded
rectangle hole over the target rect.

```tsx
<svg className="tutorial-spotlight" viewBox={`0 0 ${vw} ${vh}`}>
  <defs>
    <mask id="spot">
      <rect width="100%" height="100%" fill="white" />
      <rect x={rect.x - pad} y={rect.y - pad}
            width={rect.width + 2*pad} height={rect.height + 2*pad}
            rx={radius} fill="black" />
    </mask>
  </defs>
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#spot)" />
</svg>
```

The hole is `pointer-events: none` by default (clicks pass through
to the underlying editor) **unless** the step is `modal: true`, in
which case the dim layer becomes `pointer-events: all` and the
runtime adds an absolutely-positioned transparent `<div>` over the
target hole sized to the target rect with `pointer-events: all`
that swallows everything except the registered advance click. (The
mask itself doesn't trap clicks — the masked-out region is still
SVG, which doesn't naturally pass-through. We use a transparent
overlay layer for click semantics, and the SVG is purely visual.)

To make tutorial targets **stable across DOM refactors**, every
interactive editor element gets a `data-tutorial="<view>.<id>"`
attribute as part of T2's targeting audit. Examples:

| Element | `data-tutorial` value |
|---|---|
| Home → "New project" button | `home.new-project-button` |
| Map → "New scene" button | `map.new-scene-button` |
| Scripts → "New script" button | `scripts.new-button` |
| Scripts → File tree | `scripts.file-tree` |
| Scripts → Monaco editor | `scripts.editor` |
| TopBar → Help menu | `topbar.help-menu` |
| Inspector → entity name field | `inspector.entity-name` |

These attributes are **forever-stable**; tutorials author against
them, not against class names or DOM structure. A T2 PR adds the
attributes to every R2/R4 component that a tutorial step references,
in addition to wiring the runtime.

### 5.4 Persistence

`localStorage` keys:

| Key | Type | Notes |
|---|---|---|
| `cardboard:tutorial:<slug>:completed` | `"true"` or absent | Set when `markCompleted` fires (on tutorial end or explicit skip-with-mark). Read by `completed()`. |
| `cardboard:tutorial:<slug>:lastStepReached` | step index as string | Updated on every step advance. Used by Help menu's "in progress" grouping. Cleared on `markCompleted`. |
| `cardboard:tutorial:<slug>:firstRunOf` | timestamp ms | Set the first time a tutorial starts. Used for tutorial-completion-rate telemetry (T-future). |
| `cardboard:firstrun:done` | `"true"` | Set on first editor launch ever, used to gate the first-run auto-tutorial (§5.4). |
| `cardboard:tutorial:autoLaunch` | `"true"` (default) or `"false"` | Global toggle — if `"false"`, the first-run auto-tutorial is suppressed. Toggled from the EditorSettingsModal. |

The EditorSettingsModal (R4 component) gains a **Tutorials** tab
with:

- **Auto-launch first-run tutorial** — checkbox bound to
  `cardboard:tutorial:autoLaunch`.
- **Completed tutorials** — list of slugs with `completed = true`,
  with a per-slug "Reset" button (clears the slug's keys) and a
  bottom "Reset all" button.
- **Show locked tutorials in Help menu** — checkbox (default true).
- **Verbose tutorial logging** — checkbox (debug; default false).

Defaults all live in `apps/editor/src/tutorials/defaults.ts`.

---

## 6. Built-in tutorials (default set)

T3 ships three; T4 ships the remaining six. The sketches below are
contracts for the JSON author — each is the **structure**, not the
final copy. The copy gets a writer pass at the end of T3.

### 6.1 `home-intro` (T3)

**Title**: "Welcome to cardboard"
**Estimated**: 75 s
**`next`**: `map-intro`
**Auto-launched on**: first run (gated by `cardboard:firstrun:done`).

| # | Target | Hint | Advance |
|---|---|---|---|
| 1 | `null` (centre) | "Welcome to cardboard. Let's take a 60-second tour. Press **Next** anytime to continue, or **Skip** to dive in." | `next` |
| 2 | `home.welcome-panel` | "This is the **Home** tab — where you'll switch between projects and start new ones." | `next` |
| 3 | `home.new-project-button` | "Let's make your first project. Click **New project**." | `click` |
| 4 | `home.project-name-input` (in modal) | "Give it a name. Anything — you can rename it later." | `key Enter` |
| 5 | `home.project-template-list` | "Pick a starter template. **Empty** is fine for learning." | `click [data-tutorial='home.template-empty']` |
| 6 | `home.create-button` | "Click **Create** to open your project." | `click` |
| 7 | `null` (centre) | "Nice — your project is open! Next, let's look at the **Map** tab. Continue?" | `next` (chains to `map-intro`) |

### 6.2 `map-intro` (T3)

**Title**: "Building a scene"
**Estimated**: 90 s
**`next`**: null

| # | Target | Hint | Advance |
|---|---|---|---|
| 1 | `null` | "The **Map** tab is where you build scenes — rooms, corridors, the actual 2.5D layout." | `next` |
| 2 | `primary-tabs.map` | "Click the **Map** tab if you're not already there." | `event tutorial.editor.view-changed-to-map` (or `click`) |
| 3 | `map.toolbar.paint-tile` | "This is the **Paint Tile** tool. Click it." | `click` |
| 4 | `map.tile-palette` | "Pick a wall tile from the palette." | `click [data-tutorial='map.tile-palette-item']` |
| 5 | `map.canvas` | "Click on the canvas to paint a tile." | `event tutorial.editor.tile-painted` |
| 6 | `map.toolbar.save` | "Save your scene with **Cmd-S** or the Save button." | `key Cmd-S` |
| 7 | `null` | "That's the basics. The Scene tab has many more tools — see [Scene docs](/docs/scene) for depth." | `next` |

### 6.3 `entities-intro` (T4)

**Title**: "Prefabs and entities"
**Estimated**: 90 s
**`next`**: null

Structure: 8 steps walking through the Prefabs tab — list panel,
new-prefab dialog, component inspector (highlight a few common
components — Position, Sprite, Collider), drag-into-scene, and
back to the Scene tab to verify placement.

### 6.4 `animation-intro` (T4)

**Title**: "Animating sprites"
**Estimated**: 120 s
**`next`**: null
**Prerequisites**: `entities-intro`

Structure: 10 steps — pick a sprite, open the Animation tab, scrub
the timeline, set a keyframe, preview, export. Specific reference
elements: timeline scrubber, frame strip, transport buttons.

### 6.5 `scripts-intro` (T3)

**Title**: "Pack scripts"
**Estimated**: 90 s
**`next`**: null

| # | Target | Hint | Advance |
|---|---|---|---|
| 1 | `null` | "Pack scripts are TypeScript files that run on engine ticks. They power AI, events, custom mechanics." | `next` |
| 2 | `primary-tabs.scripts` | "Open the **Scripts** tab." | `event tutorial.editor.view-changed-to-scripts` |
| 3 | `scripts.new-button` | "Click **New script** to make one." | `click` |
| 4 | `scripts.editor` | "Monaco loaded — type a function name. Try `onTick`." | `event tutorial.editor.script-saved` (or `next`) |
| 5 | `scripts.file-tree` | "Your scripts live here. Right-click for actions." | `next` |
| 6 | `scripts.bind-button` | "Bind your script to an entity by clicking **Bind**." | `click` |
| 7 | `scripts.binding-dialog` | "Pick the entity that runs your script." | `event tutorial.editor.script-bound` |
| 8 | `null` | "You've written your first script! See [Scripting docs](/docs/scripts) for the full API." | `next` |

### 6.6 `image-lab-intro` (T4)

**Title**: "Procedural images"
**Estimated**: 120 s
**`next`**: null

Structure: 12 steps — open IL, drop a Noise node, drop a Color
Ramp, connect them, drop an Output, preview, save as a recipe.
References IL-graph specific data-tutorial attributes.

### 6.7 `sound-lab-intro` (T4)

**Title**: "Synth and sample"
**Estimated**: 120 s
**`next`**: null

Structure: 10 steps — open SL, drop an oscillator, drop an envelope,
connect, preview, attach to a pack audio cue. References SL-specific
attributes.

### 6.8 `ui-builder-intro` (T4)

**Title**: "Visual HUDs"
**Estimated**: 90 s
**`next`**: null

Structure: 10 steps — open UB, drag a Stack, add a Text node, add a
Bar node, bind a value, preview, save the tree. References UB-
specific attributes (palette items, tree-view rows, inspector).

### 6.9 `project-intro` (T4)

**Title**: "Project settings"
**Estimated**: 45 s
**`next`**: null

Structure: 6 steps — show the Project tab, walk the metadata fields,
show the Dependencies tab, show the Build tab.

---

## 7. Editor UX

### 7.1 EmptyState "Start tutorial" button

Already detailed in §5.1.1. Visual treatment:

- Button variant: secondary (amber outline, no fill).
- Leading icon: `PlayIcon` (filled right-triangle).
- Label: "Start tutorial".
- Placement: to the right of the primary CTA, separated by an 8 px
  gap. If the primary CTA wraps to a second line on narrow viewports
  (< 480 px), the tutorial button drops to its own line below.

The button is rendered by the existing `EmptyState` primitive, so it
gets EmptyState's spacing, alignment, and dark-mode tokens for free.

### 7.2 Help menu integration (TopBar)

The TopBar's Help dropdown (R3) appearance after T2:

```
Help
  ├ Documentation         (opens docs site in new tab)
  ├ Keyboard shortcuts    (opens shortcuts modal)
  ├ Tutorials  ▶          (submenu)
  │  ├ In progress
  │  │  └ Scripts: 60-second tour    (60% complete)
  │  ├ Available
  │  │  ├ Welcome to cardboard       (75 s)
  │  │  ├ Building a scene           (90 s)
  │  │  ├ Prefabs and entities       (90 s)
  │  │  └ ...
  │  ├ Completed
  │  │  └ Animating sprites          ✓
  │  └ Locked
  │     └ Procedural images   (requires Entities tutorial)
  ├ Tutorial settings…   (opens EditorSettingsModal → Tutorials tab)
  ├ ─────
  ├ About cardboard…
  └ Report a bug…
```

The submenu is keyboard-navigable (Up/Down between items, Right to
expand groups, Enter to start). Hovering an item shows its
`description` in a tooltip.

### 7.3 Tutorial settings (EditorSettingsModal — "Reset completed tutorials")

The Tutorials tab in EditorSettingsModal mirrors §5.4 wiring. The
"Reset all" button confirms before wiping, since this is destructive.
Per-slug Reset is silent (one click, no confirmation).

### 7.4 First-run tutorial (auto-start on first launch)

On editor boot, if:

- `localStorage.getItem("cardboard:firstrun:done")` is absent, AND
- `cardboard:tutorial:autoLaunch` is `"true"` (default), AND
- The `home-intro` tutorial is in the registry,

then after the editor's initial render + 500 ms settle delay,
`api.tutorials.start("home-intro")` fires. The runtime sets
`cardboard:firstrun:done = "true"` on either completion *or* skip
of that tutorial (a skip still counts — we don't pester returning
visitors). The user can re-run the tutorial anytime from the
Help menu.

The 500 ms delay is **not arbitrary**: it covers the editor's lazy
panel loads + initial layout-shift. Without it, the spotlight
sometimes anchors to a not-yet-mounted element. Tested via the
editor's existing init sequence.

---

## 8. Authoring guide

### 8.1 How to write a new tutorial

1. **Pick a slug.** Lowercase, dash-separated. Format
   `<view>-<topic>` (e.g. `scripts-intro`, `image-lab-noise-tutorial`).
2. **Create the JSON file.**
   - Built-in: `apps/editor/src/tutorials/<slug>.tutorial.json`.
   - Pack-authored: `<pack>/tutorials/<slug>.tutorial.json`.
3. **Start with the skeleton:**

   ```jsonc
   {
     "$schema": "tutorial/1",
     "id": "<slug>",
     "title": "...",
     "description": "...",
     "estimatedSeconds": 60,
     "steps": []
   }
   ```

4. **Identify target elements.** Open the editor view, inspect the
   DOM, find or add `data-tutorial="..."` attributes on the
   elements you want to highlight. **Don't target class names.** If
   the element you want doesn't have a `data-tutorial`, the
   tutorial PR adds one.
5. **Write the step array.** Start with an intro (`target: null,
   advance: next`), then walk through actions roughly in user
   order. End with an outro pointing at docs or a next tutorial.
6. **Validate.** Run `bun run validate-tutorials` (T2 adds this
   script); it runs every `.tutorial.json` through the schema
   validator and prints failures.
7. **Test in the editor.** Launch via the EmptyState button, the
   Help menu, *and* the deep link query param — all three paths
   should work.
8. **PR with**: the JSON file + a screenshot of one step's
   overlay + (if applicable) any new `data-tutorial` attributes.

### 8.2 Step granularity

A step is **one user action plus one piece of context**. Bad
example:

```jsonc
{ "target": "scripts.editor", "hint": "Type a function called onTick that returns an empty object, then save the file with Cmd-S, then bind it to an entity by clicking the Bind button.", "advance": { "kind": "event", "name": "tutorial.editor.script-bound" } }
```

Three actions, one step. The user finishes the first one and the
overlay just sits there waiting for the third — they wonder if it's
broken. Split into three steps, each with its own advance condition:

```jsonc
{ "target": "scripts.editor", "hint": "Type a function called `onTick`.", "advance": { "kind": "next" } },
{ "target": "scripts.editor", "hint": "Save with <kbd>Cmd-S</kbd>.", "advance": { "kind": "key", "combo": "Cmd-S" } },
{ "target": "scripts.bind-button", "hint": "Click **Bind** to attach it.", "advance": { "kind": "click" } },
```

Heuristic: if you can't summarise the step in one sentence ≤ 12
words, split it.

Other rules of thumb:

- **Prefer reactive advance over `next`.** A `click` or `event`
  advance feels active; a chain of 12 `next` clicks feels passive.
- **Use `timer` for splash screens only.** Anywhere else, the user
  may want to read more carefully — timers steal that.
- **Don't `modal: true` more than once per tutorial.** It's
  intrusive. Save it for the one step the user *must* do (e.g. the
  Save step in `map-intro`).
- **End with a doc link, not a wall of text.** If the user wants
  depth, they'll click. Don't try to teach everything in the
  bubble.
- **Test with `prefers-reduced-motion: reduce`.** Tutorials should
  feel fine without animations.

---

## 9. Accessibility

### 9.1 Keyboard navigation

- `Tab` cycles between the speech bubble's interactive elements:
  Next (if rendered), Skip, Close (×).
- `Shift+Tab` reverses.
- `Enter` activates the focused button.
- `Escape` invokes `stop()` (same as Close), with a confirmation
  modal — "Stop the tutorial? Your progress to step N will be
  saved." [Stop / Continue]. The modal-blocking confirm prevents
  accidental escape during typing.
- Hot-keys that the tutorial is waiting for (advance kind `key`)
  still fire — the overlay doesn't trap keyboard events for combos
  it's listening to, so the user's normal `Cmd-S` still saves.

The overlay traps **focus** when `modal: true` only. In non-modal
mode, the user can `Tab` out of the bubble into the underlying
editor freely.

### 9.2 Screen reader support

- The overlay is `role="dialog"` with `aria-modal={step.modal}` and
  `aria-labelledby` pointing at a hidden `<h2>` containing the
  tutorial title.
- The current step's `hint` is announced via `aria-live="polite"`
  on a screen-reader-only `<div>`. Step changes re-announce.
- The targeted element gets `aria-describedby` pointing at the
  bubble's content, so screen-readers describe "Save button.
  Tutorial: press Cmd-S to save the scene."
- Skip / Next / Close buttons have explicit `aria-label`
  values ("Skip tutorial step", "Advance to next step", "Close
  tutorial").
- Progress indicator (`3 / 8`) is announced as "Step 3 of 8."

### 9.3 Reduced-motion support

Under `prefers-reduced-motion: reduce`:

- Spotlight tween between steps becomes a teleport.
- Bubble fade-in/out becomes instant.
- Auto-advance `timer` conditions still respect the timer but
  skip the visual countdown.

The runtime checks `window.matchMedia("(prefers-reduced-motion:
reduce)")` on overlay mount and updates if the user toggles the
preference.

---

## 10. Phased rollout T1–T5

| Phase | Scope | Status |
|---|---|---|
| **T1** | This plan doc. Schema spec + UX spec + built-in tutorial list. **No code.** | This doc (2026-05-17). |
| **T2** | Runtime + EmptyState integration. Adds `apps/editor/src/tutorials/{runtime.ts, defaults.ts, index.ts}`, the `<TutorialOverlay>` component, the `data-tutorial` attribute audit across R2/R4 components, the `api.tutorials.*` registry, EditorSettingsModal Tutorials tab, Help menu Tutorials submenu, deep-link routing, first-run detection. **No built-in tutorials yet** — the system is fully wired but the registry is empty. EmptyState's launcher button gracefully hides when the slug doesn't resolve. | Pending. |
| **T3** | First three tutorials. `home-intro`, `map-intro`, `scripts-intro`. Validates the schema by writing real content against it. First-run auto-launch wires to `home-intro` and chains to `map-intro`. | Pending T2. |
| **T4** | Remaining built-in tutorials. `entities-intro`, `animation-intro`, `image-lab-intro`, `sound-lab-intro`, `ui-builder-intro`, `project-intro`. Some of these block on the corresponding labs/builders shipping (IL / SL / UB) — Q1 in §11. | Pending T3 + dependent surfaces. |
| **T5** | Pack-authored tutorials. Pack loader walks `<pack>/tutorials/*.tutorial.json`. Registration with pack-chain last-pack-wins. `api.tutorials.registerEvent()` for pack-emitted events. Store integration — tutorials show up as Store-listable artefacts. | Pending T4. |

T2 is the **largest** phase — it's the runtime + the
attribute-audit + Settings tab + Help menu, ~7 days of work. T3
is content; T4 is content; T5 is a small runtime change + Store
plumbing.

---

## 11. Open questions

### Q1 — Does T4 block on lab/builder ships?

`image-lab-intro`, `sound-lab-intro`, and `ui-builder-intro` need the
respective surfaces (IL, SL, UB) to exist with stable
`data-tutorial` attributes. As of writing, IL is shipping, SL is
shipping, UB is planned (UB1 is its plan doc).

**Provisional**: T4 ships in three sub-phases — T4a (IL once IL
ships), T4b (SL once SL ships), T4c (UB once UB ships). The other
T4 tutorials (`entities-intro`, `animation-intro`, `project-intro`)
ship together as T4d on existing R4 surfaces, gated only by T3.

Status: **deferrable**.

### Q2 — Should advance conditions support negation?

A step that says "Click anywhere *except* the Delete button" needs a
"NOT clicked X" condition. The schema currently has no `not` kind.

**Provisional**: do not add. If a step has "click anything except
X" intent, it's almost always poorly designed — either the
highlighted target is wrong (the user shouldn't be choosing
between two paths inside a guided tour) or the step should be split.
If a real use case emerges, add `{ "kind": "not", "condition": {...} }`
in V2.

Status: **resolved** (no).

### Q3 — Step-jumping based on completed action?

If the user already saved the file before the tutorial says "now
save the file", should the step auto-advance immediately on entry?

**Provisional**: yes. On step entry, the runtime checks the advance
condition **once** synchronously. If it's already satisfied (e.g.
a `click` whose target is somehow not present, an `event` that
was emitted in the last 500 ms, a `key` that — no, key combos
don't pre-fire), the step advances immediately. This handles the
"the user is already where the tutorial expects them" case
gracefully. Specifically the `event` kind needs a small event log
(last N events emitted) so the runtime can rewind.

Status: **provisional** — implementation detail in T2.

### Q4 — Highlighting multiple targets per step?

Some steps want to highlight two elements (e.g. "click *either*
this button or that button"). The schema's `target` is single.

**Provisional**: not in V1. The bubble can verbally describe two
elements, but only one gets the visual spotlight. The user's eye
will follow. If a real need emerges, V2 adds `target: string[]`.

Status: **resolved** (no, single-target V1).

### Q5 — Pack-side tutorial events naming collision?

If two packs both call
`api.tutorials.registerEvent("survival.died")`, what happens?

**Provisional**: last-pack-wins on `registerEvent`, with a console
warning. The packs **don't** sandbox event namespaces (no
auto-prefixing). Pack authors should namespace their events
manually (`survival-mode.died`, not `died`). The Store listing
encourages namespacing in the pack-authored-events docs.

Status: **resolved**.

### Q6 — Tutorial localisation?

The hint copy is English in V1. International users get the
English. Should V1 support `hint_es`, `hint_fr` keys?

**Provisional**: no. Localisation is a project-wide concern not
yet solved (editor chrome is also English-only). When the editor
ships an i18n framework, tutorial JSON migrates with everything
else. The schema V2 may add a per-field locale-keyed map; not V1.

Status: **deferred** — pending editor i18n plan.

### Q7 — Telemetry / completion-rate tracking?

Should the editor emit anonymous "tutorial X completed" /
"tutorial X skipped at step N" events to help authors improve
content?

**Provisional**: no, V1. Cardboard has no telemetry framework
today and adding one for tutorials alone is overscope.
`localStorage` data is locally-readable for the user; if author-
side data is needed, an opt-in "share my tutorial progress" toggle
can be added later.

Status: **deferred**.

### Q8 — Tutorial Builder visual editor?

Like UI Builder is to UI trees, should there be a Tutorial Builder
tab for tutorials?

**Provisional**: yes, eventually, but **not in scope for T1–T5**.
The JSON is small enough to hand-author for now (the longest
built-in is ~12 steps). A future "Tutorial Builder" tab would let
authors record a sequence by clicking through the editor and
auto-generating the JSON ("record a tutorial like a screencast").
That's a separate plan doc.

Status: **deferred** to a future plan.

### Q9 — Can a tutorial be triggered programmatically by a pack script?

If a pack wants to teach the player a mechanic *in the editor*,
should `api.tutorials.start` be callable from a pack script (not
just from editor chrome)?

**Provisional**: yes. The `api.tutorials.*` surface is on the same
ModAPI as `api.ui`, `api.world`, etc. Pack scripts can call it.
Use case: a pack's custom modal's "Show me how" button. Caveat:
calls from pack scripts that target editor-chrome `data-tutorial`
selectors only make sense when the editor is the host — at
playtest-iframe runtime, those selectors don't exist. Pack-side
tutorials targeting *engine-rendered* DOM are out-of-scope (engine
doesn't have stable `data-tutorial` attributes; pack UI also
doesn't have a stable selector contract).

Status: **resolved** — editor-only, but callable from pack code.

### Q10 — Spotlight on iframe-rendered content?

The Playtest tab renders the game in an iframe. Can a tutorial
spotlight an element inside the iframe?

**Provisional**: no. The iframe lives in a separate document and
the spotlight SVG can't punch a hole into another document's
context. A step that wants to point at iframe content uses
`target: "[data-tutorial='playtest.iframe-frame']"` (the iframe
*frame* in the editor's DOM) and a hint like "look inside the
preview at the bottom-left for the HUD." If a real need emerges
later, the iframe could `postMessage` selector + rect data up to
the editor, but that's outside V1.

Status: **resolved** (no, V1).

### Q11 — Confirmation when starting a tutorial mid-work?

If the user clicks "Start tutorial" mid-edit and the tutorial
auto-navigates them to a different view, they lose context.
Should we confirm?

**Provisional**: yes. The launcher (button / Help menu / deep
link) **all** funnel through `api.tutorials.start`, which checks
for "dirty" editor state (unsaved changes, open modals). If dirty,
it shows a confirm modal: "Start tutorial? Your unsaved changes
will remain — the tutorial just walks you through the editor." 
[Start / Cancel]. Not destructive, so just informational. The
modal is dismissable; the user opts in once and a
`cardboard:tutorial:noConfirm` flag suppresses it.

Status: **resolved**.

### Q12 — Tutorial-emitted events visible in CONSOLE plan's developer console?

The dev console (CONSOLE.md, planned) surfaces engine events.
Should `api.tutorials.emit` events show up there?

**Provisional**: yes, namespaced `tutorial.*`. Useful for tutorial
authors debugging advance conditions. The dev console filter UI
can hide them by default; a `tutorial` filter tag exposes them.

Status: **resolved** (yes, namespaced).

---

## 12. Cross-references

- **[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md)** —
  - §12 Q10 — the resolution that wires `EmptyState.tutorial?:
    string` as a no-op. This doc is the "future task" that turns
    the no-op into a runtime; T2 is the back-reference target.
  - §4.24 (`EmptyState` primitive) — the launcher surface. T2
    edits `apps/editor/src/components/ui/EmptyState.tsx` to render
    the "Start tutorial" button when `tutorial` prop resolves to
    a registered tutorial.
  - §6.x (TopBar) — T2 adds a "Tutorials…" submenu to the Help
    dropdown. Coordinate with whichever R4 phase ships the Help
    menu.
  - §7.x (EditorSettingsModal) — T2 adds a "Tutorials" tab.
    Coordinate with whichever R4 phase ships the modal.
  - §7.x (Project view's first-run) — T3's `home-intro` chains to
    `map-intro` on completion; the first-run auto-launch is
    gated by `cardboard:firstrun:done`.

- **[MATERIALS.md](./MATERIALS.md)** — tone reference + parallel
  architectural pattern. MATERIALS is declarative-first
  (`.glsl` hooks) with a code escape hatch (component-attached
  variant ids). Tutorials are declarative-first (JSON) with no
  code in JSON — slightly stricter than MATERIALS, but the same
  shape.

- **[UI_BUILDER.md](./UI_BUILDER.md)** — closest sibling plan.
  Both are JSON-first authoring, both ship with pack-chain
  semantics, both have a future "visual builder" tab (UI Builder
  for trees; eventual Tutorial Builder for tutorials, §11 Q8).
  T5's pack-chain semantics mirror UI Builder's UB5 patch
  semantics.

- **[PACK_CHAIN.md](./PACK_CHAIN.md)** — T5 rides last-pack-wins
  on `id` collision. Tutorial files in `<pack>/tutorials/` are
  discovered by the same asset-walk that finds `.glsl`, `.png`,
  `.ui.json`, etc.

- **[STORE.md](./STORE.md)** — T5 — tutorials become shareable
  artefacts. A pack page's "Tutorials" section lists every
  tutorial the pack ships. Reverse-deps may apply ("Packs that
  ship a `survival-mode` tutorial").

- **[CONSOLE.md](./CONSOLE.md)** — Q12 — tutorial events surface in
  the dev console under the `tutorial.*` namespace. The CONSOLE
  plan's event filter UI gets a `tutorial` tag.

- **[EDITOR_IFRAME.md](./EDITOR_IFRAME.md)** — Q10 — the iframe
  doesn't participate in tutorials in V1. The iframe-frame
  element itself is a legal `target`, but content inside is not.
  If V2 wants spotlighting iframe content, EDITOR_IFRAME's
  postMessage protocol gains a `tutorial-target-rect` message.

- **[IDEAS.md](../IDEAS.md)** — origin entry: 2026-05-16 Q10
  follow-up — "tutorial system gets its own task / plan doc
  after editor-redesign R5 ships." This doc closes that follow-up.
  Append on commit: `2026-05-17 — Guided tutorial system
  (TUTORIALS.md) — status Planning`.

- **[PLAN.md](../PLAN.md)** — phase status table gains a
  Tutorials row: T1 (this doc, 2026-05-17) → T2 (runtime,
  pending) → T3 (first three, pending T2) → T4 (remainder,
  pending T3 + dependent surfaces) → T5 (pack-authored, pending
  T4).

This plan is the source-of-truth for the tutorial system. Future
direction changes update this doc + add a back-reference entry to
[IDEAS.md](../IDEAS.md).
