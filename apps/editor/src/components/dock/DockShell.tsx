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
import {
  WorkspacePanelContext,
  WORKSPACE_PANEL_ID,
} from "./WorkspacePanel";

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

export function DockShell({
  storageKey,
  panels,
  defaultLayout,
  onLayoutChange,
  className,
}: DockShellProps) {
  const { initial, save } = useDockLayoutPersistence(storageKey);

  // Build the panel-id → React component map dockview consumes. Stable
  // across renders for a given `panels` array — the registry rarely
  // changes after first render, so keying by identity is fine.
  const components = React.useMemo(() => {
    const map: Record<string, React.FunctionComponent<IDockviewPanelProps>> =
      {};
    for (const p of panels) {
      map[p.id] = p.component;
    }
    return map;
  }, [panels]);

  // Hold the api so we can persist on layout change.
  const apiRef = React.useRef<DockviewApi | null>(null);

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

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

      // ── Workspace safety net ──────────────────────────────────────
      //
      // Workspace v1.5: the rail is a regular dockview panel — it can
      // be closed, popped out, and dragged like any other. This safety
      // net only re-adds the panel if a saved layout legitimately
      // dropped it (so the user is never stranded without their
      // layout-controls rail). The TopBar "Show Workspace" button is
      // the explicit user-facing escape hatch.
      const WORKSPACE_DEFAULT_WIDTH = 40;
      const ensureWorkspace = () => {
        if (!panels.some((p) => p.id === WORKSPACE_PANEL_ID)) return;
        if (api.getPanel(WORKSPACE_PANEL_ID)) return;
        try {
          api.addPanel({
            id: WORKSPACE_PANEL_ID,
            component: WORKSPACE_PANEL_ID,
            title: "Workspace",
            params: {
              pageId: storageKey.split("::")[0] ?? "default",
              storageKey,
            },
            position: { direction: "left" },
            // Rail is locked to a 40px strip on the docked axis from
            // the moment the panel is created — dockview's gridview
            // defaults a minimum of ~100px when these aren't set, so
            // initialWidth alone leaves the rail at 100px. Passing
            // min + max on the addPanel options bypasses that default.
            // The opposite axis stays loose (minimum 40, no max) so
            // the rail still flexes to its container along the long
            // edge. syncWorkspaceOrientation re-asserts these when
            // the user drags the rail to a different edge.
            initialWidth: WORKSPACE_DEFAULT_WIDTH,
            minimumWidth: WORKSPACE_DEFAULT_WIDTH,
            maximumWidth: WORKSPACE_DEFAULT_WIDTH,
            minimumHeight: WORKSPACE_DEFAULT_WIDTH,
          });
        } catch {
          // Adding the panel failed — surface nothing to the user;
          // they can still navigate away and back to reset.
        }
      };
      ensureWorkspace();
      // Persist the post-ensureWorkspace state once so a fresh load
      // (no existing entry) saves the workspace-included layout
      // immediately. Without this the dockLayouts slice stays empty
      // until the user triggers a real layout change.
      try {
        save(api);
      } catch {
        // ignore — first persist is best-effort
      }

      // ── Workspace orientation sync ──────────────────────────────────
      //
      // Whenever the workspace group's orientation flips (user drags it
      // from a left/right edge to a top/bottom edge or vice versa), we
      // update TWO things in tandem:
      //
      //   1. Header position. dockview-core exposes
      //      `group.api.setHeaderPosition()` / `getHeaderPosition()`
      //      (see .../api/dockviewGroupPanelApi.d.ts lines 44-45).
      //      We map orientation → header edge so the drag-handle tab
      //      always sits "after" the icons:
      //        - vertical dock (left/right edge) → header at 'bottom'
      //        - horizontal dock (top/bottom edge) → header at 'right'
      //
      //   2. Size constraints. The rail is supposed to be a fixed 40px
      //      strip — not resizable. We lock the size by setting both
      //      min and max on the constrained axis to the same value:
      //        - vertical rail → minWidth = maxWidth = 40 (also minH 40)
      //        - horizontal rail → minH = maxH = 40 (also minW 40)
      //      dockview's gridview respects these constraints; the
      //      splitter rendered alongside the panel becomes inert
      //      because there's no slack to redistribute.
      //
      // Orientation detection: there's no public orientation API on
      // dockview's panel/group surface, so we infer from the measured
      // width vs height of the group. width >= height → landscape.
      // Cached last orientation. setConstraints + setSize only run
      // when orientation ACTUALLY flips (vertical rail ↔ horizontal
      // rail). Running them on every onDidLayoutChange event creates
      // a feedback loop during drag — each setSize fires another
      // layout change, which fires this handler, which calls setSize
      // again — and Chrome eventually OOMs the tab ("Aw, Snap"). The
      // cache breaks that loop: same orientation = no-op.
      let lastOrientation: "landscape" | "portrait" | null = null;
      let applyingSyncWork = false;

      const syncWorkspaceOrientation = () => {
        if (applyingSyncWork) return;
        const panel = api.getPanel(WORKSPACE_PANEL_ID);
        if (!panel) return;
        const group = panel.group;
        if (!group) return;
        const w = group.api.width;
        const h = group.api.height;
        if (typeof w !== "number" || typeof h !== "number") return;
        // Skip if the panel hasn't been laid out yet — w or h being
        // zero means dockview is still bootstrapping. Earlier `w >= h`
        // returned 0>=0 = true for the initial render, which
        // incorrectly latched the orientation cache to "landscape"
        // and pinned height instead of width — left the rail at
        // dockview's 100px gridview default and the constraints never
        // recovered.
        if (w === 0 || h === 0) return;
        const orientation: "landscape" | "portrait" =
          w > h ? "landscape" : "portrait";
        if (orientation === lastOrientation) return;
        lastOrientation = orientation;
        const isLandscape = orientation === "landscape";
        const desired: "bottom" | "right" = isLandscape ? "right" : "bottom";
        applyingSyncWork = true;
        try {
          const current = group.api.getHeaderPosition();
          if (current !== desired) group.api.setHeaderPosition(desired);
        } catch {
          // Older dockview build or transient state — ignore.
        }
        try {
          panel.api.setConstraints(
            isLandscape
              ? {
                  minimumHeight: WORKSPACE_DEFAULT_WIDTH,
                  maximumHeight: WORKSPACE_DEFAULT_WIDTH,
                  minimumWidth: WORKSPACE_DEFAULT_WIDTH,
                }
              : {
                  minimumWidth: WORKSPACE_DEFAULT_WIDTH,
                  maximumWidth: WORKSPACE_DEFAULT_WIDTH,
                  minimumHeight: WORKSPACE_DEFAULT_WIDTH,
                },
          );
          // setSize gets deferred to the next animation frame.
          // Calling it synchronously right after a drag-drop landed
          // the panel in its new orientation doesn't snap reliably
          // — dockview's gridview is still settling the splitter
          // weights from the drop and silently drops the size
          // request. Waiting one rAF lets the gridview finalise its
          // post-drop layout, then our setSize forcibly snaps the
          // constrained axis to 40px.
          requestAnimationFrame(() => {
            try {
              panel.api.setSize(
                isLandscape
                  ? { height: WORKSPACE_DEFAULT_WIDTH }
                  : { width: WORKSPACE_DEFAULT_WIDTH },
              );
            } catch {
              // ignore — panel may have been removed
            }
          });
        } catch {
          // ignore
        } finally {
          // Allow further syncs after the rAF drains so the
          // setSize-triggered onDidLayoutChange we'll emit can't
          // re-enter the function before we exit the current pass.
          requestAnimationFrame(() => {
            applyingSyncWork = false;
          });
        }
      };
      // Initial sync after layout has settled.
      syncWorkspaceOrientation();

      // Persist on every layout change. Cheap enough that debouncing
      // isn't necessary — the JSON is tiny and writes are synchronous.
      const layoutSub = api.onDidLayoutChange(() => {
        save(api);
        // The workspace group's dimensions / location may have just
        // changed (resize, dock move). Re-sync the header position so
        // the tab strip lives on the correct edge.
        syncWorkspaceOrientation();
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
              popoutUrl: "/popout.html",
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
      // re-apply the default layout (which always includes the
      // workspace panel) so the user sees the page-default
      // configuration restored.
      const onReset = (ev: Event) => {
        const detail = (ev as CustomEvent<{ storageKey?: string }>).detail;
        if (!detail || detail.storageKey !== storageKey) return;
        try {
          api.fromJSON(defaultLayout);
          ensureWorkspace();
        } catch {
          // ignore
        }
      };
      window.addEventListener("cardboard:reset-workspace", onReset);

      // ── Show-workspace event ─────────────────────────────────────
      //
      // The TopBar "Show Workspace" button dispatches this; if the
      // workspace panel is missing (shouldn't happen because of the
      // safety net but possible during transition states), we
      // re-add it. Otherwise we focus it for a visual ping.
      const onShow = () => {
        const existing = api.getPanel(WORKSPACE_PANEL_ID);
        if (existing) {
          try {
            existing.focus();
          } catch {
            // ignore
          }
        } else {
          ensureWorkspace();
        }
      };
      window.addEventListener("cardboard:show-workspace", onShow);

      // Clean up on unmount.
      return () => {
        layoutSub.dispose();
        addGroupSub.dispose();
        removeGroupSub.dispose();
        willDragPanelSub.dispose();
        willDragGroupSub.dispose();
        onDidDropSub.dispose();
        window.removeEventListener("cardboard:reset-workspace", onReset);
        window.removeEventListener("cardboard:show-workspace", onShow);
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("dragend", onDragEnd, true);
        for (const c of groupCleanups.values()) c();
        groupCleanups.clear();
      };
    },
    [defaultLayout, initial, onLayoutChange, panels, save, storageKey],
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

  // Surface the live api ref + panel registry to the WorkspacePanel
  // via context. The workspace rail needs both to (a) snapshot the
  // current layout into a preset, (b) list available panels in the
  // Panel Packer flyout, and (c) re-mount panels via api.addPanel.
  // We can't pass these through dockview's params (api isn't
  // serialisable; registry contains React components).
  const workspaceCtxValue = React.useMemo(
    () => ({ api: apiRef.current, registry: panels, apiRef }),
    [panels],
  );

  return (
    <div
      className={`dockview-theme-cardboard h-full w-full min-h-0 ${className ?? ""}`}
    >
      <WorkspacePanelContext.Provider value={workspaceCtxValue}>
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
            // Keep dockview's default tab close button hidden by default —
            // editor panels are part of the page layout, not user-spawned
            // documents the user is meant to dismiss. Pages can opt into
            // closability per-panel by overriding this in their layout JSON.
            disableDnd={false}
          />
        </DockPanelHeaderOrnamentsContext.Provider>
      </WorkspacePanelContext.Provider>
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
