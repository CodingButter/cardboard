# Editor Dock Layout — Library Evaluation

Date: 2026-05-18
Scope: Pick one React docking-layout library to power every editor
page (Scene / Prefabs / Components / Scripts / Animation / Image Lab /
Sound Lab / UI Builder / Project). Pure research — no code touched
outside this file, no packages installed.

---

## 1. Requirements summary

Foundational features every editor page must have:

1. **Drag panels to reorder** — split panes, tabbed groups, drop-zone
   targets with snap previews.
2. **Pop panels out into a separate browser window** — survives a PWA
   install, enables multi-monitor workflows. Layout must round-trip
   panels back into the main window.
3. **JSON-serializable layout** — persist to IndexedDB (per-project)
   and Supabase (per-user), restore exactly.
4. **Tabs inside regions** — multiple panels share a tabstrip.
5. **Theming hooks** — must accept our design-system classes
   (`.panel-surface`, `.panel-header`, `.tab-strip-*`) without
   wholesale CSS overrides.
6. **TypeScript first-class** — strict mode, no `@types/*` shim.
7. **React 19 compatibility** — non-negotiable. We are on React 19.
8. **Imperative API** — programmatically add/remove/move panels,
   query the layout tree.

Nice-to-haves:

- Maximize panel, double-click header to maximize.
- Floating (in-page) panels in addition to popout windows.
- Customizable tab rendering (icons, dirty markers, status pills).
- Low bundle cost — we're shipping a PWA.
- Active maintenance — at least one release in the last 6 months,
  responsive maintainer on issues.

---

## 2. Per-library evaluation

### 2.1 rc-dock (`rc-dock`)

| | |
|---|---|
| Repo | https://github.com/ticlo/rc-dock |
| License | Apache-2.0 |
| Latest stable | `3.3.2` — 2025-05-18 |
| Latest tag | `4.0.0-alpha.3` — 2025-12-10 (alpha, ~14 months old line) |
| GitHub | 806 stars / 109 forks / 51 open issues |
| Weekly downloads | ~10.9 k |
| Bundle (3.3.2) | **220 KB min / 66 KB gz** (15 transitive `rc-*` deps incl. `lodash`, `bowser`, `dom-align`) |
| Peer deps | `react >= 17`, `react-dom >= 17` (declared) |
| TypeScript | First-class — `lib/index.d.ts` ships with the package. |
| Layout JSON | Yes — `saveLayout()` / `loadLayout()` on the `DockLayout` ref; shapes are `LayoutData / BoxData / PanelData / TabData`. |
| Popout windows | **Yes** — uses `rc-new-window` internally; panels can be popped to a new browser window. Demo shows `new-window.gif`. |
| Drag UX | Mature — snap zones, preview, four-way drop directions, separate floating box (`floatbox`) for in-page floats. |
| Tabs in region | Yes — `PanelData.tabs[]`. Tab groups partition which tabs can dock with which. |
| Theming | Single ".less"-sourced stylesheet (`dist/rc-dock.css` / `rc-dock-dark.css`). Class hooks (`dock-panel`, `dock-tab`, `dock-tabpane-active`) can be overridden with our own CSS, but the library injects its own structural classes; we'd write a `:where(...)`-scoped theme layer. |
| React 19 | **PROBLEMATIC.** Stable 3.x depends on `rc-tabs ~11.x` which emits the React 19 `element.ref` deprecation. Issue #242 (open since 2025-04-23) is the React 18/19 tracking ticket. Maintainer (`rinick`) said they are working on it but is "waiting for antd6 before having any major change" and confirmed **"rc-dock doesn't work with Strict Mode"**. 4.0 alpha replaced rc-tabs with `@rc-component/tabs` (the antd6-track fork) but has been alpha since 2025-09 with no stable promotion. |
| Imperative API | Strong — `dockMove(source, target, direction)`, `find(id)`, `updateTab(id, data)`, plus uncontrolled vs. controlled (`layout` prop) modes. |

Verdict: feature-complete and the popout story is what we want, but
the React 19 + Strict Mode caveat is a hard blocker. Adopting it
forces us to either disable Strict Mode in the editor or live on an
alpha that the maintainer himself hasn't stabilized in 8 months.

### 2.2 flexlayout-react (`flexlayout-react`)

| | |
|---|---|
| Repo | https://github.com/caplin/FlexLayout |
| License | ISC (effectively MIT-equivalent — README badge says MIT, package.json says ISC) |
| Latest | `0.9.1` — 2026-05-04 (active; v0.9.x is the current minor line, releases every few weeks) |
| GitHub | 1.3 k stars / 160 open issues |
| Weekly downloads | ~68.7 k |
| Bundle (0.9.1) | **133 KB min / 34 KB gz** — *zero* runtime dependencies beyond React peer. |
| Peer deps | `react ^18 || ^19`, `react-dom ^18 || ^19` (declared). |
| TypeScript | First-class — full `types/index.d.ts`; codebase is 86% TS. |
| Layout JSON | Yes — `Model.fromJson(json)` / `model.toJson()`. JSON has four top-level fields: `global`, `layout`, `borders`, `subLayouts` (popouts/floats). |
| Popout windows | **Yes**, mature. `enablePopout` + `enablePopoutIcon` tab attributes. Mechanism: a `popout.html` host page served alongside the app; main page styles are copied at runtime; **content is rendered via React Portals from the main window's React tree** (so state survives moving tabs between windows). Also supports floating in-page panels. |
| Drag UX | Industry-standard — Caplin Systems built this for trading dashboards. Drag the tab, drag the whole tabset, dock to edges, scroll-wheel tab overflow. Has Playwright test coverage. |
| Tabs in region | Yes — tabsets are first-class nodes; borders are tabsets too. |
| Theming | 8 built-in themes (`alpha_light/_dark/_rounded`, `light`, `dark`, `underline`, `gray`, `rounded`, `combined`). The `combined.css` allows live theme switching via `className="flexlayout__theme_alpha_dark"` on the container div. Easy to write a custom theme stylesheet — every internal class is prefixed `flexlayout__*`, which makes design-system overrides clean (no specificity wars). |
| React 19 | **YES** — peer dep declares `^19`; `@types/react@19.x` in devDeps; latest release 14 days ago. |
| Imperative API | Strong — actions-based: `model.doAction(Actions.addTab(...))`, `model.doAction(Actions.moveNode(...))`. Layout ref exposes `addTabToTabSet`, etc. Render callbacks: `onRenderTab`, `onRenderTabSet` let us inject our own `PanelHeader` / `TabStrip` markup. |
| Popout caveats | Documented honestly — popped-out tabs can't restore in maximized/minimized state, code using global `document` must use `selfRef.current.ownerDocument`, third-party libs that grab the main document may need wrapping. None of these affect our content panels since we author them. |

Verdict: the clear leader on React 19 readiness, bundle size, popout
maturity, theming flexibility, and ergonomics.

### 2.3 dockview (`dockview-react`)

| | |
|---|---|
| Repo | https://github.com/mathuo/dockview |
| License | MIT |
| Latest | `6.3.0` — 2026-05-16 (very actively maintained; 8 releases in two weeks) |
| GitHub | 3.2 k stars |
| Weekly downloads | ~33.8 k (`dockview-react`) + 73.7 k (`dockview` core); the `dockview-react` package is a thin re-export of `dockview` for migration parity. |
| Bundle (6.3.0) | **302 KB min / 68 KB gz** (largest of the three; `dockview-core` is 557 KB unminified). |
| Peer deps | React ≥ 16.8 (per docs). Latest releases publish daily under React 19 toolchain — likely fine but not explicitly bounded in the peer range. |
| TypeScript | First-class. `dockview-core` is the framework-agnostic engine. |
| Layout JSON | Yes — `api.toJSON()` / `api.fromJSON()`. |
| Popout windows | **Yes**, marketed as a headline feature: "Move any group into a separate browser window. The group stays connected to the layout and can be moved back at any time." API: `api.addPopoutGroup(group)`. |
| Theming | CSS variables — "Override individual properties or build your own theme from scratch." Edge groups (collapsible IDE-style side panels) come built-in. |
| Drag UX | Strong; demo includes color-coded tab groups, drag floating, and IDE-style edge panels. |
| React 19 | Likely compatible (it's actively shipping); peer range is loose, not strict. Lower confidence than FlexLayout because dependency on `dockview-core` couples React bindings to the engine release cadence. |
| Imperative API | Strong — full `DockviewApi` exposes panel/group manipulation, events, serialization. |

Verdict: the strongest *competitor* to FlexLayout on features and the
freshest release cadence by far. Loses on bundle size (2× FlexLayout
gzipped) and on peer-dep clarity. Would be a defensible alternative.

### 2.4 Secondary candidates (briefly)

- **react-mosaic-component** (4.8 k stars, v6.1.1 Dec 2024,
  ~81 k weekly downloads, Apache-2.0). Active, supports React 16-19,
  Blueprint-themable. **No popout-to-new-window support** in
  documentation. Would force us to build the popout layer ourselves —
  eliminated.

- **golden-layout** (battle-tested in trading dashboards). v2.x line
  is vanilla TS; the React wrapper situation is fragmented. Strict
  Mode + React 19 concerns. Slower release cadence. Not pursued.

- **Build our own** on top of `allotment` + `react-resizable-panels` +
  a hand-rolled `window.open` + `ReactDOM.createPortal(node,
  popoutWindow.document.body)` popout layer. Realistic only as a
  fallback if every library above is rejected. Even a minimal version
  would cost weeks (drop-zone math, ghost previews, popout style
  cloning, layout serialization, tabset reordering, persistence).
  Defer.

---

## 3. Side-by-side comparison

| Criterion | FlexLayout | rc-dock | dockview |
|---|---|---|---|
| License | ISC (≈ MIT) | Apache-2.0 | MIT |
| Latest release | **0.9.1, 14d ago** | 3.3.2 (12 mo) / 4.0-alpha.3 (5 mo) | 6.3.0 (2d ago) |
| Maintenance | Active | Slow / alpha-stuck | Very active |
| Weekly downloads | ~69 k | ~11 k | ~34 k |
| Bundle min+gz | **34 KB** | 66 KB | 68 KB |
| Runtime deps | **0** | 15 (rc-* + lodash) | 1 (`dockview-core`) |
| React 19 peer | **Declared `^19`** | Not declared; alpha branch in-flight | Loose `>=16.8`, likely fine |
| Strict Mode | OK | **Broken** (maintainer-confirmed) | OK |
| Popout windows | Yes (React Portal + popout.html) | Yes (`rc-new-window`) | Yes (`addPopoutGroup`) |
| Float panels | Yes | Yes | Yes |
| Tabs | Yes | Yes | Yes |
| JSON persist | `model.toJson/fromJson` | `saveLayout/loadLayout` | `api.toJSON/fromJSON` |
| Theming | 9 themes + `flexlayout__*` class hooks + override CSS | Less-compiled stylesheet, harder overrides | CSS variables, dockview-themed |
| Custom tab render | `onRenderTab` / `onRenderTabSet` | Custom `TabData.title` | React component slot |
| TS types | First-class | First-class | First-class |
| Risk | Popout zoom edge cases | Strict Mode + 19 compat | Bundle weight, peer range loose |

---

## 4. Recommendation

**Pick `flexlayout-react`.**

One-sentence reason: it is the only candidate with an explicit
`react ^19` peer dep, the smallest bundle (34 KB gz, zero runtime
dependencies), shipping releases every few weeks, and a popout-window
story that uses React Portals so panel state survives the move.

Runner-up: **dockview**. If FlexLayout's popout behavior turns out to
have a deal-breaker we didn't anticipate (zoom artifacts, browser
permission issues), we can swap to dockview behind our `<Page>` +
`<Panel>` abstraction — both libraries expose a tree-shaped JSON
model and an imperative API, so the wrapper boundary should hold.

**Biggest risk** — popout windows require a sibling `popout.html`
file served at the same origin as the main app, and the main page's
styles are *copied at runtime* into the popout document. Our editor
ships Tailwind-style CSS plus the `design-system.css` semantic
layer plus per-panel scoped styles; we need to verify the runtime
style-copy picks up everything (CSS variables on `:root`, fonts,
the design system layer, panel-local rules). If the popout DOM is
missing variables we'll see a flash of unstyled content or worse,
incorrect theme.

**Mitigation**:

1. Spike a popout with our actual design system loaded — verify
   `--surface-1` etc. land on the popout's `:root`. If not, write
   a small `onPopoutOpened` hook that re-injects `:root` CSS
   variables and re-links our `design-system.css` `<link>` tag.
2. Keep the `<Panel>` wrapper imperative-only: it never touches
   `document` / `window` directly, always pulls them via the React
   tree (`useSyncExternalStore` against the panel's container) so
   moving between windows just re-mounts cleanly.
3. Build pages on the FlexLayout-backed `<Page>` primitive; the
   public surface (Page / Panel / layout JSON shape) hides
   FlexLayout's Model/Action types so a future swap to dockview is
   contained to one file.

---

## 5. Integration sketch

### 5.1 Install

```bash
bun add flexlayout-react
```

(Then in the entry CSS:)

```css
@import "flexlayout-react/style/combined.css";
```

We pick `combined.css` because it ships all themes (~30 KB) and lets
us switch with a className. We'll write `flexlayout__theme_two5d.css`
on top, mapping our design tokens.

### 5.2 Layout JSON for one page (Image Lab)

```json
{
  "global": {
    "tabEnableClose": false,
    "tabEnableRename": false,
    "tabSetEnableMaximize": true,
    "splitterSize": 1
  },
  "borders": [],
  "layout": {
    "type": "row",
    "children": [
      {
        "type": "tabset",
        "weight": 20,
        "children": [
          { "type": "tab", "id": "files",   "name": "Files",   "component": "image-lab/files" }
        ]
      },
      {
        "type": "tabset",
        "weight": 55,
        "children": [
          { "type": "tab", "id": "canvas",  "name": "Canvas",  "component": "image-lab/canvas",  "enablePopout": true },
          { "type": "tab", "id": "preview", "name": "Preview", "component": "image-lab/preview", "enablePopout": true }
        ]
      },
      {
        "type": "tabset",
        "weight": 25,
        "children": [
          { "type": "tab", "id": "layers",     "name": "Layers",     "component": "image-lab/layers" },
          { "type": "tab", "id": "properties", "name": "Properties", "component": "image-lab/props" }
        ]
      }
    ]
  }
}
```

### 5.3 Wrapper TypeScript sketch

`apps/editor/src/dock/types.ts`:

```ts
import type { IJsonModel, ITabSetRenderValues, TabNode } from "flexlayout-react";

/** Stable identifier for a registered panel component. */
export type PanelComponentId = string;

/** Each page maps component ids to React renderers. */
export interface PanelRegistry {
  readonly [componentId: PanelComponentId]: (node: TabNode) => React.ReactNode;
}

/** Shape we persist per page. Opaque to consumers. */
export interface PageLayoutSnapshot {
  readonly version: 1;
  readonly model: IJsonModel; // FlexLayout's serialized model
}

export interface PageProps {
  readonly id: string;                 // "image-lab" | "scene" | ...
  readonly defaultLayout: IJsonModel;  // see 5.2
  readonly panels: PanelRegistry;
  readonly storageKey?: string;        // override for tests
  readonly onLayoutChange?: (snapshot: PageLayoutSnapshot) => void;
}
```

`apps/editor/src/dock/Page.tsx` (shape only):

```tsx
import { Layout, Model } from "flexlayout-react";

export function Page({ id, defaultLayout, panels, onLayoutChange }: PageProps) {
  const model = useDockModel(id, defaultLayout, onLayoutChange);
  return (
    <div className="page-root flexlayout__theme_two5d">
      <Layout
        model={model}
        factory={(node) => panels[node.getComponent()!]?.(node) ?? null}
        onRenderTab={renderTabWithDesignSystem}
        onRenderTabSet={renderTabSetWithDesignSystem}
      />
    </div>
  );
}
```

`apps/editor/src/dock/Panel.tsx`:

```tsx
/** Panel = the inside-the-tab content shell, NOT a layout node.
 *  Layout nodes live in the JSON; <Panel> wraps the React subtree
 *  the factory returns, so we get a consistent header / scroll
 *  container / empty state surface. */
export function Panel({ title, actions, children }: PanelProps) {
  return (
    <section className="panel-surface">
      <PanelHeader title={title} actions={actions} />
      <div className="panel-body">{children}</div>
    </section>
  );
}
```

### 5.4 Design-system class application

FlexLayout namespaces every internal element under
`flexlayout__*`. We override only what we need:

```css
/* design-system additions for FlexLayout */
.flexlayout__theme_two5d {
  --color-1: var(--surface-1);
  --color-tabset-background: var(--panel-surface);
  --color-tab-selected-background: var(--panel-surface-active);
  --color-splitter: var(--surface-divider);
  --font-family: var(--font-ui);
}

.flexlayout__theme_two5d .flexlayout__tab_button { /* match .tab-strip-tab */ }
.flexlayout__theme_two5d .flexlayout__splitter   { /* match .surface-divider */ }
```

Plus `onRenderTab` and `onRenderTabSet` to inject our `IconButton`,
`Kbd`, dirty-dot markers, etc.

### 5.5 Popout flow

1. User clicks the popout icon FlexLayout renders in the tab header
   (visible because we set `enablePopout: true` on poppable tabs).
2. FlexLayout calls `window.open` against `popout.html` (we ship
   `apps/editor/public/popout.html`); the new window registers with
   the existing React root.
3. The same factory is invoked; `<Panel>` mounts a second time —
   except via Portal — so panel state in the main window is
   preserved. Closing the popout reseats the tab back into its
   prior tabset.
4. We add an `onModelChange` listener that calls `model.toJson()` and
   writes to IndexedDB; popout/dock transitions update `subLayouts`
   in the JSON and survive reloads (subject to FlexLayout's
   documented "popouts cannot reload in maximized/minimized state"
   limit — we'll force normalize on save).

Who owns what:

- **FlexLayout** owns `window.open`, the popout's React Portal, and
  hot-style cloning.
- **Our wrapper** owns persistence (IndexedDB + Supabase sync),
  re-injecting design-system CSS variables on popout open, and a
  shared `BroadcastChannel('two5d/dock')` so things like the Scene
  selection model stay in sync between main + popout windows.

---

## 6. Open questions to spike before committing

1. **Style cloning fidelity.** Does FlexLayout's runtime style copy
   move our entire CSS layer cascade, including
   `@layer design-system { ... }`? Spike: open a popout, inspect
   `:root` in the popped window, diff CSS-variable presence.
2. **PWA standalone popouts.** Does `window.open` from an installed
   PWA actually open a free-floating Chromium window (so the user
   can park it on monitor 2), or does the OS clamp it inside the
   PWA frame? Test on Chrome (Windows + macOS), Edge, and Firefox.
3. **Strict Mode behavior.** FlexLayout's docs don't warn against
   Strict Mode (good sign — we'd see complaints in #issues if it
   were broken). Confirm with our React 19 strict-mode editor root.
4. **Tab key/state stability.** When a panel pops out and back, do
   `useState` values inside the component survive (Portal semantics
   say yes), and do our `useSubscription` against the Scene store
   not "double-render" loops? Verify with a stateful counter panel.
5. **Multi-window broadcast.** Confirm `BroadcastChannel` works
   inside a PWA standalone window. Fall back to `localStorage`
   `storage` events if not.
6. **Layout migration.** Define a `version` field on
   `PageLayoutSnapshot` and a migrator so we can evolve the default
   layout without invalidating user-saved variants.
7. **Bundle audit on real build.** 34 KB gz is the FlexLayout
   package alone; check with our actual Bun bundle whether
   `combined.css` survives tree-shaking or if we should split it.
