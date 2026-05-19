import React from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview";
import { useDockLayoutPersistence } from "./useDockLayoutPersistence";
import {
  DockPanelHeader,
  DockPanelHeaderOrnamentsContext,
  type DockPanelHeaderOrnaments,
} from "./DockPanelHeader";
import { assetUrl } from "../../lib/assetUrl";

/**
 * DockShell — the editor's React wrapper around `<DockviewReact/>`.
 *
 * Pages that opt into dockview-driven internal layouts (Scene first,
 * later: Image Lab, UI Builder, …) mount a `<DockShell/>` with their
 * declarative panel registry + an initial layout JSON. The shell:
 *
 *   - Hydrates the layout from `localStorage` on mount if a saved
 *     snapshot exists for `storageKey`, otherwise falls back to
 *     `defaultLayout`.
 *   - Persists the current layout to `localStorage` on every
 *     `onDidLayoutChange` (cheap — snapshots are a few hundred bytes).
 *   - Re-injects every `:root` CSS custom property and clones every
 *     same-origin design-system `<link>` / `<style>` into popout
 *     windows so the design tokens carry over (see "Popout token
 *     mitigation" below).
 *
 * Pages keep ownership of their panel React trees — DockShell is the
 * generic plumbing, the panels are page-specific.
 *
 * ── Popout token mitigation ─────────────────────────────────────────
 *
 * dockview opens floating groups in a new browser window via
 * `window.open` against a same-origin `popout.html`. After the popout
 * loads it iterates `document.styleSheets` from the main window and
 * `addStyles()`s each one into the popout document. That handles
 * stylesheet *rules*, but two failure modes still bite us:
 *
 * 1. **CSS custom properties declared in Tailwind v4's `@theme` block**
 *    register as variables on the main document's `:root`. They survive
 *    the stylesheet clone (they're inside a `:root { ... }` rule) BUT
 *    only if the originating stylesheet is reachable via
 *    `document.styleSheets`. Some stylesheets — particularly
 *    cross-origin imports or styles injected by the bundler at HMR
 *    time — throw a SecurityError when `cssRules` is accessed, and
 *    dockview falls back to a `<link>` clone for those. Our index.css
 *    is same-origin, so we should be fine — but the simplest robust
 *    fix is to *also* push the live computed values of every
 *    `--color-*`, `--rail-*`, `--radius-*`, `--gap-*`, `--shadow-*`,
 *    `--dv-*` custom property onto the popout document's `:root`. If
 *    the stylesheet copy worked, we're writing the same values twice
 *    (no-op). If it didn't, our explicit copy ensures the popout
 *    renders correctly.
 *
 * 2. **Dynamic style additions** (Tailwind's JIT, future runtime theme
 *    swaps) may land in the main window AFTER the popout's initial
 *    `addStyles` snapshot. We re-clone all link/style tags into the
 *    popout once at open time — anything injected later is the
 *    responsibility of the popout's natural re-render.
 *
 * The injection runs on dockview's `onDidAddGroup` event because
 * dockview's React API does NOT expose a global "popout opened" event
 * (only `onDidPopoutGroupSizeChange/PositionChange/Fail`). When a
 * popout opens, a new group is added whose `api.location.type ===
 * "popout"`. We listen for that, grab the popout `Window`, and inject.
 */

export interface DockPanelDef {
  /** Stable identifier — keep this in sync with the `defaultLayout`
   *  JSON's panel ids. */
  readonly id: string;
  /** Tab-strip label. */
  readonly title: string;
  /** React component rendered as the panel body. */
  readonly component: React.FunctionComponent<IDockviewPanelProps>;
  /** Optional icon rendered left of the title in the
   *  `DockPanelHeader` renderer. Passed through dockview as a
   *  panel param (`params.icon`). */
  readonly icon?: React.ReactNode;
  /** Optional React node rendered right of the title for inline
   *  controls (filter chips, dropdown buttons, etc.). Passed
   *  through dockview as `params.controls`. When omitted the
   *  header paints a muted chevron placeholder instead. */
  readonly controls?: React.ReactNode;
  /** When true (the default), give the panel body an 8px inset
   *  padding wrapper so its content doesn't touch the rounded edges
   *  of the surrounding dock group (the group itself paints the
   *  surface card; see `.dv-groupview` rules in design-system.css).
   *  Set explicitly to `false` for panels that should fill the
   *  entire dock group flush — e.g. MapCanvasPanel, where the
   *  painter consumes the full rounded group bounds. */
  readonly surface?: boolean;
  /** When true, the panel's title strip is hidden and the panel is
   *  locked from drag-out / re-grouping. Used for "fixed" panels like
   *  the Map Canvas that should always be present and unmoveable.
   *  Defaults to false. */
  readonly headerless?: boolean;
}

export interface DockShellProps {
  /** Unique-per-page key used to persist the layout JSON. Pages should
   *  scope this by project: e.g. `scene::<projectId>`. */
  readonly storageKey: string;
  /** Declarative panel registry. The map's keys MUST match the
   *  `component` strings referenced by `defaultLayout`'s panels. */
  readonly panels: readonly DockPanelDef[];
  /** Initial dockview JSON used when no saved layout exists for
   *  `storageKey`. Most consumers can build this with
   *  `buildDefaultLayout()` below. */
  readonly defaultLayout: SerializedDockview;
  /** Optional callback invoked on every layout change (after the
   *  snapshot is persisted). Useful for views that mirror layout
   *  state into a wider context. */
  readonly onLayoutChange?: (snapshot: SerializedDockview) => void;
  /** Optional className for the dockview container (e.g. to force a
   *  specific height). */
  readonly className?: string;
  /** Optional external ref filled with the live DockviewApi on ready.
   *  Pages that mount a sibling component which calls api.fromJSON /
   *  api.toJSON / api.addPanel (e.g. the Workspace rail's Layouts and
   *  Docks modals) pass the same ref through here so the two surfaces
   *  share a single api instance. */
  readonly apiRef?: React.MutableRefObject<DockviewApi | null>;
}

/**
 * The set of CSS custom-property prefixes we mirror onto the popout
 * document's `:root`. Anything matching one of these prefixes on the
 * main `document.documentElement`'s computed style is copied. We do
 * NOT use the `--*` wildcard because `getComputedStyle` returns
 * hundreds of internal Tailwind variables (e.g. `--tw-*`) we don't
 * want to clone unnecessarily.
 */
const POPOUT_TOKEN_PREFIXES = [
  "--color-",
  "--rail-",
  "--radius-",
  "--gap-",
  "--shadow-",
  "--font-",
  "--dv-",
];

function isTrackedToken(name: string): boolean {
  for (const prefix of POPOUT_TOKEN_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Copy every `--color-*`, `--rail-*`, `--radius-*`, `--gap-*`,
 * `--shadow-*`, `--font-*`, `--dv-*` custom property from the main
 * document's `:root` to `targetWindow.document.documentElement`.
 *
 * Implementation note: `getComputedStyle(documentElement)` does not
 * enumerate custom properties on all browsers (Firefox lists them,
 * Chrome historically did not). We fall back to iterating the
 * matched style declaration of every `:root` selector across the
 * document's stylesheets. SecurityError on cross-origin sheets is
 * swallowed.
 */
function injectTokensIntoPopout(targetWindow: Window): void {
  if (!targetWindow.document || !targetWindow.document.documentElement)
    return;
  const popoutRoot = targetWindow.document.documentElement;

  // 1) Walk every accessible stylesheet's :root rules and replay the
  //    declarations we care about. This catches Tailwind v4 @theme,
  //    our index.css `:root { ... }` block, etc.
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // cross-origin stylesheet — skip; the popout's stylesheet clone
      // (which dockview performs) will carry it over directly.
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      // CSSStyleRule
      if (rule.constructor.name !== "CSSStyleRule") continue;
      const styleRule = rule as CSSStyleRule;
      if (
        styleRule.selectorText !== ":root" &&
        styleRule.selectorText !== "html" &&
        !styleRule.selectorText.includes(":root")
      ) {
        continue;
      }
      const decl = styleRule.style;
      for (let i = 0; i < decl.length; i++) {
        const name = decl.item(i);
        if (!isTrackedToken(name)) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const value = decl.getPropertyValue(name);
        if (value) popoutRoot.style.setProperty(name, value.trim());
      }
    }
  }

  // 2) Belt-and-braces: also try the computed-style read on the main
  //    document's root. Anything visible there but missed above (e.g.
  //    JS-set inline variables) gets through.
  const computed = window.getComputedStyle(document.documentElement);
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i);
    if (!isTrackedToken(name)) continue;
    if (seen.has(name)) continue;
    const value = computed.getPropertyValue(name);
    if (value) {
      seen.add(name);
      popoutRoot.style.setProperty(name, value.trim());
    }
  }
}

/**
 * Clone every same-origin `<link rel="stylesheet">` and inline
 * `<style>` element from the main document into `targetWindow`'s
 * `<head>`. Belt-and-braces in case dockview's own `addStyles` clone
 * misses anything (e.g. HMR-injected styles added after popout
 * opened, although we won't catch those without an observer).
 *
 * Idempotent — every cloned `<link>` carries a `data-dock-cloned`
 * attribute so re-running the clone (e.g. when a second popout opens)
 * doesn't double-insert.
 */
function cloneStylesheetsIntoPopout(targetWindow: Window): void {
  if (!targetWindow.document || !targetWindow.document.head) return;
  const popoutHead = targetWindow.document.head;
  const existing = new Set<string>();
  for (const el of Array.from(
    popoutHead.querySelectorAll<HTMLLinkElement>(
      "link[data-dock-cloned], style[data-dock-cloned]",
    ),
  )) {
    const key = el.getAttribute("data-dock-cloned");
    if (key) existing.add(key);
  }

  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]"),
  );
  for (const link of links) {
    const href = link.href;
    if (!href) continue;
    if (existing.has(href)) continue;
    const clone = targetWindow.document.createElement("link");
    clone.rel = "stylesheet";
    clone.href = href;
    clone.setAttribute("data-dock-cloned", href);
    popoutHead.appendChild(clone);
  }

  const styles = Array.from(document.querySelectorAll<HTMLStyleElement>("style"));
  for (const style of styles) {
    const id = style.id || `inline-${styles.indexOf(style)}`;
    if (existing.has(id)) continue;
    const clone = targetWindow.document.createElement("style");
    clone.textContent = style.textContent;
    clone.setAttribute("data-dock-cloned", id);
    popoutHead.appendChild(clone);
  }
}

/**
 * Strip non-serialisable React-element junk from a saved layout's
 * panel params. The shape we look for is the standard React element
 * tuple — `{type, key, props, _owner, _store}` — which is what a
 * React element looks like after JSON.stringify drops its methods.
 * If we leave it in `params`, dockview will hand it to the panel /
 * tab as `props.params` and React tries to render it as a child, at
 * which point React throws "Objects are not valid as a React child".
 *
 * We don't try to map it back to a live element — there's no
 * reliable way to do that without the original component identity.
 * Instead we drop those fields entirely; `<DockShell/>` supplies
 * fresh ornaments via the React context layer.
 */
function sanitizeLayout(layout: SerializedDockview): SerializedDockview {
  const looksLikeReactElement = (v: unknown): boolean => {
    if (v === null || typeof v !== "object") return false;
    const obj = v as Record<string, unknown>;
    // React element-shaped object: has `type` + (`props` or `key`)
    // and lost its `$$typeof` symbol via JSON serialization.
    return "type" in obj && ("props" in obj || "key" in obj || "_owner" in obj);
  };
  // Shallow clone — we mutate only the `params` of each panel.
  const next: SerializedDockview = { ...layout, panels: { ...layout.panels } };
  for (const id of Object.keys(next.panels)) {
    const panel = { ...next.panels[id]! };
    const params = panel.params;
    if (params && typeof params === "object") {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (looksLikeReactElement(v)) continue;
        cleaned[k] = v;
      }
      panel.params = cleaned;
    }
    next.panels[id] = panel;
  }
  return next;
}

/**
 * PanelSurface — the visible raised card for dock panels that opt
 * into the `surface: true` flag on their `DockPanelDef`.
 *
 * Architecture: dock chrome (group, tab strip, content container) is
 * fully transparent. The page-bg shows through everywhere by default.
 * `PanelSurface` renders inside `.dv-content-container` and is the
 * ONLY element painting `--color-bg-panel-surface` + border-strong +
 * rounded corners. The outer `p-1` creates a 4px margin on every side
 * between the card and the content-container edge — adjacent surface
 * panels therefore have an 8px visible gap (4px each side) without
 * any margin/padding on dockview-managed elements that would break
 * its gridview math.
 *
 * Inner `p-2` is the panel body's internal padding so content
 * doesn't kiss the rounded corners of the card.
 *
 * `surface: false` panels (Map Canvas, Output / Problems / Selection
 * Info) skip this wrapper entirely and fill the entire dock content
 * area flush, with the dock chrome remaining transparent so the
 * darker page bg reads through.
 */
function PanelSurface({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // Outer wrapper uses `px-1 pb-1` (no top padding) so the rounded
  // surface card sits flush against the bottom of dockview's title
  // strip — the user wants the title visually attached to its
  // surface, not floating with a vertical gap above it. Left, right,
  // and bottom keep 4px so adjacent panels still have an 8px gap.
  return (
    <div className="h-full w-full px-1 pb-1">
      <div className="h-full w-full bg-(--color-bg-panel-surface) border border-(--color-border-strong) rounded-md p-2 shadow-[var(--shadow-panel)]">
        {children}
      </div>
    </div>
  );
}

export function DockShell({
  storageKey,
  panels,
  defaultLayout,
  onLayoutChange,
  className,
  apiRef: externalApiRef,
}: DockShellProps) {
  const { initial, save } = useDockLayoutPersistence(storageKey);

  // Build the panel-id → React component map dockview consumes. Stable
  // across renders for a given `panels` array — the registry rarely
  // changes after first render, so keying by identity is fine.
  //
  // Panels default to `surface: true` — wrapped in `<PanelSurface/>`
  // (--color-bg-panel-surface + border-strong + rounded-md). Panels
  // that need to fill the dock content area flush (canvas painter,
  // future fullscreen previews) opt out by setting `surface: false`
  // explicitly. The dock content container's universal `p-2` provides
  // 8px breathing room either way.
  const components = React.useMemo(() => {
    const map: Record<string, React.FunctionComponent<IDockviewPanelProps>> =
      {};
    for (const p of panels) {
      if (p.surface === false) {
        map[p.id] = p.component;
      } else {
        const Inner = p.component;
        const Wrapped: React.FunctionComponent<IDockviewPanelProps> = (
          props,
        ) => (
          <PanelSurface>
            <Inner {...props} />
          </PanelSurface>
        );
        Wrapped.displayName = `PanelSurface(${p.id})`;
        map[p.id] = Wrapped;
      }
    }
    return map;
  }, [panels]);

  // Hold the api so we can persist on layout change. If the caller
  // passed an external apiRef (e.g. so a sibling Workspace rail can
  // share the same api), populate that too.
  const internalApiRef = React.useRef<DockviewApi | null>(null);
  const apiRef = externalApiRef ?? internalApiRef;

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      // ── Headerless / locked panel support ────────────────────────
      //
      // Panels can opt into a "fixed" presentation via
      // `headerless: true` on their DockPanelDef. The dock group that
      // owns such a panel has its tab strip hidden (CSS rule keyed on
      // `[data-headerless]` set on `.dv-groupview`) and is locked
      // against drop/drag operations so users can't accidentally
      // remove or re-group it.
      //
      // Two flow paths land panels into the dock:
      //   1. `api.fromJSON(...)` rebuilds panels from a saved/default
      //      layout. The panel objects exist BEFORE our
      //      `onDidAddPanel` subscription is wired below, so we walk
      //      `api.panels` after fromJSON and apply.
      //   2. `api.addPanel(...)` called at runtime (DocksModal drops,
      //      external drag drops). `onDidAddPanel` fires after the
      //      panel is in place; we apply there.
      //
      // The application is idempotent: setting a data-attribute and
      // toggling `group.locked` twice is harmless.
      const headerlessIds = new Set(
        panels.filter((p) => p.headerless === true).map((p) => p.id),
      );
      const surfacelessIds = new Set(
        panels.filter((p) => p.surface === false).map((p) => p.id),
      );
      const applyHeaderlessToPanel = (
        panel: import("dockview").IDockviewPanel,
      ) => {
        if (!headerlessIds.has(panel.api.id)) return;
        try {
          panel.group.element.setAttribute("data-headerless", "");
        } catch {
          // Group element not yet attached — non-fatal; the next
          // group/location change will retry via re-application
          // below.
        }
        try {
          panel.group.locked = "no-drop-target";
        } catch {
          // Lock setter rejected — non-fatal; user can still recover
          // by editing the layout JSON manually.
        }
      };
      // Same mechanism for `surface: false` — stamp a data-attribute
      // on the group element so CSS can strip the panel-surface
      // treatment (bg + border + radius) on that specific group. The
      // `.dv-groupview` rule in design-system.css excludes groups
      // marked with this attribute. PanelSurface (the inner p-2
      // wrapper) is already skipped at component-build time for these
      // panels.
      const applySurfacelessToPanel = (
        panel: import("dockview").IDockviewPanel,
      ) => {
        if (!surfacelessIds.has(panel.api.id)) return;
        try {
          panel.group.element.setAttribute("data-surface", "false");
        } catch {
          // ignore — same recovery semantics as headerless
        }
      };

      // Restore saved layout, or fall back to the default.
      //
      // Sanitize any pre-existing snapshot — older builds of this
      // shell put React-element ornaments (icon/controls) into panel
      // params; those round-trip through localStorage as plain
      // objects shaped like `{type, key, props, _owner, _store}` and
      // get rendered as children of a `<span>`, which React rejects
      // with "Objects are not valid as a React child". Strip those
      // entries so legacy snapshots load cleanly.
      const sanitized = initial ? sanitizeLayout(initial) : null;
      const layoutToLoad = sanitized ?? defaultLayout;
      try {
        api.fromJSON(layoutToLoad);
      } catch {
        // Saved layout failed validation (e.g. references a panel id
        // that no longer exists). Fall back to the default so the
        // page is at least usable.
        try {
          api.fromJSON(defaultLayout);
        } catch {
          // Default layout itself is broken — nothing more we can do
          // here. dockview will render an empty watermark.
        }
      }

      // Persist the post-load state once so a fresh load (no existing
      // entry) saves the layout immediately. Without this the
      // dockLayouts slice stays empty until the user triggers a real
      // layout change.
      try {
        save(api);
      } catch {
        // ignore — first persist is best-effort
      }

      // Apply headerless + surfaceless treatments to every panel
      // restored by fromJSON above. Future panels (DocksModal /
      // external drop) are caught by the `onDidAddPanel` subscription
      // below.
      for (const p of api.panels) {
        applyHeaderlessToPanel(p);
        applySurfacelessToPanel(p);
      }
      const addPanelSub = api.onDidAddPanel((p) => {
        applyHeaderlessToPanel(p);
        applySurfacelessToPanel(p);
      });

      // Persist on every layout change. Cheap enough that debouncing
      // isn't necessary — the JSON is tiny and writes are synchronous.
      const layoutSub = api.onDidLayoutChange(() => {
        save(api);
        if (onLayoutChange) {
          try {
            onLayoutChange(api.toJSON());
          } catch {
            // ignore consumer errors
          }
        }
      });

      // NOTE: icon/controls are NOT stored on the dockview panel
      // params (those get JSON-serialised into the saved layout
      // snapshot — and React nodes are not JSON-safe; round-tripping
      // them produces objects with a `type/key/props/_owner/_store`
      // shape that React refuses to render). Instead, the
      // `DockPanelHeader` renderer reads icon/controls from a React
      // context (`DockPanelHeaderOrnamentsContext`) keyed by panel
      // id; that context is supplied by `<DockShell/>`'s JSX wrapper
      // and never participates in dockview's serialisation.

      // Popout token-injection. See the file header comment for the
      // full rationale. dockview does NOT expose a global "popout
      // opened" event — but every group exposes
      // `onDidLocationChange` which fires whenever the group migrates
      // between grid / floating / popout. We listen on every group
      // (existing + newly added) and inject when the location flips to
      // popout. We also try once at add-time in case a group is born
      // directly into a popout (restored from a saved layout).
      const groupCleanups = new Map<string, () => void>();

      const runPopoutInjection = (win: Window) => {
        const runInjection = () => {
          try {
            cloneStylesheetsIntoPopout(win);
            injectTokensIntoPopout(win);
          } catch {
            // Popout closed before we could inject — non-fatal.
          }
        };
        runInjection();
        try {
          // Second pass on next frame so any styles dockview itself
          // clones after our pass don't overshadow our :root tokens.
          win.requestAnimationFrame(runInjection);
        } catch {
          // ignore
        }
      };

      const maybeInjectGroup = (group: ReturnType<DockviewApi["getGroup"]>) => {
        if (!group) return;
        if (group.api.location.type !== "popout") return;
        const loc = group.api.location;
        try {
          const win = loc.getWindow();
          runPopoutInjection(win);
        } catch {
          // Window not yet available — onDidLocationChange will retry.
        }
      };

      const watchGroup = (group: ReturnType<DockviewApi["getGroup"]>) => {
        if (!group) return;
        if (groupCleanups.has(group.id)) return;
        // React when this group's location changes (e.g. user drags
        // it into a popout window).
        const sub = group.api.onDidLocationChange(() => {
          maybeInjectGroup(group);
        });
        groupCleanups.set(group.id, () => sub.dispose());
        // First pass in case the group is already in a popout (saved
        // layout with popoutGroups, or a programmatic popout call
        // that happened before our subscription).
        maybeInjectGroup(group);
      };

      const addGroupSub = api.onDidAddGroup((group) => watchGroup(group));
      const removeGroupSub = api.onDidRemoveGroup((group) => {
        const cleanup = groupCleanups.get(group.id);
        if (cleanup) {
          cleanup();
          groupCleanups.delete(group.id);
        }
      });
      // Subscribe to any groups that already exist (e.g. groups
      // recreated by `fromJSON` before our subscription was wired).
      for (const g of api.groups) watchGroup(g);

      // ── Drag-off-viewport → popout gesture layer ──────────────────
      //
      // What this intercepts:
      //   dockview's `onWillDragPanel` / `onWillDragGroup` fire when
      //   the user starts dragging a panel tab (resp. an entire
      //   group's titlebar). The native HTML5 drag has already begun
      //   at this point — dockview hands us the in-flight DragEvent
      //   plus a reference to the panel/group being dragged.
      //
      // What coordinates it tracks:
      //   We mount a `pointermove` listener on `window` to track the
      //   pointer's clientX/clientY for the duration of the drag. On
      //   `pointerup` we compare against the viewport bounds. The
      //   tolerance (POPOUT_EDGE_TOLERANCE) is the number of pixels
      //   *outside* the viewport we require before treating it as an
      //   intentional popout gesture — without it, a near-edge drop
      //   would spawn a popout window unexpectedly.
      //
      // Why we need this:
      //   dockview's default behaviour for an outside-the-grid drop
      //   is to cancel the move (the panel snaps back to its origin
      //   group). The expected editor UX is "drag a panel beyond the
      //   viewport edge → it pops out into a new window at the
      //   release point". We layer that on by detecting the off-
      //   viewport pointerup ourselves and calling
      //   `api.addPopoutGroup(panel, { position: { left, top, width,
      //   height }, popoutUrl: '/popout.html' })` ourselves.
      //
      // Notes on coupling:
      //   - We don't try to suppress dockview's native drop logic —
      //     when the pointer is outside the viewport there's no
      //     dockview drop target to fight with, so the drag naturally
      //     ends with a no-op snap-back. Our popout call schedules on
      //     `pointerup` and runs after dockview's drag-end cleanup
      //     completes (queueMicrotask), so addPopoutGroup sees the
      //     panel/group in its original location and can pop it
      //     cleanly.
      //   - For TabDragEvent the source is a single panel; we pop
      //     just that panel. For GroupDragEvent the source is a
      //     whole group; we pop the entire group. dockview's
      //     `addPopoutGroup` accepts either.
      //   - Position: width/height inherit from the source panel's
      //     bounding rect (read via panel.api.width/height which the
      //     gridview keeps current); left/top derive from the
      //     release-point so the popout window opens roughly where
      //     the user dropped it. We bias left/top so the cursor
      //     lands near the top-left of the popout, not its origin.
      const POPOUT_EDGE_TOLERANCE = 30;
      type PendingDrag =
        | { kind: "panel"; panel: import("dockview").IDockviewPanel }
        | {
            kind: "group";
            group: import("dockview").DockviewGroupPanel;
          };
      let pendingDrag: PendingDrag | null = null;
      let lastPointer: { x: number; y: number } | null = null;
      let activePointerId: number | null = null;

      const onPointerMove = (ev: PointerEvent) => {
        lastPointer = { x: ev.clientX, y: ev.clientY };
      };

      const isOutsideViewport = (x: number, y: number): boolean => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        return (
          x < -POPOUT_EDGE_TOLERANCE ||
          y < -POPOUT_EDGE_TOLERANCE ||
          x > w + POPOUT_EDGE_TOLERANCE ||
          y > h + POPOUT_EDGE_TOLERANCE
        );
      };

      const finishDrag = (releaseX: number, releaseY: number) => {
        const drag = pendingDrag;
        pendingDrag = null;
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("dragend", onDragEnd, true);
        activePointerId = null;
        if (!drag) return;
        if (!isOutsideViewport(releaseX, releaseY)) return;

        // Inherit size from the source panel/group. Both expose
        // .width / .height via their api.
        let width = 480;
        let height = 320;
        let item: import("dockview").IDockviewPanel | import("dockview").DockviewGroupPanel;
        if (drag.kind === "panel") {
          item = drag.panel;
          const w = drag.panel.api.width;
          const h = drag.panel.api.height;
          if (typeof w === "number" && w > 0) width = w;
          if (typeof h === "number" && h > 0) height = h;
        } else {
          item = drag.group;
          const w = drag.group.api.width;
          const h = drag.group.api.height;
          if (typeof w === "number" && w > 0) width = w;
          if (typeof h === "number" && h > 0) height = h;
        }

        // Convert client (viewport) coords to screen coords for the
        // popout window's position. window.screenX/Y account for
        // browser chrome + monitor placement; clientX/Y are relative
        // to the editor viewport.
        const screenLeft =
          (window.screenX ?? 0) + releaseX - Math.round(width * 0.1);
        const screenTop =
          (window.screenY ?? 0) + releaseY - 16;

        // Defer so dockview's drag-end cleanup runs first; calling
        // addPopoutGroup mid-drag races the native dragend handler.
        queueMicrotask(() => {
          try {
            void api.addPopoutGroup(item, {
              // assetUrl prefixes the Pages subpath (`/cardboard/`)
              // when the editor is served from one; in dev it's a
              // no-op.
              popoutUrl: assetUrl("/popout.html"),
              position: {
                left: screenLeft,
                top: screenTop,
                width,
                height,
              },
            });
          } catch {
            // Popout failed (popup blocked, addPopoutGroup rejected,
            // etc.) — the panel stays in the main window, which is
            // an acceptable fallback.
          }
        });
      };

      const onPointerUp = (ev: PointerEvent) => {
        if (
          activePointerId !== null &&
          ev.pointerId !== activePointerId
        ) {
          return;
        }
        const x = ev.clientX;
        const y = ev.clientY;
        finishDrag(x, y);
      };

      // HTML5 dragend fires when the OS drag completes; we use it as
      // a backup signal in case the pointerup is swallowed (e.g.
      // released over a window that captured pointer events).
      const onDragEnd = (ev: DragEvent) => {
        const x = ev.clientX;
        const y = ev.clientY;
        // Prefer the last live pointermove if dragend's coords are 0
        // (some browsers report 0,0 on drag cancel).
        const px = x === 0 && y === 0 && lastPointer ? lastPointer.x : x;
        const py = x === 0 && y === 0 && lastPointer ? lastPointer.y : y;
        finishDrag(px, py);
      };

      const startTracking = () => {
        lastPointer = null;
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("dragend", onDragEnd, true);
      };

      const willDragPanelSub = api.onWillDragPanel((e) => {
        // Workspace v1.5: workspace is a regular panel — no popout
        // guard. Any panel (including workspace) can be dragged
        // off-viewport into a floating window.
        pendingDrag = { kind: "panel", panel: e.panel };
        activePointerId = null;
        startTracking();
      });
      const willDragGroupSub = api.onWillDragGroup((e) => {
        pendingDrag = { kind: "group", group: e.group };
        activePointerId = null;
        startTracking();
      });

      // ── External-drag drop handler (Docks modal cards) ───────────
      //
      // DocksModal cards carry `dataTransfer["dockview/panel-id"]`
      // payloads. dockview fires `onDidDrop` only for drops it could
      // NOT handle itself — which includes external drags from
      // outside the dockview tree (our case). When the payload
      // matches a registered panel id, we mount it into the target
      // group (within = same tab strip) or fall back to right-edge
      // placement if no group is provided. On success we emit
      // `cardboard:panel-added` so the DocksModal can auto-dismiss.
      const onDidDropSub = api.onDidDrop((event) => {
        try {
          const id = event.nativeEvent.dataTransfer?.getData(
            "dockview/panel-id",
          );
          if (!id) return;
          const def = panels.find((p) => p.id === id);
          if (!def) return;
          // Don't double-mount.
          if (api.getPanel(id)) return;
          const targetGroup = event.group;
          if (targetGroup) {
            api.addPanel({
              id,
              component: id,
              title: def.title,
              position: { referenceGroup: targetGroup, direction: "within" },
            });
          } else {
            api.addPanel({
              id,
              component: id,
              title: def.title,
              position: { direction: "right" },
            });
          }
          // Tell modals (DocksModal) the drop landed so they can
          // dismiss themselves automatically.
          window.dispatchEvent(
            new CustomEvent("cardboard:panel-added", { detail: { id } }),
          );
        } catch {
          // dockview rejected the drop — non-fatal.
        }
      });

      // ── Reset-layout event ───────────────────────────────────────
      //
      // The Workspace rail's Reset button clears the persisted layout
      // from the store and dispatches this event on `window`. We
      // re-apply the page's default layout JSON.
      const onReset = (ev: Event) => {
        const detail = (ev as CustomEvent<{ storageKey?: string }>).detail;
        if (!detail || detail.storageKey !== storageKey) return;
        try {
          api.fromJSON(defaultLayout);
        } catch {
          // ignore
        }
      };
      window.addEventListener("cardboard:reset-workspace", onReset);

      // Clean up on unmount.
      return () => {
        layoutSub.dispose();
        addPanelSub.dispose();
        addGroupSub.dispose();
        removeGroupSub.dispose();
        willDragPanelSub.dispose();
        willDragGroupSub.dispose();
        onDidDropSub.dispose();
        window.removeEventListener("cardboard:reset-workspace", onReset);
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("dragend", onDragEnd, true);
        for (const c of groupCleanups.values()) c();
        groupCleanups.clear();
      };
    },
    [defaultLayout, initial, onLayoutChange, panels, save, storageKey, apiRef],
  );

  // Build the icon/controls map for `DockPanelHeader` to read from
  // context. This is the source of truth for ornaments — separate
  // from dockview's serialisable params layer.
  const ornaments = React.useMemo<Record<string, DockPanelHeaderOrnaments>>(
    () => {
      const map: Record<string, DockPanelHeaderOrnaments> = {};
      for (const p of panels) {
        map[p.id] = { icon: p.icon, controls: p.controls };
      }
      return map;
    },
    [panels],
  );

  return (
    <div
      className={`dockview-theme-cardboard h-full w-full min-h-0 ${className ?? ""}`}
    >
      <DockPanelHeaderOrnamentsContext.Provider value={ornaments}>
        <DockviewReact
          components={components}
          onReady={handleReady}
          // When a group contains exactly one panel, render its tab
          // strip full-width — combined with our custom
          // `defaultTabComponent`, that single tab reads as a panel
          // header bar (see Editor Design/Entities.png). Multi-panel
          // groups revert to the narrow-tab look automatically.
          singleTabMode="fullwidth"
          // Every panel uses our `DockPanelHeader` renderer for its
          // tab unless it explicitly specifies a different
          // `tabComponent`. We pass the component directly (not a
          // string id) because dockview-react accepts a React function
          // component for `defaultTabComponent`.
          defaultTabComponent={DockPanelHeader}
          disableDnd={false}
        />
      </DockPanelHeaderOrnamentsContext.Provider>
    </div>
  );
}

/**
 * Convenience helper — build a dockview layout JSON with a single
 * row of side-by-side panels. The first registered panel goes left,
 * the rest right (split off the first). For more complex layouts
 * (nested rows/columns) consumers should hand-author the JSON.
 */
export function buildSideBySideLayout(
  panels: readonly DockPanelDef[],
): SerializedDockview {
  if (panels.length === 0) {
    return {
      grid: {
        root: { type: "branch", data: [], size: 1000 },
        height: 1000,
        width: 1000,
        orientation: "HORIZONTAL" as const,
      },
      panels: {},
    } as unknown as SerializedDockview;
  }
  const panelMap: SerializedDockview["panels"] = {};
  for (const p of panels) {
    // NOTE: icon/controls are NOT placed in the JSON params here.
    // They're React nodes — not JSON-serialisable — and the saved
    // layout snapshot in localStorage would lose them on reload.
    // DockShell re-injects them via `onDidAddPanel` →
    // `panel.api.updateParameters(...)` at runtime using the
    // registry as the source of truth. The JSON snapshot only
    // tracks id / title / contentComponent / structural layout.
    panelMap[p.id] = {
      id: p.id,
      contentComponent: p.id,
      title: p.title,
    };
  }
  const leaves = panels.map((p) => ({
    type: "leaf" as const,
    data: {
      views: [p.id],
      activeView: p.id,
      id: p.id + "-group",
    },
    size: Math.round(1000 / panels.length),
  }));
  return {
    grid: {
      root: {
        type: "branch" as const,
        data: leaves,
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "HORIZONTAL" as const,
    },
    panels: panelMap,
  } as unknown as SerializedDockview;
}

export default DockShell;
