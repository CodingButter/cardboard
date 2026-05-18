import React from "react";
import {
  Activity,
  AudioWaveform,
  Box,
  Copy as CopyIcon,
  Download,
  FileAudio,
  Filter as FilterIcon,
  Layers,
  MicVocal,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Waves,
} from "lucide-react";
import { cn } from "../lib/cn";
import {
  Badge,
  CollapsibleSection,
  IconButton,
  PanelHeader,
  PropertyRow,
  ScrollArea,
  SegmentedControl,
  Slider,
  StatsBlock,
  ToggleSwitch,
  Tooltip,
} from "../components/ui/index";
import { Button, Input } from "../components/ui";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { useStatusBar } from "../shell/StatusBarContext";

/**
 * SoundLabView — Sound Lab tab body. Implements the 4-column shell
 * canonical-ed in `docs/plans/IMAGE_LAB.md` §7.1 (Sound Lab inherits
 * the same shell per `docs/plans/SOUND_LAB.md` §7). Matches the
 * visual language of `Editor Design/SoundLab.png`.
 *
 *   +-- Header toolbar (recipe selector / mode / save) -----------+
 *   |                                                             |
 *   |  LEFT RAIL  |   CENTER (procedural graph)   |  RIGHT RAIL  |
 *   |  (260 px)   |   (fluid)                     |  (340 px)    |
 *   |  Ops lib    |                               |  Spectrogram  |
 *   |  Modulators |   Audio node graph            |  + Inspector  |
 *   |                                                             |
 *   +-- Bottom strip (samples / mixer / export) -----------------+
 *
 * SL2 runtime (engine-side compiler + offline renderer + voice pool)
 * lives in `packages/engine/src/ProceduralAudio/`. This view is the
 * SL3 authoring surface — it lists `*.sound.recipe.json` files from
 * the project store and renders the editor scaffold. Compiler/runner
 * wiring is a follow-up; the visual shell is shippable today.
 */

interface RecipeMeta {
  path: string;
  id: string;
  updatedAt: number;
}

interface OpCategory {
  id: string;
  label: string;
  ops: ReadonlyArray<OpTile>;
}

interface OpTile {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const OP_CATEGORIES: ReadonlyArray<OpCategory> = [
  {
    id: "sources",
    label: "Sources",
    ops: [
      {
        id: "oscillator",
        label: "Osc",
        icon: <Waves size={14} />,
        description: "Oscillator — sine / square / saw / triangle.",
      },
      {
        id: "noise",
        label: "Noise",
        icon: <Activity size={14} />,
        description: "White / pink / brown noise.",
      },
      {
        id: "sample",
        label: "Sample",
        icon: <FileAudio size={14} />,
        description: "Pre-loaded audio sample source.",
      },
    ],
  },
  {
    id: "shapers",
    label: "Shapers",
    ops: [
      {
        id: "filter",
        label: "Filter",
        icon: <FilterIcon size={14} />,
        description: "Lowpass / highpass / bandpass biquad.",
      },
      {
        id: "envelope",
        label: "Envelope",
        icon: <SlidersHorizontal size={14} />,
        description: "ADSR envelope generator.",
      },
      {
        id: "lfo",
        label: "LFO",
        icon: <Waves size={14} />,
        description: "Low-frequency oscillator modulator.",
      },
      {
        id: "gain",
        label: "Gain",
        icon: <SlidersHorizontal size={14} />,
        description: "Volume / amplification node.",
      },
    ],
  },
  {
    id: "fx",
    label: "FX & Routing",
    ops: [
      {
        id: "delay",
        label: "Delay",
        icon: <Repeat size={14} />,
        description: "Delay line / echo.",
      },
      {
        id: "reverb",
        label: "Reverb",
        icon: <Sparkles size={14} />,
        description: "Convolution / algorithmic reverb.",
      },
      {
        id: "pan",
        label: "Pan",
        icon: <SlidersHorizontal size={14} />,
        description: "Stereo pan node.",
      },
      {
        id: "mixer",
        label: "Mixer",
        icon: <Layers size={14} />,
        description: "Mixer / bus / send.",
      },
    ],
  },
  {
    id: "output",
    label: "Output",
    ops: [
      {
        id: "output",
        label: "Output",
        icon: <MicVocal size={14} />,
        description: "Final audio sink.",
      },
    ],
  },
];

const MOCK_LAYERS = [
  { id: "n1", label: "Sub Osc", op: "oscillator" },
  { id: "n2", label: "Noise Layer", op: "noise" },
  { id: "n3", label: "AMP Env", op: "envelope" },
  { id: "n4", label: "Reverb", op: "reverb" },
  { id: "n5", label: "Output", op: "output" },
];

export interface SoundLabViewProps {
  projectId: string;
}

export function SoundLabView({ projectId }: SoundLabViewProps) {
  const [recipes, setRecipes] = React.useState<RecipeMeta[]>([]);
  const [activeRecipeId, setActiveRecipeId] = React.useState<string | null>(
    null,
  );
  const [opSearch, setOpSearch] = React.useState("");
  const [outputMode, setOutputMode] = React.useState<
    "static" | "loop" | "instrument"
  >("static");
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(
    "n3",
  );
  const [playing, setPlaying] = React.useState(false);
  const [loop, setLoop] = React.useState(false);
  const [seed, setSeed] = React.useState(7);
  const [dirty, setDirty] = React.useState(false);

  const [attack, setAttack] = React.useState(40);
  const [decay, setDecay] = React.useState(35);
  const [sustain, setSustain] = React.useState(60);
  const [release, setRelease] = React.useState(45);

  // Load `*.sound.recipe.json` paths from the project store.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assets = await EditorProjectStore.listAssets(projectId);
        if (cancelled) return;
        const recipes = assets
          .filter((a) => a.path.endsWith(".sound.recipe.json"))
          .map((a) => {
            const slash = a.path.lastIndexOf("/");
            const tail = slash === -1 ? a.path : a.path.slice(slash + 1);
            const id = tail.replace(/\.sound\.recipe\.json$/, "");
            return {
              path: a.path,
              id,
              updatedAt: a.updatedAt,
            } satisfies RecipeMeta;
          });
        setRecipes(recipes);
        const first = recipes[0];
        if (!activeRecipeId && first) {
          setActiveRecipeId(first.id);
        }
      } catch {
        // Empty project / first load — leave list empty.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { setSections } = useStatusBar();
  React.useEffect(() => {
    setSections([
      {
        id: "sl-count",
        label: "Recipes",
        value: String(recipes.length),
      },
      {
        id: "sl-active",
        label: "Active",
        value: activeRecipeId ?? "—",
      },
      {
        id: "sl-mode",
        label: "Mode",
        value:
          outputMode === "instrument"
            ? "Instrument"
            : outputMode === "loop"
              ? "Loop"
              : "One-shot",
      },
      {
        id: "sl-state",
        label: "State",
        value: dirty ? "Unsaved" : "Saved",
        align: "right",
      },
    ]);
    return () => setSections([]);
  }, [recipes.length, activeRecipeId, outputMode, dirty, setSections]);

  const filteredCategories = React.useMemo(() => {
    const q = opSearch.trim().toLowerCase();
    if (!q) return OP_CATEGORIES;
    return OP_CATEGORIES.map((c) => ({
      ...c,
      ops: c.ops.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q),
      ),
    })).filter((c) => c.ops.length > 0);
  }, [opSearch]);

  const onNewRecipe = React.useCallback(() => {
    setDirty(true);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col">
      {/* ─── Header toolbar ──────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 h-12 px-3 shrink-0",
          "bg-zinc-950 border-b border-zinc-800",
        )}
      >
        <div className="flex items-center gap-2">
          <AudioWaveform size={14} className="text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
            Sound Lab
          </span>
        </div>

        <div className="h-6 w-px bg-zinc-800" />

        <RecipeDropdown
          recipes={recipes}
          activeId={activeRecipeId}
          onSelect={setActiveRecipeId}
          onNew={onNewRecipe}
        />

        <SegmentedControl<"static" | "loop" | "instrument">
          size="sm"
          aria-label="Output mode"
          value={outputMode}
          onChange={(v) => v && setOutputMode(v)}
          options={[
            { id: "static", label: "One-shot" },
            { id: "loop", label: "Loop" },
            { id: "instrument", label: "Instrument" },
          ]}
        />

        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            Seed
          </label>
          <Input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            className="h-7 w-20 text-xs"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tooltip content={playing ? "Stop preview" : "Play preview"}>
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold",
                "border transition-colors",
                playing
                  ? "bg-red-500 border-red-400 text-zinc-950 hover:bg-red-400"
                  : "bg-amber-500 border-amber-400 text-zinc-950 hover:bg-amber-400",
              )}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
              {playing ? "Stop" : "Play"}
            </button>
          </Tooltip>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Repeat
              size={12}
              className={cn(loop ? "text-amber-400" : "")}
            />
            Loop
            <ToggleSwitch
              checked={loop}
              onChange={setLoop}
              size="sm"
              aria-label="Loop preview"
            />
          </div>
          <Tooltip content="Re-render (Cmd/Ctrl+B)">
            <Button variant="secondary" size="sm" className="gap-1.5">
              <RefreshCw size={12} />
              Re-bake
            </Button>
          </Tooltip>
          <Tooltip content={dirty ? "Save recipe" : "Up to date"}>
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty}
              onClick={() => setDirty(false)}
              className="gap-1.5"
            >
              <Save size={12} />
              Save
            </Button>
          </Tooltip>
          <Tooltip content="Lab settings">
            <IconButton
              icon={<SettingsIcon size={14} />}
              tooltip="Lab settings"
              variant="ghost"
            />
          </Tooltip>
        </div>
      </div>

      {/* ─── Body — 4-column grid ────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr_340px]">
        {/* LEFT RAIL — Layers (top) + Ops library (bottom) */}
        <aside className="min-h-0 flex flex-col border-r border-zinc-800 bg-zinc-950/60">
          <PanelHeader
            title="Layers"
            action={
              <Badge variant="zinc" outlined>
                {MOCK_LAYERS.length}
              </Badge>
            }
          />
          <div className="max-h-[30%] overflow-hidden flex flex-col border-b border-zinc-800">
            <ScrollArea fade={false} className="flex-1">
              <div className="px-2 py-2 space-y-0.5">
                {MOCK_LAYERS.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => setSelectedNodeId(layer.id)}
                    className={cn(
                      "w-full flex items-center gap-2 h-7 px-2 rounded-md text-xs",
                      "transition-colors border",
                      selectedNodeId === layer.id
                        ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
                        : "bg-transparent border-transparent text-zinc-300 hover:bg-zinc-900/60",
                    )}
                  >
                    <Layers size={12} className="text-zinc-500 shrink-0" />
                    <span className="truncate flex-1 text-left">
                      {layer.label}
                    </span>
                    <Badge variant="zinc" outlined>
                      {layer.op}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          <PanelHeader title="Ops Library" />
          <div className="px-3 pb-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <Input
                value={opSearch}
                onChange={(e) => setOpSearch(e.target.value)}
                placeholder="Search ops…"
                className="h-7 text-xs pl-7"
              />
            </div>
          </div>
          <ScrollArea fade={false} className="flex-1 min-h-0">
            <div className="px-2 pb-4 space-y-2">
              {filteredCategories.map((cat) => (
                <CollapsibleSection
                  key={cat.id}
                  title={cat.label}
                  defaultOpen
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    {cat.ops.map((op) => (
                      <Tooltip
                        key={op.id}
                        content={op.description}
                        delay={400}
                      >
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "text/plain",
                              `soundlab:op:${op.id}`,
                            );
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-md",
                            "border border-zinc-800 bg-zinc-900/40",
                            "hover:border-amber-500/40 hover:bg-zinc-900",
                            "text-zinc-300 hover:text-amber-200",
                            "transition-colors cursor-grab active:cursor-grabbing",
                          )}
                          onClick={() => setDirty(true)}
                        >
                          <span className="text-zinc-400">{op.icon}</span>
                          <span className="text-[10px] leading-tight text-center">
                            {op.label}
                          </span>
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </CollapsibleSection>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* CENTER — Audio Graph workspace */}
        <section className="min-h-0 min-w-0 flex flex-col overflow-hidden bg-zinc-950">
          <PanelHeader
            title="Audio Graph"
            action={
              <div className="flex items-center gap-2">
                <Badge variant="amber" outlined>
                  {activeRecipeId ?? "untitled"}
                </Badge>
                {dirty && (
                  <Badge variant="yellow" outlined>
                    Unsaved
                  </Badge>
                )}
              </div>
            }
          />
          <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden">
            <GraphCanvas
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </div>
        </section>

        {/* RIGHT RAIL — Spectrogram (top) + Inspector (bottom) */}
        <aside className="min-h-0 flex flex-col border-l border-zinc-800 bg-zinc-950/60">
          <PanelHeader
            title="Spectrogram"
            action={
              <Badge variant="emerald" outlined>
                {playing ? "Playing" : "Idle"}
              </Badge>
            }
          />
          <div className="px-3 pb-3 pt-1 space-y-2 border-b border-zinc-800">
            <SpectrogramSurface playing={playing} />
            <WaveformSurface />
            <div className="grid grid-cols-3 gap-2">
              <StatsBlock label="Length" value="1.4 s" />
              <StatsBlock label="Sample" value="44.1k" />
              <StatsBlock label="Voices" value="1" />
            </div>
          </div>

          <ScrollArea fade={false} className="flex-1 min-h-0">
            <div className="p-3 space-y-3">
              <CollapsibleSection
                title="Node Properties"
                icon={<Box size={12} />}
                defaultOpen
                trailing={
                  selectedNodeId && (
                    <Badge variant="purple" outlined>
                      {
                        MOCK_LAYERS.find((l) => l.id === selectedNodeId)?.op ??
                        "node"
                      }
                    </Badge>
                  )
                }
              >
                {selectedNodeId ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Attack</span>
                      <span className="font-mono text-zinc-300">
                        {attack} ms
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={2000}
                      step={1}
                      value={attack}
                      onChange={(v) => {
                        setAttack(v);
                        setDirty(true);
                      }}
                    />
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Decay</span>
                      <span className="font-mono text-zinc-300">
                        {decay} ms
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={2000}
                      step={1}
                      value={decay}
                      onChange={(v) => {
                        setDecay(v);
                        setDirty(true);
                      }}
                    />
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Sustain</span>
                      <span className="font-mono text-zinc-300">
                        {sustain}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={sustain}
                      onChange={(v) => {
                        setSustain(v);
                        setDirty(true);
                      }}
                    />
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Release</span>
                      <span className="font-mono text-zinc-300">
                        {release} ms
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={4000}
                      step={1}
                      value={release}
                      onChange={(v) => {
                        setRelease(v);
                        setDirty(true);
                      }}
                    />
                    <PropertyRow label="Seed">
                      <span className="font-mono text-xs text-zinc-200">
                        {seed}
                      </span>
                    </PropertyRow>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 leading-relaxed py-2">
                    Select a node in the graph to edit its parameters.
                  </p>
                )}
              </CollapsibleSection>
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* ─── Bottom strip — Samples / Mixer / Export ─────────────── */}
      <div className="flex h-[180px] shrink-0 border-t border-zinc-800 bg-zinc-950">
        <div className="w-[260px] shrink-0 flex flex-col border-r border-zinc-800">
          <PanelHeader
            title="Source Files"
            action={
              <Badge variant="zinc" outlined>
                3
              </Badge>
            }
          />
          <ScrollArea fade={false} className="flex-1 min-h-0">
            <div className="px-3 py-2 space-y-1">
              {["snare_01.wav", "synth_lead.wav", "hihat_open.wav"].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 h-7 px-2 rounded-md text-xs",
                    "border border-zinc-800 bg-zinc-900/40",
                    "hover:border-amber-500/40 hover:bg-zinc-900",
                    "text-zinc-300",
                  )}
                  title={s}
                >
                  <FileAudio size={12} className="text-sky-400" />
                  <span className="truncate flex-1 text-left">{s}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 min-w-0 flex flex-col border-r border-zinc-800">
          <PanelHeader title="Mixer & Routing" />
          <div className="flex-1 min-h-0 p-3 grid grid-cols-2 gap-x-4 gap-y-2 content-start text-xs">
            <DetailRow label="Bus" value="master" />
            <DetailRow label="Voices" value="1 / 16" />
            <DetailRow label="Render" value="0.4 ms" />
            <DetailRow label="Sample Rate" value="44.1 kHz" />
            <DetailRow label="Buffer Size" value="256" />
            <DetailRow label="Hash" value="sha:a17e…b302" />
          </div>
          <div className="px-3 pb-2">
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Music2 size={12} />
              Open Master Mixer
            </Button>
          </div>
        </div>

        <div className="w-[320px] shrink-0 flex flex-col">
          <PanelHeader title="Export Outputs" />
          <div className="flex-1 min-h-0 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Status</span>
              <Badge
                variant={dirty ? "yellow" : "emerald"}
                outlined
              >
                {dirty ? "Unsaved changes" : "Saved to pack"}
              </Badge>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start gap-1.5"
            >
              <Download size={12} />
              Export WAV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start gap-1.5"
            >
              <CopyIcon size={12} />
              Copy recipe JSON
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="w-full justify-start gap-1.5"
              disabled={!dirty}
              onClick={() => setDirty(false)}
            >
              <Save size={12} />
              Save Recipe
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Recipe dropdown ────────────────────────────────────────────── */

interface RecipeDropdownProps {
  recipes: ReadonlyArray<RecipeMeta>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function RecipeDropdown({
  recipes,
  activeId,
  onSelect,
  onNew,
}: RecipeDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (!open) return;
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 h-7 px-2 rounded-md text-xs",
          "border border-zinc-800 bg-zinc-900 text-zinc-200",
          "hover:bg-zinc-800 hover:text-zinc-100",
        )}
      >
        <AudioWaveform size={12} className="text-amber-400" />
        <span className="font-mono">{activeId ?? "untitled"}</span>
        <span className="text-zinc-500 ml-1">▾</span>
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full left-0 mt-1 z-30 min-w-[200px]",
            "rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1",
          )}
        >
          {recipes.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500 italic">
              No recipes yet.
            </div>
          ) : (
            recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onSelect(r.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2",
                  "hover:bg-zinc-800",
                  r.id === activeId
                    ? "text-amber-300"
                    : "text-zinc-200",
                )}
              >
                <AudioWaveform size={12} className="text-zinc-500" />
                <span className="font-mono truncate">{r.id}</span>
              </button>
            ))
          )}
          <div className="my-1 h-px bg-zinc-800" />
          <button
            type="button"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2",
              "text-amber-300 hover:bg-amber-500/10",
            )}
          >
            <Plus size={12} />
            New recipe
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Graph canvas — visual scaffold ─────────────────────────────── */

interface GraphCanvasProps {
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

function GraphCanvas({ selectedNodeId, onSelectNode }: GraphCanvasProps) {
  // Layout roughly matches SoundLab.png: two source nodes (osc + noise)
  // → an envelope shaper → a reverb → output.
  const nodes = [
    { id: "n1", op: "oscillator", x: 40, y: 60, w: 160, h: 96 },
    { id: "n2", op: "noise", x: 40, y: 220, w: 160, h: 96 },
    { id: "n3", op: "envelope", x: 270, y: 130, w: 170, h: 110 },
    { id: "n4", op: "reverb", x: 480, y: 130, w: 160, h: 110 },
    { id: "n5", op: "output", x: 680, y: 130, w: 80, h: 110 },
  ];
  const wires: ReadonlyArray<[string, string]> = [
    ["n1", "n3"],
    ["n2", "n3"],
    ["n3", "n4"],
    ["n4", "n5"],
  ];

  function pathFor(fromId: string, toId: string): string {
    const from = nodes.find((n) => n.id === fromId)!;
    const to = nodes.find((n) => n.id === toId)!;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  }

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-auto",
        "bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)]",
        "bg-[length:18px_18px]",
      )}
    >
      <div className="relative" style={{ width: 800, height: 420 }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width={800}
          height={420}
        >
          {wires.map(([a, b]) => (
            <path
              key={`${a}-${b}`}
              d={pathFor(a, b)}
              fill="none"
              stroke="rgba(245, 158, 11, 0.6)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
        {nodes.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            onClick={() => onSelectNode(node.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface GraphNodeProps {
  node: { id: string; op: string; x: number; y: number; w: number; h: number };
  selected: boolean;
  onClick: () => void;
}

function GraphNode({ node, selected, onClick }: GraphNodeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute rounded-md border bg-zinc-900 text-left",
        "transition-colors p-0 overflow-hidden flex flex-col",
        selected
          ? "border-amber-500 ring-1 ring-amber-500/40"
          : "border-zinc-700 hover:border-amber-500/40",
      )}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-2 py-1 border-b",
          selected
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-zinc-800 bg-zinc-950/50",
        )}
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-300 truncate">
          {node.op}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center bg-zinc-950">
        <Waves
          size={22}
          className={cn(
            selected ? "text-amber-400/80" : "text-zinc-700",
          )}
        />
      </div>
      <span
        className={cn(
          "absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full",
          "bg-zinc-700 border border-zinc-900",
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          "absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full",
          selected ? "bg-amber-400" : "bg-zinc-600",
          "border border-zinc-900",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/* ─── Spectrogram + waveform surfaces (visual placeholders) ──────── */

function SpectrogramSurface({ playing }: { playing: boolean }) {
  // Static gradient mimicking the colourful spectrogram in the mockup.
  // A real AnalyserNode-driven canvas is an SL3 follow-up.
  return (
    <div
      className={cn(
        "relative h-24 w-full rounded-md border border-zinc-800",
        "overflow-hidden",
        "bg-gradient-to-r from-purple-900/40 via-amber-700/40 to-red-900/40",
      )}
    >
      <div
        className={cn(
          "absolute inset-0",
          "bg-[linear-gradient(to_bottom,transparent_40%,rgba(0,0,0,0.4))]",
        )}
      />
      <div
        className={cn(
          "absolute top-1/2 left-0 right-0 h-px",
          playing ? "bg-emerald-400/50" : "bg-zinc-700",
        )}
      />
      <div className="absolute top-1 right-2 text-[10px] uppercase tracking-wider text-zinc-300/80 font-semibold">
        Spectrogram
      </div>
    </div>
  );
}

function WaveformSurface() {
  // SVG sine-like waveform to suggest live audio.
  const points = React.useMemo(() => {
    const pts: string[] = [];
    const W = 296;
    const H = 36;
    for (let x = 0; x <= W; x += 4) {
      const t = x / W;
      const y =
        H / 2 +
        Math.sin(t * Math.PI * 6) * 8 * Math.sin(t * Math.PI * 1.5) +
        (Math.sin(t * Math.PI * 18) * 3);
      pts.push(`${x},${y.toFixed(2)}`);
    }
    return pts.join(" ");
  }, []);

  return (
    <div
      className={cn(
        "relative h-12 w-full rounded-md border border-zinc-800 bg-zinc-950",
        "overflow-hidden flex items-center justify-center",
      )}
    >
      <svg width="296" height="36" viewBox="0 0 296 36">
        <polyline
          points={points}
          fill="none"
          stroke="rgb(245, 158, 11)"
          strokeWidth={1.5}
        />
      </svg>
      <div className="absolute top-1 right-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
        Waveform
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
        {label}
      </div>
      <div className="font-mono text-xs text-zinc-200 truncate">{value}</div>
    </>
  );
}
