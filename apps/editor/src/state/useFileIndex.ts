import { create } from "zustand";

/**
 * useFileIndex — lightweight mirror of the active project's asset list.
 *
 * EditorShell populates this from `EditorProjectStore.listAssets` on
 * project change. The command palette's "file mode" reads from here so
 * it doesn't need to re-fetch assets every time the user types.
 *
 * Not persisted — the source of truth is the IDB-backed project store;
 * this is a fast in-memory view of it that updates as the user creates
 * / renames / deletes assets.
 */

export type FileIndexEntryKind =
  | "scene"
  | "script"
  | "texture"
  | "sprite"
  | "sound"
  | "manifest"
  | "other";

export interface FileIndexEntry {
  id: string;
  path: string;
  type: FileIndexEntryKind;
}

export interface FileIndexState {
  files: FileIndexEntry[];
  setFiles: (files: FileIndexEntry[]) => void;
  clear: () => void;
}

export const useFileIndex = create<FileIndexState>()((set) => ({
  files: [],
  setFiles: (files) => set({ files }),
  clear: () => set({ files: [] }),
}));

/**
 * Classify an asset path into a `FileIndexEntryKind`. Heuristics mirror
 * the editor's existing folder layout (scenes/, scripts/, sprites/,
 * textures/, sounds/, manifest.json).
 */
export function classifyAssetPath(path: string): FileIndexEntryKind {
  if (path === "manifest.json") return "manifest";
  if (path.startsWith("scenes/")) return "scene";
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("sprites/")) return "sprite";
  if (path.startsWith("textures/")) return "texture";
  if (path.startsWith("sounds/")) return "sound";
  return "other";
}
