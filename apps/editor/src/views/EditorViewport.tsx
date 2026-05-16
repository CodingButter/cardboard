import React, { useEffect, useRef, useState } from "react";
import { Game } from "Game";
import { applyConfigOverride, CONFIG } from "GameConfig";
import { WebGLRenderer } from "Renderers";
import type { PartialGameConfig } from "Settings";
import { EditorAssetPack } from "../lib/EditorAssetPack";
import { cn } from "../lib/cn";
import { GridEditor, type MutableScene } from "./GridEditor";

/**
 * Live engine pane for the editor's project view.
 *
 * Mounts a `<canvas>`, builds an `EditorAssetPack` on top of the
 * project's IDB rows, then constructs the engine's `Game` against the
 * active scene. In Play mode this is the full engine (pointer lock +
 * WASD + mouse look). In Edit mode the live engine is torn down and
 * the 2D `GridEditor` takes over the same pane.
 *
 * E3 lifecycle:
 *   1. Play → Edit. Tear the engine down (`game.destroy()`), let the
 *      `<GridEditor>` mount. Pointer lock is released as a side effect.
 *   2. Edit → Play. If `dirty`, persist the in-memory scene JSON to
 *      IDB via `onPersistScene` first so the re-mounted engine boots
 *      against the edited scene.
 *
 * The viewport doesn't own the scene state any more — `ProjectView`
 * does. It also doesn't own `mode`; we expose it as a controlled prop
 * so the parent can re-use the same toggle from the header / save
 * indicator. The `Tab` keyboard binding still lives here because the
 * binding is meaningful only when the viewport is mounted.
 */
export type ViewportMode = "play" | "edit";

export interface EditorViewportProps {
  projectId: string;
  /** Path to the active scene; falls back to manifest.startScene. */
  sceneName?: string;
  /** Notify parent of the resolved scene so it can highlight the row. */
  onSceneResolved?: (path: string) => void;
  /** Controlled mode. */
  mode: ViewportMode;
  onModeChange: (mode: ViewportMode) => void;
  /** Edit-mode scene state. Owned by the parent so it can persist on
   *  Save and rebuild EditorAssetPack on Play. */
  editScene: MutableScene | null;
  editScenePath: string | null;
  onEditSceneChange: (next: MutableScene) => void;
  /** Persist the edited scene to IDB. Called by the viewport before it
   *  switches back to Play so the engine boots on the fresh bytes. */
  onPersistScene: () => Promise<void>;
}

interface EngineHandle {
  game: Game;
  pack: EditorAssetPack;
}

/** Tear down a `Game`. Defensive against double-dispose. */
function disposeEngine(handle: EngineHandle | null): void {
  if (!handle) return;
  try {
    handle.game.destroy();
  } catch (err) {
    console.warn("EditorViewport: dispose threw —", err);
  }
}

export function EditorViewport({
  projectId,
  sceneName,
  onSceneResolved,
  mode,
  onModeChange,
  editScene,
  editScenePath,
  onEditSceneChange,
  onPersistScene,
}: EditorViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string>("Initialising…");
  const [error, setError] = useState<string | null>(null);
  /**
   * Engine handle held in a ref (not state) so it survives
   * re-renders without forcing a remount cycle. The mount effect
   * writes it; the unmount cleanup reads it.
   */
  const engineRef = useRef<EngineHandle | null>(null);

  // Mount / re-mount the engine on every (projectId, sceneName) change.
  // Skip the engine entirely in Edit mode — GridEditor renders instead.
  useEffect(() => {
    if (mode === "edit") {
      // Make sure no stale engine is running while we're in edit mode.
      const handle = engineRef.current;
      engineRef.current = null;
      disposeEngine(handle);
      setStatus("Edit mode");
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Re-bind to a local const so the async closure below sees a
    // non-null `HTMLCanvasElement` even after re-entries.
    const liveCanvas: HTMLCanvasElement = canvas;

    async function boot() {
      setStatus("Loading project…");
      setError(null);
      try {
        const pack = await EditorAssetPack.fromProject(projectId);
        if (cancelled) return;
        setStatus("Applying config…");
        const packConfigRaw = ((await pack.config()) ?? {}) as PartialGameConfig;
        applyConfigOverride(packConfigRaw);
        if (cancelled) return;

        const resolvedSceneName = sceneName ?? pack.manifest.startScene;
        if (!resolvedSceneName) {
          throw new Error("Project manifest is missing `startScene`.");
        }
        if (!pack.has(resolvedSceneName)) {
          throw new Error(
            `Scene "${resolvedSceneName}" not found in project assets.`,
          );
        }
        setStatus(`Loading scene ${resolvedSceneName}…`);
        const scene = await pack.scene(resolvedSceneName);
        if (cancelled) return;
        onSceneResolved?.(resolvedSceneName);

        setStatus("Compiling shaders…");
        const shaderSources =
          CONFIG.rendering.backend === "webgl" && pack.manifest.shaders
            ? await WebGLRenderer.prefetchShaderSources(pack)
            : undefined;
        if (cancelled) return;

        setStatus("Starting engine…");
        const game = new Game(
          liveCanvas,
          pack,
          scene,
          undefined,
          packConfigRaw,
          shaderSources,
        );
        await game.runPackScripts();
        if (cancelled) {
          game.destroy();
          return;
        }
        game.spawnInitialEntities();
        await game.collectShaderVariants();
        await game.renderer.assetsReady;
        if (cancelled) {
          game.destroy();
          return;
        }
        engineRef.current = { game, pack };
        game.start();
        setStatus("Running");
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message ?? String(err);
        console.error("EditorViewport: boot failed —", err);
        setError(message);
        setStatus("Failed");
      }
    }

    boot();
    return () => {
      cancelled = true;
      const handle = engineRef.current;
      engineRef.current = null;
      disposeEngine(handle);
      if (
        typeof document !== "undefined" &&
        document.pointerLockElement === canvas
      ) {
        document.exitPointerLock();
      }
    };
    // `onSceneResolved` deliberately omitted — we only want to remount
    // on the bound project/scene/mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sceneName, mode]);

  // Keyboard: Tab swaps Play ⇄ Edit. Spacebar in edit mode is reserved
  // for the GridEditor's spawn-recenter (TODO E4).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept keystrokes that belong to a form input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        handleModeToggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `handleModeToggle` captures current props; we want it to be the
    // latest closure on every render, so we re-bind the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editScene]);

  // Toggle helper — persists pending edits before the play remount.
  async function handleModeToggle() {
    if (mode === "edit") {
      // Save first so the engine reboots against the edited scene.
      try {
        await onPersistScene();
      } catch (err) {
        console.warn("EditorViewport: save-on-play-switch failed —", err);
      }
      onModeChange("play");
    } else {
      onModeChange("edit");
    }
  }

  return (
    <div className="relative h-full w-full bg-zinc-950 overflow-hidden">
      {/* Mode toggle (top-right segmented control). Floats above the
          canvas in Play mode; pinned to the toolbar row visually
          but as an overlay so we don't shift the layout when the
          GridEditor's own toolbar renders below. */}
      <div className="absolute top-2 right-2 z-30 flex rounded-md border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm overflow-hidden text-xs">
        <ViewportModeButton
          active={mode === "play"}
          onClick={() => handleModeToggle()}
          label="▶ Play"
        />
        <ViewportModeButton
          active={mode === "edit"}
          onClick={() => handleModeToggle()}
          label="✎ Edit"
        />
      </div>

      {/* Status / error overlay sits above the canvas so the user
          sees boot progress without a flash of unstyled engine. Only
          shown when the live engine is mounting — Edit mode renders
          GridEditor directly. */}
      {mode === "play" && error ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/90 px-6 text-center">
          <div className="max-w-md text-sm text-red-300">
            <div className="font-semibold text-red-200 mb-1">
              Viewport failed to start
            </div>
            <pre className="whitespace-pre-wrap text-xs text-red-300/80 font-mono">
              {error}
            </pre>
          </div>
        </div>
      ) : mode === "play" && status !== "Running" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60 text-xs text-zinc-400 pointer-events-none">
          {status}
        </div>
      ) : null}

      {/* Edit mode → GridEditor occupies the pane. The engine canvas
          stays mounted but hidden so we don't tear down the WebGL
          context unnecessarily (the boot effect already disposed
          the engine). */}
      {mode === "edit" && editScene && editScenePath ? (
        <div className="absolute inset-0 z-10">
          <GridEditor
            projectId={projectId}
            scenePath={editScenePath}
            scene={editScene}
            onSceneChange={onEditSceneChange}
          />
        </div>
      ) : mode === "edit" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-zinc-400 bg-zinc-950">
          Loading scene…
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        id="editor-viewport-canvas"
        className={cn(
          "block h-full w-full",
          mode === "edit" && "invisible",
        )}
        style={{ touchAction: "none" }}
      />
    </div>
  );
}

function ViewportModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 transition-colors",
        active
          ? "bg-amber-400 text-zinc-950 font-semibold"
          : "text-zinc-300 hover:bg-zinc-800",
      )}
    >
      {label}
    </button>
  );
}
