import React from "react";
import type { DockviewApi } from "dockview";
import {
  RotateCcw,
  Boxes,
  LayoutDashboard,
  Settings,
  CircleHelp,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspaceStore } from "../../state/useWorkspaceStore";
import { Modal } from "../ui/Modal";
import { LayoutsModal } from "./LayoutsModal";
import { DocksModal } from "./DocksModal";
import type { DockPanelDef } from "./DockShell";

/**
 * WorkspaceRail — a fixed 40px-wide vertical rail that sits to the
 * LEFT of the page's DockShell.
 *
 * We previously tried to host the rail as a dockview panel so the user
 * could move it, resize it, dock it horizontally, pop it out, etc.
 * Every flavour of that hit dockview's gridview enforcing different
 * constraints than ours, layout-change feedback loops, and orientation
 * snap problems that fought the splitter on every drag. The rail is
 * fundamentally page chrome — not a panel — and trying to model it
 * inside the docking system was wrong.
 *
 * New shape: a plain React component the page renders alongside
 * `<DockShell/>` as a sibling. No drag handle, no resize splitter, no
 * popout. The rail's children stay the same:
 *   1. Layouts button   → opens LayoutsModal
 *   2. Docks button     → opens DocksModal
 *   3. Reset Layout     → clears saved layout for this page
 *   4. Flex spacer
 *   5. Settings cog     → page-specific settings (placeholder)
 *   6. Help             → page-specific help (placeholder)
 *
 * Pages mount the rail with the same `apiRef` they hand to `DockShell`
 * so the modals can call `api.fromJSON / api.addPanel / api.toJSON`
 * against the live dockview instance.
 */

export interface WorkspaceRailProps {
  /** Page identifier — scopes the layout-presets slice in
   *  `useWorkspaceStore` and routes the predefined layout registry. */
  pageId: string;
  /** localStorage key dockview-layout persistence uses for this
   *  page. Reset Layout clears this entry. */
  storageKey: string;
  /** Same DockviewApi ref passed to the sibling DockShell. The
   *  LayoutsModal calls api.fromJSON/toJSON against this; the
   *  DocksModal calls api.addPanel against this. */
  apiRef: React.MutableRefObject<DockviewApi | null>;
  /** Panel registry exposed to the DocksModal so it can list every
   *  panel available on the page and route drag-source / addPanel
   *  calls through it. */
  registry: readonly DockPanelDef[];
}

interface RailIconButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

/**
 * Shared rail icon button — glyph-only target, no chip background.
 *
 * Per `Editor Design/Map.png`:
 *   - Idle  : muted fg, transparent
 *   - Hover : brighter fg, no bg change
 *   - Active: amber (--color-accent), no bg change
 *   - Focus : keyboard ring only (no chip surface)
 *   - Size  : 36x36 hit target with the lucide glyph centered
 */
function RailIconButton({
  icon,
  label,
  onClick,
  active,
}: RailIconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-active={active ? "true" : "false"}
      className={cn(
        "workspace-rail-icon",
        "h-9 w-9 inline-flex items-center justify-center rounded",
        "bg-transparent border border-transparent",
        active
          ? "text-(--color-accent)"
          : "text-(--color-fg-muted) hover:text-(--color-fg-primary)",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60",
        "transition-colors",
      )}
    >
      <span className="flex items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </span>
    </button>
  );
}

export function WorkspaceRail({
  pageId,
  storageKey,
  apiRef,
  registry,
}: WorkspaceRailProps): React.JSX.Element {
  const setDockLayout = useWorkspaceStore((s) => s.setDockLayout);

  // Modal state — only one open at a time.
  const [layoutsOpen, setLayoutsOpen] = React.useState(false);
  const [docksOpen, setDocksOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const onResetLayout = () => {
    if (!storageKey) return;
    setDockLayout(storageKey, null);
    window.dispatchEvent(
      new CustomEvent("cardboard:reset-workspace", {
        detail: { storageKey },
      }),
    );
  };

  return (
    <aside
      className={cn(
        // Fixed 40px column. shrink-0 so neighbouring flex children
        // can't shave any pixels off. The rail isn't draggable, isn't
        // resizable, isn't popoutable — it's page chrome.
        "shrink-0 w-10 h-full",
        "flex flex-col items-center gap-1",
        "py-1.5 bg-(--color-bg-panel)",
        "border-r border-(--color-border)",
      )}
      aria-label="Workspace"
    >
      <RailIconButton
        icon={<LayoutDashboard />}
        label="Layouts"
        onClick={() => setLayoutsOpen(true)}
        active={layoutsOpen}
      />
      <RailIconButton
        icon={<Boxes />}
        label="Docks"
        onClick={() => setDocksOpen(true)}
        active={docksOpen}
      />
      <RailIconButton
        icon={<RotateCcw />}
        label="Reset Layout"
        onClick={onResetLayout}
      />

      <div className="flex-1" aria-hidden />

      <RailIconButton
        icon={<Settings />}
        label="Page settings"
        onClick={() => setSettingsOpen(true)}
        active={settingsOpen}
      />
      <RailIconButton
        icon={<CircleHelp />}
        label="Page help"
        onClick={() => setHelpOpen(true)}
        active={helpOpen}
      />

      <LayoutsModal
        open={layoutsOpen}
        onClose={() => setLayoutsOpen(false)}
        pageId={pageId}
        apiRef={apiRef}
      />
      <DocksModal
        open={docksOpen}
        onClose={() => setDocksOpen(false)}
        registry={registry}
        apiRef={apiRef}
      />

      {/* Placeholder modals — Settings + Help are page-specific and
       *  will be wired into a real page-settings system later. */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Page settings"
        description="Coming soon."
        width="md"
      >
        <p className="text-sm text-(--color-fg-secondary)">
          Page-specific settings will live here.
        </p>
      </Modal>
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Page help"
        description="Coming soon."
        width="md"
      >
        <p className="text-sm text-(--color-fg-secondary)">
          Page-specific help will live here.
        </p>
      </Modal>
    </aside>
  );
}

export default WorkspaceRail;
