import React from "react";
import {
  Bug,
  Camera as CameraIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Film,
  Gauge,
  Layers as LayersIcon,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Square,
  Target,
  Users,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";
import {
  Badge,
  CollapsibleSection,
  FpsGraph,
  IconButton,
  KeyValueList,
  LogPanel,
  PropertyRow,
  ScrollArea,
  SegmentedControl,
  Slider,
  StatsBlock,
  StatusPill,
  ToggleSwitch,
  Tooltip,
  type LogLine,
} from "../components/ui/index";
import { useStatusBar } from "../shell/StatusBarContext";

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
 * PlaytestOverlay — R4h of EDITOR_REDESIGN.md, redesigned to match
 * `Editor Design/GamePreview.png`.
 *
 *     +------------------------------------------------------+
 *     | ACTION BAR — Stop / Pause / Replay / Free Camera /  |
 *     |              Bot Mode / Debug View / Cinema toggle  |
 *     +-----------+----------------------------+------------+
 *     | LEFT RAIL |   CENTER (transparent —    | RIGHT RAIL |
 *     |  Runtime  |   iframe shows through)    | Inspector  |
 *     |  Player   |                            |            |
 *     |  World    |                            |            |
 *     +-----------+----------------------------+------------+
 *     | BOTTOM — log tabs + perf chart                       |
 *     +------------------------------------------------------+
 *
 * Wrapper is `pointer-events-none` so iframe input flows through the
 * empty center pane. Each chrome surface (top action bar / rails /
 * bottom panel) re-enables `pointer-events-auto` locally.
 *
 * Stats arrive at ~10Hz via the iframe → editor-bridge `engine-stats`
 * postMessage (EDITOR_IFRAME.md I2), forwarded to `MapView` via
 * `EditorViewport`'s `onEngineStats` callback. MapView stashes the
 * latest snapshot in state and feeds it here as `engineStats`.
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
  /** Optional pause/resume hook. Forwards to the iframe-bridge
   *  `pause` / `resume` postMessage when wired by MapView. Stubbed in
   *  the toolbar so the affordance is visible even pre-wiring. */
  onTogglePause?: () => void;
  /** Reflects whether the engine is currently paused — drives the
   *  Play/Pause icon swap and the LIVE / PAUSED status pill. */
  paused?: boolean;
}

export function PlaytestOverlay({
  engineStats,
  onRerun,
  onExit,
  onTogglePause,
  paused = false,
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

  const [leftRailOpen, setLeftRailOpen] = React.useState(true);
  const [rightRailOpen, setRightRailOpen] = React.useState(true);
  const [bottomOpen, setBottomOpen] = React.useState(true);

  // Action-bar toggle state. These map 1:1 to the affordances drawn in
  // GamePreview.png — Free Camera, Bot Mode, Debug View, Cinema OFF
  // toggle. The wires that route them to the engine iframe are an
  // I2 follow-up (the postMessage protocol doesn't yet ship a
  // `free-camera` / `cinema` message), so the toggles flip local state
  // and the rail surfaces refresh from it. The visual affordance is
  // shipped now; the engine subscribes later.
  const [freeCamera, setFreeCamera] = React.useState(false);
  const [botMode, setBotMode] = React.useState(false);
  const [debugView, setDebugView] = React.useState(true);
  const [cinema, setCinema] = React.useState(false);

  // Debug-overlay toggle set (mirrors the right-rail "DEBUG OVERLAY"
  // checkboxes in the mockup). Wireframe / Player Path / Light Sources /
  // Triggers.
  const [debugLayers, setDebugLayers] = React.useState({
    wireframe: false,
    playerPath: true,
    lightSources: true,
    triggers: false,
  });

  // Camera depth-of-field slider — the mockup shows a "DOF" slider in
  // the bottom-right inspector. Local state until the engine ships
  // per-camera post-FX uniforms.
  const [dofValue, setDofValue] = React.useState(35);

  // Synthetic logs — placeholder until the engine forwards its
  // ConsoleAPI buffer via postMessage (recent `ConsoleAPI recording
  // surface` commit landed the engine half). The rows shown match the
  // mockup's three lines + an extra to demonstrate filter chips.
  const logs = React.useMemo<ReadonlyArray<LogLine>>(() => {
    const now = new Date();
    const t = (offset: number) =>
      new Date(now.getTime() - offset * 1000)
        .toISOString()
        .slice(11, 19);
    return [
      {
        id: "l1",
        type: "info",
        time: t(8),
        message: "Player entered region: courtyard",
      },
      {
        id: "l2",
        type: "warn",
        time: t(4),
        message: "Audio voice limit approaching (12/16)",
      },
      {
        id: "l3",
        type: "info",
        time: t(2),
        message: "Trigger fired: door_unlock_01",
      },
      {
        id: "l4",
        type: "debug",
        time: t(1),
        message: "Lightmap re-bind: chunk(4,2)",
      },
    ];
  }, []);
  const [logTab, setLogTab] = React.useState<"console" | "errors" | "network">(
    "console",
  );
  const filteredLogs = React.useMemo(() => {
    switch (logTab) {
      case "errors":
        return logs.filter((l) => l.type === "error" || l.type === "warn");
      case "network":
        return logs.filter(() => false);
      default:
        return logs;
    }
  }, [logs, logTab]);

  // ── StatusBar wiring (§6.4: "Playtest: FPS | draw calls | player
  //    pos"). Push the four headline numbers into the shell's
  //    StatusBar so they're visible across the app, not just inside
  //    the overlay chrome. The §7.9 spec also routes detailed numbers
  //    to the in-overlay top toolbar — these are the consolidated
  //    "everywhere" subset.
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    setSections([
      {
        id: "playtest-fps",
        label: "FPS",
        value: engineStats ? engineStats.fps.toFixed(0) : "—",
      },
      {
        id: "playtest-draws",
        label: "Draws",
        value: engineStats ? engineStats.drawCalls : "—",
      },
      {
        id: "playtest-entities",
        label: "Entities",
        value: engineStats ? engineStats.entityCount : "—",
      },
      {
        id: "playtest-voices",
        label: "Voices",
        value: engineStats ? engineStats.audioActiveVoices : "—",
        align: "right",
      },
    ]);
    return () => {
      setSections([]);
    };
  }, [engineStats, setSections]);

  // ── Esc closes the overlay — mirrors the X icon in the top
  //    toolbar. The MapView keyboard handler also listens for Esc to
  //    pop playtest, but binding it here as well is cheap and
  //    documents intent.
  React.useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label="Playtest mode"
    >
      {/* ─── TOP ACTION BAR ────────────────────────────────────── */}
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2 h-12 px-3",
          "bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800",
        )}
      >
        <button
          type="button"
          onClick={onExit}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md",
            "bg-red-500 hover:bg-red-400 text-zinc-950 text-xs font-semibold",
            "border border-red-400",
          )}
          title="Stop playtest (Esc)"
        >
          <Square size={12} fill="currentColor" />
          Stop
        </button>
        {onTogglePause && (
          <button
            type="button"
            onClick={onTogglePause}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md",
              "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium",
              "border border-zinc-700",
            )}
            title={paused ? "Resume engine" : "Pause engine"}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        <button
          type="button"
          onClick={onRerun}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md",
            "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium",
            "border border-zinc-700",
          )}
          title="Replay — reset engine state"
        >
          <RotateCcw size={12} />
          Replay
        </button>

        <div className="h-6 w-px bg-zinc-800 mx-1" />

        <ActionToggle
          icon={<CameraIcon size={12} />}
          label="Free Camera"
          active={freeCamera}
          onClick={() => setFreeCamera((v) => !v)}
        />
        <ActionToggle
          icon={<Users size={12} />}
          label="Bot Mode"
          active={botMode}
          onClick={() => setBotMode((v) => !v)}
        />
        <ActionToggle
          icon={<Bug size={12} />}
          label="Debug View"
          active={debugView}
          onClick={() => setDebugView((v) => !v)}
        />

        <div className="ml-auto flex items-center gap-2">
          <StatusPill variant={paused ? "warn" : "ok"}>
            {paused ? "PAUSED" : "LIVE"}
          </StatusPill>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Film size={12} className={cn(cinema ? "text-amber-400" : "")} />
            Cinema
            <ToggleSwitch
              checked={cinema}
              onChange={setCinema}
              size="sm"
              aria-label="Toggle cinema mode"
            />
          </div>
          <Tooltip content="Exit playtest (Esc)">
            <IconButton
              icon={<X size={14} />}
              tooltip="Exit playtest (Esc)"
              variant="ghost"
              onClick={onExit}
            />
          </Tooltip>
        </div>
      </div>

      {/* ─── MIDDLE — left rail + center + right rail ─────────── */}
      <div className="flex-1 min-h-0 flex">
        {/* LEFT RAIL — Runtime stats / Player / World */}
        {leftRailOpen ? (
          <aside
            className={cn(
              "pointer-events-auto flex flex-col shrink-0 w-[260px]",
              "bg-zinc-950/95 backdrop-blur-sm border-r border-zinc-800",
            )}
            aria-label="Runtime telemetry"
          >
            <div className="flex items-center justify-between h-9 px-3 border-b border-zinc-800">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">
                <Gauge size={12} className="text-amber-400" />
                Telemetry
              </div>
              <IconButton
                icon={<ChevronLeft size={14} />}
                tooltip="Collapse"
                variant="ghost"
                onClick={() => setLeftRailOpen(false)}
              />
            </div>
            <ScrollArea fade={false} className="flex-1 min-h-0">
              <div className="p-2 space-y-2">
                <CollapsibleSection title="Runtime Stats" defaultOpen>
                  <KeyValueList
                    rows={[
                      {
                        label: "FPS",
                        value: engineStats ? engineStats.fps.toFixed(0) : "—",
                      },
                      {
                        label: "Frame ms",
                        value: engineStats
                          ? engineStats.frameMs.toFixed(2)
                          : "—",
                      },
                      {
                        label: "Avg ms",
                        value: engineStats
                          ? engineStats.frameMsAvg.toFixed(2)
                          : "—",
                      },
                      {
                        label: "Draw calls",
                        value: engineStats ? engineStats.drawCalls : "—",
                      },
                      {
                        label: "Triangles",
                        value: engineStats
                          ? formatCount(engineStats.triangles)
                          : "—",
                      },
                      {
                        label: "Programs",
                        value: engineStats ? engineStats.programCount : "—",
                      },
                      {
                        label: "Shader swaps",
                        value: engineStats ? engineStats.shaderSwitches : "—",
                      },
                      {
                        label: "GPU mem",
                        value: engineStats
                          ? formatBytes(
                              engineStats.textureMem +
                                engineStats.geometryMem,
                            )
                          : "—",
                      },
                    ]}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="Player Info" defaultOpen>
                  <KeyValueList
                    rows={[
                      { label: "Position", value: "—" },
                      { label: "Heading", value: "—" },
                      { label: "Health", value: "—" },
                      { label: "Region", value: "—" },
                    ]}
                  />
                  <div className="mt-2 text-[10px] text-zinc-500 leading-snug">
                    Player snapshot pending engine `player-state` postMessage.
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="World Info" defaultOpen>
                  <KeyValueList
                    rows={[
                      {
                        label: "Entities",
                        value: engineStats ? engineStats.entityCount : "—",
                      },
                      {
                        label: "Visible",
                        value: engineStats
                          ? engineStats.visibleEntityCount
                          : "—",
                      },
                      {
                        label: "Lights",
                        value: engineStats ? engineStats.lightCount : "—",
                      },
                      {
                        label: "Baked cells",
                        value: engineStats ? engineStats.bakedCellCount : "—",
                      },
                      {
                        label: "Voices",
                        value: engineStats
                          ? engineStats.audioActiveVoices
                          : "—",
                      },
                      {
                        label: "Mixer load",
                        value: engineStats
                          ? `${(engineStats.audioMixerLoad * 100).toFixed(0)}%`
                          : "—",
                      },
                    ]}
                  />
                </CollapsibleSection>
              </div>
            </ScrollArea>
          </aside>
        ) : (
          <CollapsedHandle
            side="left"
            onClick={() => setLeftRailOpen(true)}
            label="Expand telemetry"
          />
        )}

        {/* CENTER — transparent. iframe (mounted by parent
            EditorViewport) shows through and receives input. */}
        <div className="flex-1" aria-hidden="true" />

        {/* RIGHT RAIL — Inspector */}
        {rightRailOpen ? (
          <aside
            className={cn(
              "pointer-events-auto flex flex-col shrink-0 w-[320px]",
              "bg-zinc-950/95 backdrop-blur-sm border-l border-zinc-800",
            )}
            aria-label="Inspector"
          >
            <div className="flex items-center justify-between h-9 px-3 border-b border-zinc-800">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">
                <Target size={12} className="text-amber-400" />
                Inspector
              </div>
              <IconButton
                icon={<ChevronRight size={14} />}
                tooltip="Collapse"
                variant="ghost"
                onClick={() => setRightRailOpen(false)}
              />
            </div>
            <ScrollArea fade={false} className="flex-1 min-h-0">
              <div className="p-2 space-y-2">
                <CollapsibleSection
                  title="Debug Overlay"
                  icon={<Eye size={12} />}
                  defaultOpen
                >
                  <DebugToggleRow
                    label="Wireframe"
                    checked={debugLayers.wireframe}
                    onChange={(v) =>
                      setDebugLayers((s) => ({ ...s, wireframe: v }))
                    }
                  />
                  <DebugToggleRow
                    label="Player Path"
                    checked={debugLayers.playerPath}
                    onChange={(v) =>
                      setDebugLayers((s) => ({ ...s, playerPath: v }))
                    }
                  />
                  <DebugToggleRow
                    label="Light Sources"
                    checked={debugLayers.lightSources}
                    onChange={(v) =>
                      setDebugLayers((s) => ({ ...s, lightSources: v }))
                    }
                  />
                  <DebugToggleRow
                    label="Triggers"
                    checked={debugLayers.triggers}
                    onChange={(v) =>
                      setDebugLayers((s) => ({ ...s, triggers: v }))
                    }
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="Selected Cell"
                  icon={<LayersIcon size={12} />}
                  defaultOpen
                >
                  <PropertyRow label="Coordinates">
                    <span className="font-mono text-xs text-zinc-200">—</span>
                  </PropertyRow>
                  <PropertyRow label="Preset">
                    <span className="font-mono text-xs text-zinc-200">—</span>
                  </PropertyRow>
                  <PropertyRow label="Layer">
                    <Badge variant="amber" outlined>floor</Badge>
                  </PropertyRow>
                  <div className="text-[10px] text-zinc-500 leading-snug pt-1">
                    Click a cell in the running game to inspect (pending
                    `cell-picked` iframe message).
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Lighting"
                  icon={<Lightbulb size={12} />}
                  defaultOpen
                >
                  <PropertyRow label="Ambient">
                    <span className="font-mono text-xs text-zinc-200">0.18</span>
                  </PropertyRow>
                  <PropertyRow label="Lights">
                    <Badge variant="yellow" outlined>
                      {engineStats ? engineStats.lightCount : 0}
                    </Badge>
                  </PropertyRow>
                  <PropertyRow label="Baked cells">
                    <Badge variant="zinc" outlined>
                      {engineStats ? engineStats.bakedCellCount : 0}
                    </Badge>
                  </PropertyRow>
                </CollapsibleSection>

                <CollapsibleSection title="Camera" defaultOpen>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Depth of Field</span>
                      <span className="font-mono text-zinc-300">{dofValue}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={dofValue}
                      onChange={setDofValue}
                    />
                    <div className="flex items-center justify-between text-xs text-zinc-400 pt-2">
                      <span>Focus camera on target</span>
                      <ToggleSwitch
                        checked={freeCamera === false}
                        onChange={(v) => setFreeCamera(!v)}
                        size="sm"
                        aria-label="Focus camera on target"
                      />
                    </div>
                  </div>
                </CollapsibleSection>
              </div>
            </ScrollArea>
          </aside>
        ) : (
          <CollapsedHandle
            side="right"
            onClick={() => setRightRailOpen(true)}
            label="Expand inspector"
          />
        )}
      </div>

      {/* ─── BOTTOM — logs + perf chart ──────────────────────── */}
      {bottomOpen ? (
        <div
          className={cn(
            "pointer-events-auto flex shrink-0 h-[200px]",
            "bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800",
          )}
        >
          <div className="flex-1 min-w-0 flex flex-col border-r border-zinc-800">
            <div className="flex items-center gap-1 px-3 h-9 border-b border-zinc-800">
              <SegmentedControl<"console" | "errors" | "network">
                size="sm"
                aria-label="Log channel"
                value={logTab}
                onChange={(v) => v && setLogTab(v)}
                options={[
                  { id: "console", label: "Console" },
                  { id: "errors", label: "Errors" },
                  { id: "network", label: "Network" },
                ]}
              />
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="zinc" outlined>
                  {filteredLogs.length}
                </Badge>
                <IconButton
                  icon={<X size={12} />}
                  tooltip="Hide bottom panel"
                  variant="ghost"
                  onClick={() => setBottomOpen(false)}
                />
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <LogPanel
                lines={filteredLogs}
                follow
                className="h-full border-0 rounded-none bg-transparent"
              />
            </div>
          </div>

          <div className="w-[340px] shrink-0 flex flex-col">
            <div className="flex items-center px-3 h-9 border-b border-zinc-800">
              <div className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">
                Performance
              </div>
              <Badge variant="emerald" outlined className="ml-auto">
                {engineStats ? `${engineStats.fps.toFixed(0)} FPS` : "—"}
              </Badge>
            </div>
            <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
              <FpsGraph
                samples={fpsSamples}
                target={16.67}
                width={310}
                height={70}
                legend={
                  engineStats ? (
                    <span>
                      avg {engineStats.frameMsAvg.toFixed(1)} ms · target 16.7
                      ms
                    </span>
                  ) : (
                    <span>Waiting for engine…</span>
                  )
                }
              />
              <div className="grid grid-cols-3 gap-2">
                <StatsBlock
                  label="Draws"
                  value={engineStats ? engineStats.drawCalls : "—"}
                />
                <StatsBlock
                  label="Voices"
                  value={engineStats ? engineStats.audioActiveVoices : "—"}
                />
                <StatsBlock
                  label="Entities"
                  value={engineStats ? engineStats.entityCount : "—"}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setBottomOpen(true)}
          className={cn(
            "pointer-events-auto self-center mb-2 h-7 px-3 rounded-md",
            "bg-zinc-900/95 border border-zinc-800 text-xs text-zinc-300",
            "hover:bg-zinc-800 hover:text-zinc-100",
          )}
        >
          Show log panel
        </button>
      )}
    </div>
  );
}

/* ─── helpers ──────────────────────────────────────────────────── */

interface ActionToggleProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function ActionToggle({ icon, label, active, onClick }: ActionToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
        "border transition-colors",
        active
          ? "bg-amber-500/15 border-amber-500/50 text-amber-100"
          : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

function DebugToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1.5 cursor-pointer">
      <span className="text-xs text-zinc-300">{label}</span>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        size="sm"
        aria-label={label}
      />
    </label>
  );
}

function CollapsedHandle({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pointer-events-auto self-start mt-2 h-9 w-7 flex items-center justify-center rounded-md",
        side === "left" ? "ml-2" : "mr-2 ml-auto",
        "border border-zinc-800 bg-zinc-950/95 backdrop-blur-sm",
        "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
      )}
      aria-label={label}
      title={label}
    >
      {side === "left" ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
    </button>
  );
}

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
