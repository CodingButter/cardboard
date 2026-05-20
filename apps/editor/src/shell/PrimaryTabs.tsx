import React from "react";
import { TabStrip, type TabDescriptor } from "../components/ui/TabStrip";
import { useTabContextSlotValue } from "../lib/tabContextSlot";
import { useRegisteredTabs } from "../state/useTabRegistryStore";

/**
 * PrimaryTabs — the top-of-shell horizontal tab strip.
 *
 * Pre-P4 this file declared a hardcoded `PRIMARY_TABS` array. Post-P4
 * (CORE_EDITOR_PACK.md §10) the array is fully pack-contributed —
 * `useRegisteredTabs()` reads from `useTabRegistryStore`, which the
 * core-editor-pack populates via `ctx.registerTab(...)` calls in its
 * `scripts/setup.tsx`. A bare shell with no editor packs installed
 * renders an empty strip (no tabs to render = no chrome above the
 * body region).
 *
 * The active tab is persisted to localStorage under `editor.workflowMode`
 * so a tab reload lands the user back where they were. Keys are
 * cardboard-specific so they don't collide with other tools in the
 * browser profile.
 *
 * Keyboard nav: when focus is on a tab button, ←/→ moves selection
 * between non-disabled tabs.
 */

/**
 * Tab id type — narrows to whatever ids the registered tabs ship with.
 * Kept as a `string` alias so the runtime is fully dynamic — the
 * shell no longer enumerates a closed union of valid ids. Pack
 * authors are free to ship any id; the shell narrows on string
 * equality when routing.
 */
export type PrimaryTabId = string;

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
    return raw;
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
  /** When false, all tabs that declared `requiresProject: true` are
   *  disabled. */
  hasProject: boolean;
  className?: string;
}

export function PrimaryTabs({
  value,
  onChange,
  hasProject,
  className,
}: PrimaryTabsProps) {
  const registered = useRegisteredTabs();

  const tabs: ReadonlyArray<TabDescriptor<PrimaryTabId>> = React.useMemo(
    () =>
      registered.map((t) => ({
        id: t.id,
        label: t.label,
        icon: t.icon,
        disabled: t.requiresProject && !hasProject,
        dividerAfter: t.dividerAfter,
        // Progressive tooltip wiring — TabStrip wraps each button in a
        // <Tooltip stages={...}/> when these are present.
        tooltipLabel: t.label,
        tooltipDescription: t.description,
      })),
    [registered, hasProject],
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
