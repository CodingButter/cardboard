import React from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview";
import { useDockLayoutPersistence } from "./useDockLayoutPersistence";

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
      const layoutToLoad = initial ?? defaultLayout;
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

      // Clean up on unmount.
      return () => {
        layoutSub.dispose();
        addGroupSub.dispose();
        removeGroupSub.dispose();
        for (const c of groupCleanups.values()) c();
        groupCleanups.clear();
      };
    },
    [defaultLayout, initial, onLayoutChange, save],
  );

  return (
    <div
      className={`dockview-theme-cardboard h-full w-full min-h-0 ${className ?? ""}`}
    >
      <DockviewReact
        components={components}
        onReady={handleReady}
        // Keep dockview's default tab close button hidden by default —
        // editor panels are part of the page layout, not user-spawned
        // documents the user is meant to dismiss. Pages can opt into
        // closability per-panel by overriding this in their layout JSON.
        disableDnd={false}
      />
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
