import React from "react";
import { RotateCcw, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  Badge,
  FpsGraph,
  IconButton,
  PanelHeader,
  ScrollArea,
  StatsBlock,
} from "../components/ui/index";
import { Button } from "../components/ui";

/**
 * Engine telemetry snapshot the overlay reads from. Mirrors the
 * `EngineStats` shape defined in `packages/engine/src/Debug/stats.ts`;
 * we re-declare it locally rather than importing from `@two_5_d/engine`
 * because the engine's top-level barrel doesn't re-export the Debug
 * surface today (the export lives under `engine/src/Debug/index.ts`
 * but isn't lifted to `engine/src/index.ts`). The brief explicitly
 * says "don't touch the engine" — so a local shape is the right
 * cut. When R4h's #226 iframe-bridge work lifts `EngineStats` into
 * the public barrel, this local copy can be replaced by an `import
 * type` line and the file lives untouched.
 *
 * Field-for-field match with `EngineStats`. Optional fields are
 * marked so a partial telemetry payload (e.g. an older iframe build)
 * still type-checks.
 */
export interface EngineStats {
  // Frame timing
  fps: number;
  frameMs: number;
  frameMsAvg: number;
  // ECS counts
  entityCount: number;
  lightCount: number;
  bakedCellCount: number;
  visibleEntityCount: number;
  // Renderer
  drawCalls: number;
  triangles: number;
  shaderSwitches: number;
  programCount: number;
  textureMem: number;
  geometryMem: number;
  // Audio
  audioActiveVoices: number;
  audioMixerLoad: number;
}

/**
 * PlaytestOverlay — R4h of EDITOR_REDESIGN.md (§7.9 + §12 Q1).
 *
 * Renders the "Playtest mode" full-takeover overlay that sits ON TOP of
 * the Map view. The iframe game-runner is owned by `EditorViewport`
 * (mounted underneath this overlay inside `MapView`) — the overlay
 * deliberately does NOT mount its own iframe so the engine state
 * survives the Edit ↔ Playtest round-trip (§12 Q1: "the iframe never
 * unmounts").
 *
 * Layout (matches the R4h brief):
 *
 *     +----------------+---------------------------------+
 *     | LEFT — stats   | iframe (lives in EditorViewport, |
 *     |  panel (~280px) | rendered by the parent BEHIND   |
 *     |                |  this overlay — we leave the     |
 *     |                |  center pane transparent).       |
 *     +----------------+---------------------------------+
 *
 * The left rail is opaque; the centre pane is transparent so the
 * underlying iframe shows through (and remains interactive). The
 * overlay itself is `pointer-events-none` on the wrapper with
 * `pointer-events-auto` re-enabled on the left rail so iframe input
 * isn't blocked.
 *
 * Stats are pushed at ~10Hz via the iframe → editor-bridge
 * `engine-stats` postMessage (EDITOR_IFRAME.md I2), forwarded to
 * `MapView` via `EditorViewport`'s `onEngineStats` callback. MapView
 * stashes the latest snapshot in state and feeds it here as the
 * `engineStats` prop.
 */

export interface PlaytestOverlayProps {
  /** Latest engine telemetry snapshot. `null` until the first frame. */
  engineStats: EngineStats | null;
  /** Sends `{type:"reset"}` to the iframe — engine reboots, world
   *  state wiped. */
  onRerun: () => void;
  /** Closes Playtest mode and returns to Edit. The iframe stays
   *  mounted — engine state is preserved across the round-trip. */
  onExit: () => void;
}

export function PlaytestOverlay({
  engineStats,
  onRerun,
  onExit,
}: PlaytestOverlayProps) {
  // Rolling FpsGraph buffer — last ~240 frame-time samples. Sampled
  // from the 10Hz `engine-stats` push so the graph effectively shows
  // ~24s of history rather than the literal last-N-frames the engine
  // sees. Sufficient resolution for "is it stuttering right now?"
  // which is the only thing we care about during playtest.
  const [fpsSamples, setFpsSamples] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (!engineStats) return;
    setFpsSamples((prev) => {
      const next = prev.length >= 240 ? prev.slice(1) : prev.slice();
      next.push(engineStats.frameMs);
      return next;
    });
  }, [engineStats]);

  return (
    <div
      className="absolute inset-0 z-30 flex pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label="Playtest mode"
    >
      {/* LEFT — stats rail. `pointer-events-auto` re-enables UI on
          this rail (the wrapper above is none so the iframe receives
          input through the empty centre pane). */}
      <aside
        className={cn(
          "pointer-events-auto flex flex-col shrink-0 w-[280px]",
          "border-r border-zinc-800 bg-zinc-950/95 backdrop-blur-sm",
        )}
      >
        <PanelHeader
          size="sm"
          title="Playtest"
          action={
            <div className="flex items-center gap-1">
              <Badge variant="emerald" outlined>
                LIVE
              </Badge>
              <IconButton
                icon={<X size={14} />}
                tooltip="Exit playtest (Esc)"
                variant="ghost"
                onClick={onExit}
              />
            </div>
          }
        />

        <ScrollArea fade={false} className="flex-1 min-h-0">
          <div className="p-3 space-y-3">
            {/* ── Runtime — FPS / frame time / draw calls ────────── */}
            <section className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
                Runtime
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatsBlock
                  label="FPS"
                  value={engineStats ? engineStats.fps.toFixed(0) : "—"}
                  emphasis={
                    engineStats
                      ? engineStats.fps >= 55
                        ? "success"
                        : engineStats.fps >= 30
                          ? "warn"
                          : "error"
                      : "default"
                  }
                />
                <StatsBlock
                  label="Frame ms"
                  value={
                    engineStats ? engineStats.frameMs.toFixed(1) : "—"
                  }
                  emphasis={
                    engineStats
                      ? engineStats.frameMs <= 18
                        ? "success"
                        : engineStats.frameMs <= 33
                          ? "warn"
                          : "error"
                      : "default"
                  }
                />
                <StatsBlock
                  label="Avg ms"
                  value={
                    engineStats ? engineStats.frameMsAvg.toFixed(1) : "—"
                  }
                />
                <StatsBlock
                  label="Draw calls"
                  value={engineStats ? engineStats.drawCalls : "—"}
                />
              </div>
              <FpsGraph
                samples={fpsSamples}
                target={16.67}
                width={252}
                height={48}
                legend={
                  engineStats ? (
                    <span>
                      avg {engineStats.frameMsAvg.toFixed(1)} ms · target
                      16.7 ms
                    </span>
                  ) : (
                    <span>Waiting for engine…</span>
                  )
                }
              />
            </section>

            {/* ── World — entities / lights / cells ──────────────── */}
            <section className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
                World
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatsBlock
                  label="Entities"
                  value={engineStats ? engineStats.entityCount : "—"}
                />
                <StatsBlock
                  label="Lights"
                  value={engineStats ? engineStats.lightCount : "—"}
                />
                <StatsBlock
                  label="Visible"
                  value={engineStats ? engineStats.visibleEntityCount : "—"}
                />
                <StatsBlock
                  label="Baked cells"
                  value={engineStats ? engineStats.bakedCellCount : "—"}
                />
              </div>
            </section>

            {/* ── Renderer — triangles / shaders / mem ───────────── */}
            <section className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
                Renderer
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatsBlock
                  label="Triangles"
                  value={engineStats ? formatCount(engineStats.triangles) : "—"}
                />
                <StatsBlock
                  label="Shader swaps"
                  value={engineStats ? engineStats.shaderSwitches : "—"}
                />
                <StatsBlock
                  label="Programs"
                  value={engineStats ? engineStats.programCount : "—"}
                />
                <StatsBlock
                  label="GPU mem"
                  value={
                    engineStats
                      ? formatBytes(
                          engineStats.textureMem + engineStats.geometryMem,
                        )
                      : "—"
                  }
                />
              </div>
            </section>

            {/* ── Audio ──────────────────────────────────────────── */}
            <section className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
                Audio
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatsBlock
                  label="Voices"
                  value={engineStats ? engineStats.audioActiveVoices : "—"}
                />
                <StatsBlock
                  label="Mixer load"
                  value={
                    engineStats
                      ? `${(engineStats.audioMixerLoad * 100).toFixed(0)}%`
                      : "—"
                  }
                />
              </div>
            </section>
          </div>
        </ScrollArea>

        {/* Footer actions — Rerun + Exit. The Exit button mirrors the
            X icon in the header for discoverability; ESC also works. */}
        <div className="border-t border-zinc-800 bg-zinc-950/95 p-3 space-y-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={onRerun}
            className="w-full gap-2"
            title="Reset engine state (re-loads scene from IDB)"
          >
            <RotateCcw size={14} />
            Rerun
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onExit}
            className="w-full"
            title="Exit playtest (Esc) — engine state is preserved"
          >
            Exit playtest
          </Button>
        </div>
      </aside>

      {/* CENTER pane — empty + transparent so the iframe behind shows
          through. We deliberately do NOT render a placeholder here:
          the iframe is mounted by the parent at full size, this overlay
          just adorns the edges. */}
      <div className="flex-1" aria-hidden="true" />
    </div>
  );
}

/* ─── helpers ──────────────────────────────────────────────────── */

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(b: number): string {
  if (b <= 0) return "—";
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}
