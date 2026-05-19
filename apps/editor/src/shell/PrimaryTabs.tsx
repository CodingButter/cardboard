import React from "react";
import {
  Home,
  Grid3x3,
  Boxes,
  Blocks,
  Image as ImageIcon,
  Code2,
  Film,
  Palette,
  AudioLines,
  LayoutPanelTop,
  Package,
} from "lucide-react";
import { TabStrip, type TabDescriptor } from "../components/ui/TabStrip";
import { useTabContextSlotValue } from "../lib/tabContextSlot";

/**
 * PrimaryTabs — the 11-tab horizontal strip below the TopBar.
 *
 * Tab list: Home / Scene / Prefabs / Components / Assets / Scripts /
 * Animation / Image Lab / Sound Lab / UI Builder / Project. (Scene =
 * the legacy "Map" tab renamed; Prefabs = the legacy "Entities" tab
 * renamed — see EDITOR_REDESIGN.md §6.3 + §12 Q4. Components is the
 * sister-to-Prefabs Component Builder — see
 * docs/EDITOR_DESIGN_INVENTORY.md §1.)
 *
 * The active tab is persisted to localStorage under `editor.workflowMode`
 * so a tab reload lands the user back where they were. Keys are
 * cardboard-specific so they don't collide with other tools in the
 * browser profile.
 *
 * Tabs without a real implementation (Assets, Image Lab, Sound Lab,
 * UI Builder) are still selectable; the shell's body region renders an
 * EmptyState placeholder for them — they get real content in R4.
 *
 * Keyboard nav: when focus is on a tab button, ←/→ moves selection
 * between non-disabled tabs.
 */

export type PrimaryTabId =
  | "home"
  | "scene"
  | "prefabs"
  | "components"
  | "assets"
  | "scripts"
  | "animation"
  | "imageLab"
  | "soundLab"
  | "uiBuilder"
  | "project";

export const PRIMARY_TAB_ORDER: ReadonlyArray<PrimaryTabId> = [
  "home",
  "scene",
  "prefabs",
  "components",
  "assets",
  "scripts",
  "animation",
  "imageLab",
  "soundLab",
  "uiBuilder",
  "project",
];

/**
 * Canonical labels and icon assignments. Icons are 16px Lucide
 * glyphs — they match the §6.3 spec (Home/Grid3X3/Cuboid/ImageIcon/
 * Code2/Film/Package) where lucide-react has a direct equivalent, and
 * use the closest substitute otherwise (Boxes for "Cuboid"; Palette
 * for Image Lab, AudioLines for Sound Lab, LayoutPanelTop for UI
 * Builder — all new tabs added in §12 Q4).
 */
export const PRIMARY_TABS: ReadonlyArray<{
  id: PrimaryTabId;
  label: string;
  icon: React.ReactNode;
  /** Whether this tab requires an open project to be useful. */
  requiresProject: boolean;
  /** 1-sentence description shown as the stage-2 progressive tooltip
   *  body (after ~5s hover). The tab's `label` doubles as the stage-1
   *  label. Keep these short — they're surfaced inline, not in a docs
   *  drawer. */
  description: string;
}> = [
  {
    id: "home",
    label: "Home",
    icon: <Home size={16} />,
    requiresProject: false,
    description: "Recent projects, import / create new.",
  },
  {
    id: "scene",
    label: "Scene",
    icon: <Grid3x3 size={16} />,
    requiresProject: true,
    description: "Top-down 2D editor for cell layout, tiles, lighting.",
  },
  {
    id: "prefabs",
    label: "Prefabs",
    icon: <Boxes size={16} />,
    requiresProject: true,
    description: "Entity prefab library — enemies, items, triggers, decor.",
  },
  {
    id: "components",
    label: "Components",
    icon: <Blocks size={16} />,
    requiresProject: true,
    description: "Reusable scene-graph components.",
  },
  {
    id: "assets",
    label: "Assets",
    icon: <ImageIcon size={16} />,
    requiresProject: true,
    description: "Project asset browser — textures, sounds, music, scripts.",
  },
  {
    id: "scripts",
    label: "Scripts",
    icon: <Code2 size={16} />,
    requiresProject: true,
    description: "Game scripting editor — TypeScript / Lua / JS.",
  },
  {
    id: "animation",
    label: "Animation",
    icon: <Film size={16} />,
    requiresProject: true,
    description: "Sprite + entity animation timeline.",
  },
  {
    id: "imageLab",
    label: "Image Lab",
    icon: <Palette size={16} />,
    requiresProject: true,
    description: "Built-in pixel painter / image utility.",
  },
  {
    id: "soundLab",
    label: "Sound Lab",
    icon: <AudioLines size={16} />,
    requiresProject: true,
    description: "Built-in audio editor / chiptune utility.",
  },
  {
    id: "uiBuilder",
    label: "UI Builder",
    icon: <LayoutPanelTop size={16} />,
    requiresProject: true,
    description: "Game HUD + menu layout editor.",
  },
  {
    id: "project",
    label: "Project",
    icon: <Package size={16} />,
    requiresProject: true,
    description: "Project-level settings — manifest, pack chain, build targets.",
  },
];

const WORKFLOW_MODE_KEY = "editor.workflowMode";

/** Legacy → current tab-id migrations. Map → Scene and Entities →
 *  Prefabs were renamed; existing persisted state still references
 *  the old strings. Migrating on read keeps the next-session default
 *  working without forcing the user back to Home. */
const LEGACY_TAB_ID_MIGRATIONS: Record<string, PrimaryTabId> = {
  map: "scene",
  entities: "prefabs",
};

export function readPersistedTab(): PrimaryTabId | null {
  try {
    const raw = localStorage.getItem(WORKFLOW_MODE_KEY);
    if (!raw) return null;
    const migrated = LEGACY_TAB_ID_MIGRATIONS[raw];
    if (migrated) {
      // Rewrite the persisted value in place so we only migrate once.
      try {
        localStorage.setItem(WORKFLOW_MODE_KEY, migrated);
      } catch {
        // ignore
      }
      return migrated;
    }
    if ((PRIMARY_TAB_ORDER as ReadonlyArray<string>).includes(raw)) {
      return raw as PrimaryTabId;
    }
  } catch {
    // localStorage may throw in sandboxed contexts. Fall through.
  }
  return null;
}

export function writePersistedTab(id: PrimaryTabId): void {
  try {
    localStorage.setItem(WORKFLOW_MODE_KEY, id);
  } catch {
    // Persisting is best-effort.
  }
}

export interface PrimaryTabsProps {
  value: PrimaryTabId;
  onChange: (next: PrimaryTabId) => void;
  /** When false, all tabs except `home` are disabled (no project open). */
  hasProject: boolean;
  className?: string;
}

export function PrimaryTabs({
  value,
  onChange,
  hasProject,
  className,
}: PrimaryTabsProps) {
  const tabs: ReadonlyArray<TabDescriptor<PrimaryTabId>> = React.useMemo(
    () =>
      PRIMARY_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        icon: t.icon,
        disabled: t.requiresProject && !hasProject,
        // Visual category dividers (no labels):
        //   [home, scene, prefabs, components] | [assets, scripts,
        //   animation, imageLab, soundLab, uiBuilder] | [project]
        dividerAfter: t.id === "components" || t.id === "uiBuilder",
        // Progressive tooltip wiring — TabStrip wraps each button in a
        // <Tooltip stages={...}/> when these are present.
        tooltipLabel: t.label,
        tooltipDescription: t.description,
      })),
    [hasProject],
  );

  // Keyboard nav: ←/→ on the tablist moves selection between enabled
  // tabs. Mirrors the WAI-ARIA Authoring Practices tabs pattern.
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const enabled = tabs.filter((t) => !t.disabled);
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((t) => t.id === value);
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = (idx + delta + enabled.length) % enabled.length;
      const target = enabled[nextIdx];
      if (target) onChange(target.id);
    },
    [tabs, value, onChange],
  );

  // The active view registers what (if anything) shows at the right
  // edge of the tab strip via `useTabContextSlot` from `lib/tabContextSlot`.
  // Reading the value here keeps the slot in sync with whatever the
  // currently-mounted view installs. When no view registers content
  // the value is null and TabStrip renders the strip without a right
  // slot.
  const rightSlot = useTabContextSlotValue();

  return (
    <div onKeyDown={onKeyDown} className={className}>
      <TabStrip<PrimaryTabId>
        variant="primary"
        tabs={tabs}
        value={value}
        onChange={onChange}
        aria-label="Editor workflow"
        rightSlot={rightSlot}
        scrollable
      />
    </div>
  );
}
