import React from "react";

/**
 * Placeholder editor shell.
 *
 * Three-column layout (scene tree | viewport | future inspector) — just
 * the visual scaffold. No editor logic yet; see `apps/editor/README.md`.
 *
 * Colors mirror the game's settings modal palette (zinc-950 / zinc-900 /
 * zinc-800 with amber accents) for visual continuity.
 */
export function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          <span className="text-amber-400">two_5_d</span> editor
        </h1>
        <p className="text-zinc-400 mt-2">
          Browser-based level editor — placeholder scaffold.
        </p>
      </header>
      <main className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="font-semibold mb-2">Scene tree</h2>
          <p className="text-sm text-zinc-500">Coming soon</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 col-span-2">
          <h2 className="font-semibold mb-2">Viewport</h2>
          <p className="text-sm text-zinc-500">
            Live-test the engine here
          </p>
        </div>
      </main>
    </div>
  );
}
