import React from "react";
import { useRoute } from "./lib/router";
import { HomeScreen } from "./views/HomeScreen";
import { ProjectView } from "./views/ProjectView";

/**
 * Editor shell — a tiny 2-route app driven by `useRoute()`.
 *
 *   `#/`            → HomeScreen
 *   `#/p/<id>`      → ProjectView
 *
 * Avoids `react-router`: this is E1, two views, no nested routes.
 * The hash sync gives us refresh-stable project URLs for free.
 */
export function App() {
  const [route, navigate] = useRoute();

  if (route.view === "project") {
    return (
      <ProjectView
        key={route.projectId}
        projectId={route.projectId}
        onBackHome={() => navigate("#/")}
      />
    );
  }

  return <HomeScreen onOpenProject={(id) => navigate(`#/p/${id}`)} />;
}
