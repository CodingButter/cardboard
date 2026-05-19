import { createSyncedStore } from "./sync";

/**
 * useToolStore — the editor's active tool selection.
 *
 * Wave 3 cross-panel store. The ToolPalette writes here when the user
 * picks a tool; MapCanvas (and any other panel that needs to know what
 * tool is active) reads from here. Sub-tool selection is kept per-tool
 * so picking "select-polygon" while the parent tool is "select" doesn't
 * leak into the "paint" tool's sub-tool state.
 *
 * `activeMode` is the high-level editor mode (map / preview / etc.) —
 * orthogonal to the active tool. Some tools are only meaningful in
 * certain modes; panels can hide themselves based on this value.
 *
 * Persistence: localStorage under `cardboard.sync.tool`. Cross-window
 * propagation via the storage event — no BroadcastChannel since tool
 * changes are infrequent and storage events suffice.
 */

export interface ToolStateData {
  activeTool: string;
  /** Per-tool selected sub-tool. Keyed by parent tool id. */
  activeSubTool: Record<string, string>;
  activeMode: string;
}

export interface ToolStateActions {
  setActiveTool: (id: string) => void;
  setActiveSubTool: (toolId: string, subId: string) => void;
  setActiveMode: (mode: string) => void;
}

export type ToolState = ToolStateData & ToolStateActions;

const INITIAL: ToolStateData = {
  activeTool: "select",
  activeSubTool: {},
  activeMode: "map",
};

export const useToolStore = createSyncedStore<ToolStateData, ToolStateActions>(
  "tool",
  INITIAL,
  (set) => ({
    setActiveTool: (id) => set({ activeTool: id }),
    setActiveSubTool: (toolId, subId) =>
      set((s) => ({ activeSubTool: { ...s.activeSubTool, [toolId]: subId } })),
    setActiveMode: (mode) => set({ activeMode: mode }),
  }),
  {
    enableBroadcast: false,
  },
);

/** Non-React getter for imperative call sites (commands, event handlers). */
export function getToolState(): ToolState {
  return useToolStore.getState();
}
