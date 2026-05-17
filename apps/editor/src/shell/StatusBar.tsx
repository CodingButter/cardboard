import React from "react";
import { StatusBar as StatusBarStrip } from "../components/ui/StatusBar";
import type { StatusBarSection } from "../components/ui/StatusBar";
import { useStatusBarSections } from "./StatusBarContext";

/**
 * Shell-level StatusBar — subscribes to `StatusBarContext` and renders
 * whatever sections the currently-mounted view has pushed.
 *
 * Falls back to a small static section set (app name + project name)
 * when no view has pushed sections. R4 views populate the real content
 * (cell coords, frame counters, build status, etc.) via
 * `useStatusBar()` inside their own components.
 */

export interface ShellStatusBarProps {
  /** Currently-open project name. Surfaced as the left-most static
   *  section when no view has pushed status info. */
  projectName?: string;
  className?: string;
}

const APP_LABEL = "Cardboard";

export function StatusBar({ projectName, className }: ShellStatusBarProps) {
  const viewSections = useStatusBarSections();

  const sections = React.useMemo<ReadonlyArray<StatusBarSection>>(() => {
    if (viewSections.length > 0) return viewSections;
    // Static fallback. Keep it small — the bar is 32px tall and
    // crowding it makes the editor feel noisy when there's nothing
    // to say.
    const fallback: StatusBarSection[] = [
      { id: "app", label: "App", value: APP_LABEL },
    ];
    if (projectName) {
      fallback.push({ id: "project", label: "Project", value: projectName });
    }
    return fallback;
  }, [viewSections, projectName]);

  return <StatusBarStrip sections={sections} className={className} />;
}
