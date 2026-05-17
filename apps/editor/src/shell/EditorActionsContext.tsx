import React from "react";

/**
 * EditorActionsContext — drives the shell TopBar's Save / Export /
 * Playtest buttons from per-view code.
 *
 * Pattern (mirrors StatusBarContext):
 *   - The shell renders `<EditorActionsProvider><App/></EditorActionsProvider>`
 *     directly below `<StatusBarProvider/>`.
 *   - Each view calls `useEditorActions()` and pushes its handler
 *     bundle via `register(...)` inside a `useEffect`. The returned
 *     function unregisters the bundle on unmount, restoring whatever
 *     bundle was active before (stack semantics).
 *   - The TopBar reads via `useEditorActionsState()` and renders each
 *     action button enabled iff the corresponding handler is present.
 *
 * Registration semantics — **stack with restore on unmount**:
 *   - `register(bundle)` pushes the bundle onto an internal stack and
 *     returns an `unregister` cleanup.
 *   - The "active" bundle (the one the TopBar sees) is always the top
 *     of the stack.
 *   - On unregister, the bundle is spliced out wherever it lives on
 *     the stack (so a slow async cleanup running after a sibling has
 *     already pushed its bundle does not pop the wrong entry).
 *
 * This means: mounting a new view replaces the active bundle, and
 * unmounting it restores the previous view's bundle automatically.
 * Multiple views can be mounted simultaneously (e.g. a future
 * floating panel) and the most recent wins.
 *
 * R3b ships this context. R4 sub-phases will migrate each view
 * (ProjectView, EntitiesEditor, AnimationEditor, …) to register real
 * Save / Export handlers. Until then a default Save handler in the
 * shell preserves the legacy synthetic-Ctrl+S behaviour.
 */

export interface EditorActions {
  /** Persist the current edit to the project store. */
  save?: () => Promise<void> | void;
  /** Export the pack to its distributable form (.apg, zip, …). */
  export?: () => Promise<void> | void;
  /** Start the in-editor playtest session (R4h). */
  playtestStart?: () => void;
  /** Stop the in-editor playtest session (R4h). */
  playtestStop?: () => void;
  /** Reset / re-run the current playtest from the start (R4h). */
  rerun?: () => void;
}

/** Opaque cleanup returned by `register`. Idempotent — calling twice
 *  is a no-op after the first call. */
export type UnregisterEditorActions = () => void;

interface EditorActionsStore {
  /** Currently-active bundle = top of the registration stack. Empty
   *  object when no view has registered. */
  actions: EditorActions;
  /** Push a new handler bundle onto the stack. Returns an
   *  `unregister` function that removes this exact bundle when called. */
  register: (actions: EditorActions) => UnregisterEditorActions;
}

const EditorActionsContext = React.createContext<EditorActionsStore | null>(
  null,
);

export interface EditorActionsProviderProps {
  children: React.ReactNode;
}

export function EditorActionsProvider({ children }: EditorActionsProviderProps) {
  // The stack lives in a ref so that `register` is a stable callback
  // identity (views depend on it inside `useEffect` deps). React state
  // mirrors only the active bundle, which is what consumers actually
  // render against.
  const stackRef = React.useRef<EditorActions[]>([]);
  const [active, setActive] = React.useState<EditorActions>({});

  const syncActive = React.useCallback(() => {
    const top = stackRef.current[stackRef.current.length - 1];
    setActive(top ?? {});
  }, []);

  const register = React.useCallback<EditorActionsStore["register"]>(
    (bundle) => {
      stackRef.current.push(bundle);
      syncActive();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const idx = stackRef.current.lastIndexOf(bundle);
        if (idx >= 0) stackRef.current.splice(idx, 1);
        syncActive();
      };
    },
    [syncActive],
  );

  const store = React.useMemo<EditorActionsStore>(
    () => ({ actions: active, register }),
    [active, register],
  );

  return (
    <EditorActionsContext.Provider value={store}>
      {children}
    </EditorActionsContext.Provider>
  );
}

/**
 * Hook used by views to register their action handlers.
 *
 * Typical usage:
 *
 *     const { register } = useEditorActions();
 *     useEffect(() => {
 *       return register({
 *         save: async () => { /* ... *\/ },
 *         export: async () => { /* ... *\/ },
 *       });
 *     }, [register]);
 */
export function useEditorActions(): EditorActionsStore {
  const ctx = React.useContext(EditorActionsContext);
  if (!ctx) {
    throw new Error(
      "useEditorActions() called outside <EditorActionsProvider>. " +
        "Mount the provider at the app shell root.",
    );
  }
  return ctx;
}

/**
 * Convenience hook for the shell — reads the currently-active handler
 * bundle out of the context. Always returns an object (empty when no
 * view has registered).
 */
export function useEditorActionsState(): EditorActions {
  return useEditorActions().actions;
}
