import React from "react";
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
 * Header shape:
 *   - 22px bar (driven by --dv-tabs-and-actions-container-height)
 *   - transparent background — inherits the panel body colour so the
 *     header reads as a thin drag handle, not a contrasting bar
 *   - small-caps uppercase title, text-[11px] tracking-wider
 *   - optional right controls slot (params.controls — a node) for
 *     inline filter chips, dropdowns, etc. Nothing rendered when
 *     absent (no placeholder chevron — non-functional UI was
 *     confusing users).
 *   - clicking-and-dragging the bar still feeds dockview's native
 *     reorder/split/popout machinery (dockview attaches its DnD
 *     listeners to the element this component renders).
 */

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

  const ornaments = React.useContext(DockPanelHeaderOrnamentsContext);
  const own = ornaments[api.id] ?? {};
  // Per-panel icons are intentionally NOT rendered in the dock tab
  // strip — the title alone identifies the panel. The MANIFEST.icon
  // field is still consumed by DocksModal (panel-discovery card grid).
  const controls = own.controls ?? null;

  return (
    <div
      className={cn(
        // Header bar geometry — full height of dockview's tab strip
        // (driven by --dv-tabs-and-actions-container-height, currently
        // 22px). No own background or bottom rule — inherits the
        // panel-body colour and reads as a thin drag handle. Panel
        // content paints its own surfaces (cards / sections) so the
        // header doesn't need a separator from the body.
        "dock-panel-header h-full w-full",
        "flex items-center gap-2",
        "px-3",
        "text-(--color-fg-secondary)",
        "text-[11px] font-medium uppercase tracking-wider",
        "select-none",
        "cursor-grab active:cursor-grabbing",
      )}
      data-dock-panel-header
      // Forward a couple of useful identifiers so the popout-gesture
      // layer can find the right panel from a pointer hit-test.
      data-panel-id={api.id}
    >
      <span className="dock-panel-header__title flex-1 truncate">{title}</span>
      {controls ? (
        <span className="dock-panel-header__controls flex items-center gap-1">
          {controls}
        </span>
      ) : null}
    </div>
  );
}

export default DockPanelHeader;
