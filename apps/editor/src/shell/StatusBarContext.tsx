import React from "react";
import type { StatusBarSection } from "../components/ui/StatusBar";

/**
 * StatusBarContext — drives the global app StatusBar from per-view
 * code, VSCode-style.
 *
 * Pattern:
 *   - The shell (R3) renders `<StatusBarProvider><App/></StatusBarProvider>`.
 *   - Each view calls `useStatusBar()` and pushes its sections via
 *     `setSections(...)`. On unmount the sections are cleared.
 *   - The shell reads `useStatusBarSections()` and renders them inside
 *     the `<StatusBar/>` primitive.
 *
 * R2 ships the context + hook + provider so views authored in R4 can
 * rely on the API while R3 wires the shell consumer side.
 */

interface StatusBarStore {
  /** Currently-pushed sections, in render order. */
  sections: ReadonlyArray<StatusBarSection>;
  /** Replace the entire set of sections (typically called from the
   *  active view's `useEffect`). */
  setSections: (next: ReadonlyArray<StatusBarSection>) => void;
}

const StatusBarContext = React.createContext<StatusBarStore | null>(null);

export interface StatusBarProviderProps {
  children: React.ReactNode;
}

export function StatusBarProvider({ children }: StatusBarProviderProps) {
  const [sections, setSections] = React.useState<ReadonlyArray<StatusBarSection>>(
    [],
  );
  const store = React.useMemo<StatusBarStore>(
    () => ({ sections, setSections }),
    [sections],
  );
  return (
    <StatusBarContext.Provider value={store}>
      {children}
    </StatusBarContext.Provider>
  );
}

/**
 * Hook used by views to push their status-bar sections. Calling it
 * with an empty array (or letting the component unmount) restores the
 * status bar to its empty default.
 */
export function useStatusBar(): StatusBarStore {
  const ctx = React.useContext(StatusBarContext);
  if (!ctx) {
    throw new Error(
      "useStatusBar() called outside <StatusBarProvider>. " +
        "Mount the provider at the app shell root.",
    );
  }
  return ctx;
}

/**
 * Convenience hook for the shell — reads the current sections out of
 * the context. Always returns an array (empty when no view has
 * pushed).
 */
export function useStatusBarSections(): ReadonlyArray<StatusBarSection> {
  return useStatusBar().sections;
}
