import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { GAME_RUNNER_URL } from "../lib/gameRunnerUrl";
import { GridEditor, type MutableScene } from "./GridEditor";

/**
 * Live engine pane for the editor's project view.
 *
 * I1 of `docs/plans/EDITOR_IFRAME.md`: the engine no longer mounts
 * in the editor's React tree. Instead, this component embeds the
 * game runner via `<iframe>` and drives it via `postMessage`.
 *
 * That moves four classes of bug out of scope:
 *  - HUD canvas leaks past the viewport pane (the engine's stacked
 *    2D HUD canvas appends to `document.body`; inside the iframe
 *    that body IS the viewport).
 *  - Modal overlays (`position: fixed`) cover the editor — anchored
 *    to iframe viewport now.
 *  - Tailwind classes from `default-pack/scripts/ui/` weren't in
 *    editor's compiled CSS — the iframe runs game-runner HTML,
 *    whose Tailwind compile includes pack sources.
 *  - Engine teardown races on mode toggle — iframe lifecycle is
 *    decoupled from React's render cycle.
 *
 * Lifecycle:
 *  - Project change → new iframe URL (full iframe rebuild).
 *  - Scene change within same project → `switch-scene` message.
 *  - Edit→Play → `scene-changed` message (engine re-reads IDB).
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
   *  Save and signal the iframe on Play. */
  editScene: MutableScene | null;
  editScenePath: string | null;
  onEditSceneChange: (next: MutableScene) => void;
  /** Persist the edited scene to IDB. Called before signalling the
   *  iframe so the engine boots on the fresh bytes. */
  onPersistScene: () => Promise<void>;
  /**
   * Optional ref the parent uses to reach the iframe element from
   * outside the viewport — currently only the Project Settings modal,
   * which needs to broadcast `{type:"reset"}` from its "Reload
   * running game" button. The viewport keeps its own internal ref
   * for all the message wiring; this one is purely an outbound
   * accessor.
   */
  iframeRef?: React.MutableRefObject<HTMLIFrameElement | null>;
  /** Prefab names available to the GridEditor entity tool. Sourced
   *  from `manifest.prefabs` by the parent. */
  prefabNames?: ReadonlyArray<string>;
  /** Sprite IDs available to the GridEditor Sprite component picker.
   *  Sourced from `manifest.sprites` by the parent. */
  spriteIds?: ReadonlyArray<string>;
}

/** Messages the iframe sends back. See EDITOR_IFRAME.md §6. */
type IframeToEditor =
  | { type: "ready"; projectId: string; scene: string }
  | { type: "scene-loaded"; path: string }
  | { type: "error"; message: string };

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
  iframeRef: externalIframeRef,
  prefabNames,
  spriteIds,
}: EditorViewportProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Mirror the iframe element through the parent-supplied ref so the
  // Settings modal can postMessage directly when the user clicks
  // "Reload running game". The internal ref stays the source of truth.
  const setIframeNode = useCallback(
    (node: HTMLIFrameElement | null) => {
      iframeRef.current = node;
      if (externalIframeRef) externalIframeRef.current = node;
    },
    [externalIframeRef],
  );
  const [status, setStatus] = useState<string>("Booting…");
  const [error, setError] = useState<string | null>(null);
  /**
   * Active scene the iframe is reportedly on, per its last
   * `scene-loaded`. Tracked so we know whether a `sceneName` change
   * has been ACKed and we don't keep re-sending the same path.
   */
  const lastSentSceneRef = useRef<string | null>(null);

  /**
   * Iframe src — encodes the project id so a different project
   * triggers a full iframe reload (the engine inside the iframe
   * rebuilds from the new IDB rows). `sceneName` is intentionally
   * NOT in the src — within a project we drive scene changes via
   * postMessage so the engine state survives.
   */
  const src = useMemo(() => {
    const base = GAME_RUNNER_URL;
    const u = new URL(base, window.location.href);
    u.searchParams.set("source", "editor");
    u.searchParams.set("projectId", projectId);
    // First-load scene only — subsequent scene changes use
    // postMessage so engine state doesn't reset.
    if (sceneName) u.searchParams.set("scene", sceneName);
    return u.toString();
    // sceneName intentionally excluded from deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Reset the lastSent tracker whenever the project changes (new
  // iframe = no message has been sent yet).
  useEffect(() => {
    lastSentSceneRef.current = null;
    setStatus("Booting…");
    setError(null);
  }, [projectId]);

  // Listen for messages from THIS iframe specifically. Same-origin
  // means we could trust any postMessage, but the source check
  // future-proofs against other iframes the editor might host.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const m = ev.data as IframeToEditor;
      if (!m || typeof m !== "object" || typeof m.type !== "string") return;
      if (m.type === "ready") {
        setStatus("Running");
        setError(null);
      } else if (m.type === "error") {
        setError(m.message);
        setStatus("Failed");
      } else if (m.type === "scene-loaded") {
        lastSentSceneRef.current = m.path;
        onSceneResolved?.(m.path);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSceneResolved]);

  // When the parent flips `sceneName` (user clicks a different
  // scene), tell the iframe to swap WITHOUT reloading. The engine
  // keeps its world state.
  useEffect(() => {
    if (!sceneName) return;
    // Skip if we haven't received `ready` yet — the bridge isn't up.
    if (status !== "Running") return;
    if (lastSentSceneRef.current === sceneName) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "switch-scene", path: sceneName },
      "*",
    );
  }, [sceneName, status]);

  // Keyboard: Tab swaps Play ⇄ Edit.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editScene, editScenePath]);

  /**
   * Toggle helper — on Edit→Play, persist pending edits and tell
   * the iframe to re-read so the engine sees them. On Play→Edit,
   * pause the engine so it isn't burning frames behind GridEditor.
   */
  async function handleModeToggle() {
    if (mode === "edit") {
      try {
        await onPersistScene();
      } catch (err) {
        console.warn("EditorViewport: save-on-play-switch failed —", err);
      }
      // Tell the iframe to re-read the (now-saved) scene from IDB.
      if (editScenePath) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "scene-changed", path: editScenePath },
          "*",
        );
      }
      iframeRef.current?.contentWindow?.postMessage({ type: "resume" }, "*");
      onModeChange("play");
    } else {
      // Pause the engine so it stops capturing input + burning CPU
      // while the GridEditor is on screen.
      iframeRef.current?.contentWindow?.postMessage({ type: "pause" }, "*");
      onModeChange("edit");
    }
  }

  return (
    <div className="relative h-full w-full bg-zinc-950 overflow-hidden">
      {/* Mode toggle (top-right segmented control). */}
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

      {/* Status / error overlay (Play mode only). */}
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

      {/* Edit mode → GridEditor occupies the pane. The iframe stays
          mounted but hidden so the engine doesn't lose its world. */}
      {mode === "edit" && editScene && editScenePath ? (
        <div className="absolute inset-0 z-10">
          <GridEditor
            projectId={projectId}
            scenePath={editScenePath}
            scene={editScene}
            onSceneChange={onEditSceneChange}
            prefabNames={prefabNames}
            spriteIds={spriteIds}
          />
        </div>
      ) : mode === "edit" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-zinc-400 bg-zinc-950">
          Loading scene…
        </div>
      ) : null}

      <iframe
        ref={setIframeNode}
        src={src}
        title="Engine viewport"
        allow="fullscreen; gamepad; screen-wake-lock"
        className={cn(
          "block w-full h-full",
          mode === "edit" && "invisible pointer-events-none",
        )}
        style={{ border: 0, background: "#000" }}
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
