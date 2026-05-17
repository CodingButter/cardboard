import React from "react";

/**
 * ActiveSceneContext — shell-level shared state for the currently
 * active scene path.
 *
 * Pattern (mirrors `StatusBarContext` and `EditorActionsContext`):
 *   - The shell renders `<ActiveSceneProvider><App/></ActiveSceneProvider>`
 *     alongside the other shell providers.
 *   - The TopBar's scene dropdown reads `activeScene` from context and
 *     calls `setActiveScene(...)` on selection.
 *   - ProjectView (and any other workflow view) reads the same context
 *     so picking a scene in the TopBar drives the viewport, and any
 *     view-driven scene switch reflects back in the dropdown.
 *   - Selection is persisted per-project under
 *     `cardboard_editor_active_scene_<projectId>` so it survives reloads
 *     and (via the storage event) cross-tab navigation.
 *
 * R4b wires this end-to-end. Before R4b the TopBar wrote to the same
 * localStorage key but ProjectView ignored it, so the dropdown was
 * inert.
 */

interface ActiveSceneContextValue {
  /** Absolute scene path (e.g. `scenes/foo.json`) or null when no
   *  project is open / no scene resolved yet. */
  activeScene: string | null;
  /** Update the active scene. Pass null to clear. */
  setActiveScene: (scene: string | null) => void;
}

const ActiveSceneContext = React.createContext<ActiveSceneContextValue | null>(
  null,
);

export interface ActiveSceneProviderProps {
  /** Project id whose scene-selection key the provider should persist
   *  under. Pass null when no project is open — the provider will
   *  hold `activeScene` as null and ignore writes. */
  projectId: string | null;
  children: React.ReactNode;
}

function storageKeyFor(projectId: string): string {
  return `cardboard_editor_active_scene_${projectId}`;
}

export function ActiveSceneProvider({
  projectId,
  children,
}: ActiveSceneProviderProps) {
  // Hydrate from localStorage when the project changes. We use a lazy
  // initial-state callback so the very first render already reflects
  // the persisted value (avoids a flash of "no scene").
  const [activeScene, setActiveSceneState] = React.useState<string | null>(
    () => {
      if (!projectId) return null;
      try {
        return localStorage.getItem(storageKeyFor(projectId));
      } catch {
        return null;
      }
    },
  );

  // Re-hydrate whenever the project changes (e.g. user picks a
  // different project from the TopBar project dropdown). Without this
  // the provider would hold the previous project's scene path.
  React.useEffect(() => {
    if (!projectId) {
      setActiveSceneState(null);
      return;
    }
    try {
      setActiveSceneState(localStorage.getItem(storageKeyFor(projectId)));
    } catch {
      setActiveSceneState(null);
    }
  }, [projectId]);

  // Cross-tab sync: the `storage` event fires in OTHER tabs when this
  // tab writes localStorage. Same-tab updates happen via setActiveScene
  // directly (the synthetic StorageEvent the spec defines only fires
  // cross-tab).
  React.useEffect(() => {
    if (!projectId) return;
    const key = storageKeyFor(projectId);
    function onStorage(e: StorageEvent) {
      if (e.key !== key) return;
      setActiveSceneState(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  const setActiveScene = React.useCallback(
    (scene: string | null) => {
      setActiveSceneState(scene);
      if (!projectId) return;
      try {
        const key = storageKeyFor(projectId);
        if (scene === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, scene);
        }
      } catch {
        // ignore — same as StatusBarContext, persistence is best-effort
      }
    },
    [projectId],
  );

  const value = React.useMemo<ActiveSceneContextValue>(
    () => ({ activeScene, setActiveScene }),
    [activeScene, setActiveScene],
  );

  return (
    <ActiveSceneContext.Provider value={value}>
      {children}
    </ActiveSceneContext.Provider>
  );
}

/**
 * Hook for views/TopBar to read/write the currently-active scene.
 * Throws if called outside `<ActiveSceneProvider/>` so misuse fails
 * loudly rather than silently no-oping.
 */
export function useActiveScene(): ActiveSceneContextValue {
  const ctx = React.useContext(ActiveSceneContext);
  if (!ctx) {
    throw new Error(
      "useActiveScene() called outside <ActiveSceneProvider>. " +
        "Mount the provider at the app shell root.",
    );
  }
  return ctx;
}
