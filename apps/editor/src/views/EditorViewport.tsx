import React, { useEffect, useRef, useState } from "react";
import { Game } from "Game";
import { applyConfigOverride, CONFIG } from "GameConfig";
import { WebGLRenderer } from "Renderers";
import type { PartialGameConfig } from "Settings";
import { EditorAssetPack } from "../lib/EditorAssetPack";
import { cn } from "../lib/cn";

/**
 * Live engine pane for the editor's project view.
 *
 * Mounts a `<canvas>`, builds an `EditorAssetPack` on top of the
 * project's IDB rows, then constructs the engine's `Game` against the
 * active scene. This is the bare-bones E2 surface — Play mode runs the
 * full engine (pointer lock + WASD + mouse look) and Edit mode keeps
 * the engine drawing but releases pointer lock so the user can
 * interact with the rest of the editor UI. Edit overlays (grid
 * editor, entity glyphs, etc.) land in E3.
 *
 * Lifecycle is the standard `useEffect` cleanup pattern — every change
 * to `projectId` or `sceneName` tears down the previous `Game`
 * (cancels the loop, detaches input listeners) and starts a fresh one.
 * Pointer-lock release on unmount is best-effort; the browser
 * eventually releases it on its own if the canvas leaves the DOM.
 */
export type ViewportMode = "play" | "edit";

export interface EditorViewportProps {
  projectId: string;
  /** Path to the active scene; falls back to manifest.startScene. */
  sceneName?: string;
  /** Notify parent of the resolved scene so it can highlight the row. */
  onSceneResolved?: (path: string) => void;
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
}: EditorViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<ViewportMode>("play");
  const [status, setStatus] = useState<string>("Initialising…");
  const [error, setError] = useState<string | null>(null);
  /**
   * Engine handle held in a ref (not state) so it survives
   * re-renders without forcing a remount cycle. The mount effect
   * writes it; the unmount cleanup reads it.
   */
  const engineRef = useRef<EngineHandle | null>(null);

  // Mount / re-mount the engine on every (projectId, sceneName) change.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Re-bind to a local const so the async closure below sees a
    // non-null `HTMLCanvasElement` even after re-entries. TS narrows
    // through the `!canvas` guard at this scope but not into the
    // nested function.
    const liveCanvas: HTMLCanvasElement = canvas;

    async function boot() {
      setStatus("Loading project…");
      setError(null);
      try {
        const pack = await EditorAssetPack.fromProject(projectId);
        if (cancelled) return;
        setStatus("Applying config…");
        // Pack `config.json` (if present) layers over the engine
        // baseline. We DON'T merge in localStorage here — the editor
        // is its own runtime, and per-user settings from the game
        // shouldn't bleed into authoring (e.g. a low FOV the user
        // saved for playing shouldn't crop their level preview).
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
        // WebGL-only — mirrors `apps/game/index.ts` step 4. canvas2d
        // backend ignores the shaderSources argument entirely.
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
      // Release pointer lock if our canvas owned it; otherwise this
      // is a no-op. Done outside the try/catch in `disposeEngine`
      // because the request can throw if no element holds the lock.
      if (
        typeof document !== "undefined" &&
        document.pointerLockElement === canvas
      ) {
        document.exitPointerLock();
      }
    };
    // `onSceneResolved` deliberately omitted — we only want to remount
    // on the bound project/scene change, not on callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sceneName]);

  // Mode toggle side effects. Play mode lets the user click the canvas
  // to grab pointer lock (the engine wires that on the canvas itself);
  // Edit mode releases an active lock so the user can interact with
  // the surrounding UI without fighting the engine's input bindings.
  useEffect(() => {
    if (mode === "edit" && typeof document !== "undefined") {
      if (document.pointerLockElement === canvasRef.current) {
        document.exitPointerLock();
      }
    }
  }, [mode]);

  // Keyboard: Tab swaps Play ⇄ Edit. Spacebar in edit mode is a no-op
  // for E2 (E3 will recenter the grid on the player's last position;
  // we swallow it here so it doesn't scroll the page).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept keystrokes that belong to a form input — the
      // manifest editor + scene-list filters share this window.
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
        setMode((m) => (m === "play" ? "edit" : "play"));
        return;
      }
      if (e.key === " " && mode === "edit") {
        // Reserved for E3 grid-recenter. Eat it so we don't scroll.
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  return (
    <div className="relative h-full w-full bg-zinc-950 overflow-hidden">
      {/* Mode toggle (top-right segmented control). */}
      <div className="absolute top-2 right-2 z-10 flex rounded-md border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm overflow-hidden text-xs">
        <ViewportModeButton
          active={mode === "play"}
          onClick={() => setMode("play")}
          label="▶ Play"
        />
        <ViewportModeButton
          active={mode === "edit"}
          onClick={() => setMode("edit")}
          label="✎ Edit"
        />
      </div>

      {/* Status / error overlay sits above the canvas so the user
          sees boot progress without a flash of unstyled engine. */}
      {error ? (
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
      ) : status !== "Running" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60 text-xs text-zinc-400 pointer-events-none">
          {status}
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        id="editor-viewport-canvas"
        className={cn(
          "block h-full w-full",
          mode === "edit" && "opacity-90",
        )}
        // Engine sizes the pixel buffer in `Game.fitCanvasToWindow`,
        // but for the editor's bounded pane we want it to fit the
        // pane, not `window.innerWidth`. Until E3 adds a viewport-
        // sized resize hook, the engine's window-resize fitter is the
        // best we have and the canvas's CSS keeps the visual box
        // inside the pane.
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
