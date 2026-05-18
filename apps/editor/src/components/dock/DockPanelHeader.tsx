import React from "react";
import { ChevronDown, GripHorizontal, GripVertical } from "lucide-react";
import type { IDockviewPanelHeaderProps } from "dockview";
import { cn } from "../../lib/cn";

/**
 * Ornaments — non-serialisable React-node decorations the header
 * renders alongside the title.
 *
 * These do NOT live in dockview's panel params (those are
 * JSON-serialised into the saved layout snapshot; React nodes would
 * round-trip as broken `{type,key,props,_owner,_store}` objects).
 * Instead, `<DockShell/>` supplies a map keyed by panel id via the
 * context below, and this component reads its entry by id.
 */
export interface DockPanelHeaderOrnaments {
  icon?: React.ReactNode;
  controls?: React.ReactNode;
}

export const DockPanelHeaderOrnamentsContext = React.createContext<
  Record<string, DockPanelHeaderOrnaments>
>({});

/**
 * DockPanelHeader — custom tab renderer for dockview that styles the
 * tab as a panel-header bar matching `Editor Design/Entities.png`.
 *
 * dockview's API surface used:
 *   - `<DockviewReact defaultTabComponent={DockPanelHeader} />` — wires
 *     this React component as the tab renderer for every panel that
 *     does not specify a `tabComponent` override (see
 *     `dockview/dist/esm/dockview/dockview.d.ts` — IDockviewReactProps).
 *   - `singleTabMode: 'fullwidth'` on the DockviewReact options forces
 *     groups containing exactly one panel to render their tab strip
 *     full-width (see options.d.ts). When combined with this renderer,
 *     a single-panel group looks like a panel-header bar; when the
 *     user drags a second panel into the same group, dockview
 *     automatically reverts to its narrow-tab look — that's correct
 *     fallback behaviour.
 *
 * Header shape (per Entities.png target):
 *   - h-9 (36px) bar
 *   - bg-(--color-bg-card-elev), border-b border-(--color-border)
 *   - small-caps uppercase title, text-[11px] tracking-wider
 *   - optional left icon (passed via params.icon as a node)
 *   - optional right controls slot (params.controls — a node) or a
 *     fallback chevron-down menu placeholder
 *   - clicking-and-dragging the bar still feeds dockview's native
 *     reorder/split/popout machinery (dockview attaches its DnD
 *     listeners to the element this component renders).
 *
 * Reading custom params: panel params are arbitrary objects supplied
 * via the panel-options JSON or `api.addPanel({ params: ... })`. We
 * expose two optional, render-only knobs:
 *   - `icon` — a small React node painted left of the title.
 *   - `controls` — a React node painted right of the title (for
 *     inline filter chips, dropdowns, etc.). When omitted we render a
 *     muted chevron icon as a visual placeholder so the bar reads as
 *     interactive in the design language even on minimal panels.
 *
 * These params are *not* part of dockview's core schema; they're a
 * convention this app applies. We type them loosely (the cast below)
 * since dockview's `Parameters` is intentionally `{ [k: string]: any }`.
 */

/** Serialisable knobs the header reads from dockview panel params.
 *  These survive JSON round-trip — keep them primitive only. */
interface DockPanelHeaderParams {
  /** Hide the trailing chevron placeholder. Defaults to false. */
  hideTrailingChevron?: boolean;
}

export function DockPanelHeader(
  props: IDockviewPanelHeaderProps,
): React.JSX.Element | null {
  const { api } = props;
  // Subscribe to title changes — dockview can update the title at
  // runtime via api.setTitle() so we mirror that into local state.
  const [title, setTitle] = React.useState<string>(api.title ?? "");
  React.useEffect(() => {
    setTitle(api.title ?? "");
    const sub = api.onDidTitleChange((e) => setTitle(e.title ?? ""));
    return () => sub.dispose();
  }, [api]);

  // The workspace panel renders a minimal grip-only handle instead of
  // the full icon + title + chevron chrome. The rail itself IS the
  // workspace's content; the tab area just needs to be a grabbable
  // strip the user drags to relocate the rail. We pick the grip
  // orientation based on the tab strip's current edge (bottom = horiz
  // grip; right = vertical grip) by sniffing the parent group's
  // header-position class.
  if (api.id === "workspace") {
    return <WorkspaceDragHandle />;
  }

  const params = (props.params ?? {}) as DockPanelHeaderParams;
  const ornaments = React.useContext(DockPanelHeaderOrnamentsContext);
  const own = ornaments[api.id] ?? {};
  const icon = own.icon ?? null;
  const controls = own.controls ?? null;
  const showChevron = !controls && !params.hideTrailingChevron;

  return (
    <div
      className={cn(
        // Header bar geometry — full height of dockview's tab strip.
        "dock-panel-header h-full w-full",
        "flex items-center gap-2",
        "px-4",
        "bg-(--color-bg-card-elev)",
        "text-(--color-fg-secondary)",
        "text-[11px] font-medium uppercase tracking-wider",
        // Subtle bottom rule separates the header from the panel
        // body. dockview already paints a `.dv-tab-divider-color`
        // line between tabs in multi-panel mode; this is for the
        // bar's lower edge.
        "border-b border-(--color-border)",
        "select-none",
        "cursor-grab active:cursor-grabbing",
      )}
      data-dock-panel-header
      // Forward a couple of useful identifiers so the popout-gesture
      // layer can find the right panel from a pointer hit-test.
      data-panel-id={api.id}
    >
      {icon ? (
        <span className="dock-panel-header__icon flex h-4 w-4 items-center justify-center text-(--color-fg-muted)">
          {icon}
        </span>
      ) : null}
      <span className="dock-panel-header__title flex-1 truncate">{title}</span>
      {controls ? (
        <span className="dock-panel-header__controls flex items-center gap-1">
          {controls}
        </span>
      ) : null}
      {showChevron ? (
        <ChevronDown
          size={12}
          aria-hidden
          className="dock-panel-header__chevron text-(--color-fg-muted)"
        />
      ) : null}
    </div>
  );
}

export default DockPanelHeader;

/**
 * WorkspaceDragHandle — minimal grip-only tab content for the workspace
 * panel. No icon, no title, no chevron — just a centred grip glyph
 * that reads as "grab me to move the rail". The surrounding tab
 * element is still a full dockview tab so native drag-to-relocate
 * works; we're only replacing what's painted inside.
 *
 * Orientation: dockview sets `dv-groupview-header-bottom` /
 * `-right` / `-top` / `-left` on the ancestor `.dv-groupview`. We
 * inspect the rendered tab element's ancestor on mount to pick a
 * horizontal grip (when the tab strip is at the top or bottom of the
 * rail) or a vertical grip (when at left or right). A MutationObserver
 * watches for headerPosition changes so the glyph flips along with
 * the live layout.
 */
function WorkspaceDragHandle(): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [horizontal, setHorizontal] = React.useState(true);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const group = el.closest(".dv-groupview") as HTMLElement | null;
    if (!group) return;
    const evaluate = () => {
      const cls = group.className;
      // tab strip at top/bottom of the rail = horizontal grip
      const isHorizontalStrip =
        cls.includes("dv-groupview-header-bottom") ||
        cls.includes("dv-groupview-header-top");
      setHorizontal(isHorizontalStrip);
    };
    evaluate();
    const mo = new MutationObserver(evaluate);
    mo.observe(group, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const Grip = horizontal ? GripHorizontal : GripVertical;
  return (
    <div
      ref={ref}
      data-dock-panel-header
      data-panel-id="workspace"
      className={cn(
        "flex h-full w-full items-center justify-center",
        "text-(--color-fg-muted) hover:text-(--color-fg-primary)",
        "cursor-grab active:cursor-grabbing",
        "select-none",
      )}
      title="Drag to move workspace"
    >
      <Grip size={14} aria-hidden />
    </div>
  );
}
