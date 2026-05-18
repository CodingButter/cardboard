import React from "react";
import type { DockviewApi, IDockviewPanelProps } from "dockview";
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
 * WorkspacePanel — the workspace rail (v1.5).
 *
 * No longer pinned: workspace is a regular dockview panel — closable,
 * popoutable, splitter-resizable. The rail still starts at 48px wide
 * via `initialWidth` in `ensureWorkspace`, and the auto-restore safety
 * net + TopBar "Show Workspace" button bring it back if the user
 * closes it.
 *
 * Rail contents (top→bottom vertical / left→right horizontal):
 *   1. Layouts button   → opens LayoutsModal
 *   2. Docks button     → opens DocksModal
 *   3. Reset Layout     → clears saved layout + re-applies default
 *   4. Flex spacer
 *   5. Settings cog     → page-specific settings modal (placeholder)
 *   6. Help             → page-specific help modal (placeholder)
 *
 * The dockview tab strip becomes the drag handle for the rail; its
 * position auto-flips between 'bottom' (vertical dock) and 'right'
 * (horizontal dock) — wired in DockShell.tsx via
 * `group.api.setHeaderPosition`.
 */

/** Params dockview passes through `panel.params`. String-only because
 *  params round-trip through saved-layout JSON. */
export interface WorkspacePanelParams {
  pageId: string;
  storageKey: string;
}

interface WorkspacePanelContext {
  api: DockviewApi | null;
  registry: readonly DockPanelDef[];
  apiRef: React.MutableRefObject<DockviewApi | null>;
}

export const WorkspacePanelContext = React.createContext<WorkspacePanelContext>(
  {
    api: null,
    registry: [],
    apiRef: { current: null },
  },
);

export const WORKSPACE_PANEL_ID = "workspace";

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

export function WorkspacePanel(
  props: IDockviewPanelProps,
): React.JSX.Element {
  const params = (props.params ?? {}) as Partial<WorkspacePanelParams>;
  const pageId = params.pageId ?? "default";
  const storageKey = params.storageKey ?? "";

  const ctx = React.useContext(WorkspacePanelContext);
  const { apiRef, registry } = ctx;

  const setDockLayout = useWorkspaceStore((s) => s.setDockLayout);

  // Modal state — only one open at a time.
  const [layoutsOpen, setLayoutsOpen] = React.useState(false);
  const [docksOpen, setDocksOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement | null>(null);

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
    <div
      ref={rootRef}
      className={cn(
        "workspace-rail",
        // The `@container size` CSS in design-system.css picks up
        // both axes from this element. flex-col is the default; the
        // landscape @container query flips it to flex-row.
        "h-full w-full bg-(--color-bg-panel)",
      )}
      data-workspace-panel
    >
      <div className="workspace-rail-stack flex flex-col items-center">
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

        {/* Flex spacer — pushes settings + help to the opposite end.
         *  The container-query CSS swaps flex-direction for
         *  landscape mode; flex-1 spacer works on either axis. */}
        <div className="workspace-rail-spacer flex-1" aria-hidden />

        <RailIconButton
          icon={<Settings />}
          label="Scene settings"
          onClick={() => setSettingsOpen(true)}
          active={settingsOpen}
        />
        <RailIconButton
          icon={<CircleHelp />}
          label="Scene help"
          onClick={() => setHelpOpen(true)}
          active={helpOpen}
        />
      </div>

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
        title="Scene settings"
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
        title="Scene help"
        description="Coming soon."
        width="md"
      >
        <p className="text-sm text-(--color-fg-secondary)">
          Page-specific help will live here.
        </p>
      </Modal>
    </div>
  );
}

/** Lucide icon used for the workspace panel header (tab strip). */
export const WorkspacePanelIcon = LayoutDashboard;

export default WorkspacePanel;
