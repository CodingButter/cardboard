import React from "react";
import {
  Box,
  Brush,
  Circle,
  Copy as CopyIcon,
  Download,
  FileImage,
  Filter,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Paintbrush,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Shuffle,
  Square as SquareIcon,
  Wand2,
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
  Tooltip,
} from "../components/ui/index";
import { Button, Input } from "../components/ui";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { useStatusBar } from "../shell/StatusBarContext";

/**
 * ImageLabView — Image Lab tab body. Implements the 4-column shell
 * defined in `docs/plans/IMAGE_LAB.md` §7.1 + matches the visual
 * language captured in `Editor Design/ImageLab.png`.
 *
 *   +-- Header toolbar (recipe selector / mode toggle / save) -----+
 *   |                                                              |
 *   |  LEFT RAIL   |   CENTER (procedural graph)   |  RIGHT RAIL  |
 *   |  (260 px)    |   (fluid)                     |  (340 px)    |
 *   |  Layers      |                               |  Live Preview |
 *   |  Ops library |   Node graph workspace        |  Node Props   |
 *   |                                                              |
 *   +-- Bottom strip (recent bakes / compiled / export) ----------+
 *
 * This view is the *editor authoring surface* (IL3+). The runtime
 * engine half (IL2) lives in `packages/engine/src/Procedural/` and is
 * preserved untouched — this view reads recipes from the project
 * store and (for now) renders them as a visual scaffold. Wiring to
 * the compiler / renderer is a follow-up; the layout matches the
 * mockup so the shell is shippable today.
 *
 * Color palette: zinc-900 panels + zinc-950 chrome + amber-500 active
 * highlights per EDITOR_REDESIGN.md §3.1.
 */

interface RecipeMeta {
  /** Path inside the project (`recipes/<id>.recipe.json`). */
  path: string;
  /** Display id — last path segment without extension. */
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
    id: "generators",
    label: "Generators",
    ops: [
      {
        id: "solid",
        label: "Solid",
        icon: <SquareIcon size={14} />,
        description: "Single-color fill.",
      },
      {
        id: "perlin-noise",
        label: "Perlin",
        icon: <Waves size={14} />,
        description: "Perlin noise.",
      },
      {
        id: "simplex-noise",
        label: "Simplex",
        icon: <Waves size={14} />,
        description: "Simplex noise.",
      },
      {
        id: "worley",
        label: "Worley",
        icon: <Circle size={14} />,
        description: "Cellular / Voronoi noise.",
      },
      {
        id: "brick-pattern",
        label: "Brick",
        icon: <Layers size={14} />,
        description: "Brick / tile pattern.",
      },
      {
        id: "checker",
        label: "Checker",
        icon: <SquareIcon size={14} />,
        description: "Checker pattern.",
      },
      {
        id: "gradient",
        label: "Gradient",
        icon: <Filter size={14} />,
        description: "Linear / radial gradient.",
      },
      {
        id: "circle",
        label: "Circle",
        icon: <Circle size={14} />,
        description: "Circle primitive.",
      },
    ],
  },
  {
    id: "modifiers",
    label: "Modifiers",
    ops: [
      {
        id: "blend",
        label: "Blend",
        icon: <GitBranch size={14} />,
        description: "Blend two images.",
      },
      {
        id: "mask",
        label: "Mask",
        icon: <SquareIcon size={14} />,
        description: "Apply a greyscale mask.",
      },
      {
        id: "color-ramp",
        label: "Color Ramp",
        icon: <Paintbrush size={14} />,
        description: "Greyscale → color ramp.",
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
        icon: <FileImage size={14} />,
        description: "Final sink — required.",
      },
    ],
  },
];

const MOCK_LAYERS = [
  { id: "n1", label: "Base Noise", op: "perlin-noise", visible: true },
  { id: "n2", label: "Worley", op: "worley", visible: true },
  { id: "n3", label: "Color Ramp", op: "color-ramp", visible: true },
  { id: "n4", label: "Output", op: "output", visible: true },
];

export interface ImageLabViewProps {
  projectId: string;
}

export function ImageLabView({ projectId }: ImageLabViewProps) {
  const [recipes, setRecipes] = React.useState<RecipeMeta[]>([]);
  const [activeRecipeId, setActiveRecipeId] = React.useState<string | null>(
    null,
  );
  const [opSearch, setOpSearch] = React.useState("");
  const [mode, setMode] = React.useState<"static" | "animated">("static");
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(
    "n2",
  );
  const [seed, setSeed] = React.useState(42);
  const [bgChecker, setBgChecker] = React.useState<
    "checker" | "black" | "white"
  >("checker");
  const [zoom, setZoom] = React.useState<"1x" | "2x" | "4x">("1x");
  const [dirty, setDirty] = React.useState(false);

  // Live-tunable mock parameters for the right-rail Node Properties.
  const [scale, setScale] = React.useState(64);
  const [contrast, setContrast] = React.useState(50);
  const [octaves, setOctaves] = React.useState(4);

  // Load the recipe list for this project. Recipes are JSON files
  // matching `*.recipe.json` (and `*.sound.recipe.json` for sound lab,
  // which we filter out here).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assets = await EditorProjectStore.listAssets(projectId);
        if (cancelled) return;
        const recipes = assets
          .filter(
            (a) =>
              a.path.endsWith(".recipe.json") &&
              !a.path.endsWith(".sound.recipe.json"),
          )
          .map((a) => {
            const slash = a.path.lastIndexOf("/");
            const tail = slash === -1 ? a.path : a.path.slice(slash + 1);
            const id = tail.replace(/\.recipe\.json$/, "");
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
        // Silent — empty project just shows no recipes.
      }
    })();
    return () => {
      cancelled = true;
    };
    // activeRecipeId intentionally omitted — only initial load picks default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // StatusBar telemetry — recipe count + active recipe + dirty state.
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    setSections([
      {
        id: "il-count",
        label: "Recipes",
        value: String(recipes.length),
      },
      {
        id: "il-active",
        label: "Active",
        value: activeRecipeId ?? "—",
      },
      {
        id: "il-mode",
        label: "Mode",
        value: mode === "animated" ? "Animated" : "Static",
      },
      {
        id: "il-state",
        label: "State",
        value: dirty ? "Unsaved" : "Saved",
        align: "right",
      },
    ]);
    return () => setSections([]);
  }, [recipes.length, activeRecipeId, mode, dirty, setSections]);

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
    // Stub: real flow writes a starter recipe JSON to IDB; for now we
    // simply tag the editor dirty so the Save affordance lights up.
    setDirty(true);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col">
      {/* ─── Header toolbar (§7.1.7) ─────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 h-12 px-3 shrink-0",
          "bg-zinc-950 border-b border-zinc-800",
        )}
      >
        <div className="flex items-center gap-2">
          <Wand2 size={14} className="text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
            Image Lab
          </span>
        </div>

        <div className="h-6 w-px bg-zinc-800" />

        <RecipeDropdown
          recipes={recipes}
          activeId={activeRecipeId}
          onSelect={setActiveRecipeId}
          onNew={onNewRecipe}
        />

        <SegmentedControl<"static" | "animated">
          size="sm"
          aria-label="Recipe mode"
          value={mode}
          onChange={(v) => v && setMode(v)}
          options={[
            { id: "static", label: "Static" },
            { id: "animated", label: "Animated" },
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
          <Tooltip content="Randomize seed">
            <IconButton
              icon={<Shuffle size={12} />}
              tooltip="Randomize seed"
              variant="ghost"
              onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
            />
          </Tooltip>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tooltip content="Re-bake (Cmd/Ctrl+B)">
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

      {/* ─── Body — 4-column grid (left rail / center / right rail) ─ */}
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
                              `imagelab:op:${op.id}`,
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

        {/* CENTER — Procedural Graph workspace */}
        <section className="min-h-0 min-w-0 flex flex-col overflow-hidden bg-zinc-950">
          <PanelHeader
            title="Procedural Graph"
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

        {/* RIGHT RAIL — Live preview (top) + Node properties (bottom) */}
        <aside className="min-h-0 flex flex-col border-l border-zinc-800 bg-zinc-950/60">
          <PanelHeader
            title="Live Preview"
            action={
              <Badge variant="emerald" outlined>
                {zoom}
              </Badge>
            }
          />
          <div className="px-3 pb-3 pt-1 space-y-2 border-b border-zinc-800">
            <div className="flex items-center gap-1">
              <SegmentedControl<"1x" | "2x" | "4x">
                size="sm"
                aria-label="Preview zoom"
                value={zoom}
                onChange={(v) => v && setZoom(v)}
                options={[
                  { id: "1x", label: "1x" },
                  { id: "2x", label: "2x" },
                  { id: "4x", label: "4x" },
                ]}
              />
              <SegmentedControl<"checker" | "black" | "white">
                size="sm"
                aria-label="Preview background"
                value={bgChecker}
                onChange={(v) => v && setBgChecker(v)}
                options={[
                  { id: "checker", label: "Chk" },
                  { id: "black", label: "Blk" },
                  { id: "white", label: "Wht" },
                ]}
              />
            </div>
            <PreviewSurface background={bgChecker} />
            <div className="grid grid-cols-3 gap-2">
              <StatsBlock label="Size" value="128×128" />
              <StatsBlock label="Bake" value="0.9 ms" />
              <StatsBlock label="Cache" value="hit" />
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
                      <span>Scale</span>
                      <span className="font-mono text-zinc-300">{scale}</span>
                    </div>
                    <Slider
                      min={1}
                      max={256}
                      step={1}
                      value={scale}
                      onChange={(v) => {
                        setScale(v);
                        setDirty(true);
                      }}
                    />
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Contrast</span>
                      <span className="font-mono text-zinc-300">
                        {contrast}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={contrast}
                      onChange={(v) => {
                        setContrast(v);
                        setDirty(true);
                      }}
                    />
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                      <span>Octaves</span>
                      <span className="font-mono text-zinc-300">
                        {octaves}
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={8}
                      step={1}
                      value={octaves}
                      onChange={(v) => {
                        setOctaves(v);
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

      {/* ─── Bottom strip — Recent bakes / Compiled / Export ─────── */}
      <div className="flex h-[180px] shrink-0 border-t border-zinc-800 bg-zinc-950">
        <div className="w-[260px] shrink-0 flex flex-col border-r border-zinc-800">
          <PanelHeader
            title="Recent Bakes"
            action={
              <Badge variant="zinc" outlined>
                4
              </Badge>
            }
          />
          <ScrollArea fade={false} className="flex-1 min-h-0">
            <div className="px-3 py-2 flex gap-2 overflow-x-auto">
              {[1, 2, 3, 4].map((i) => (
                <button
                  key={i}
                  type="button"
                  className={cn(
                    "shrink-0 w-20 h-20 rounded-md border border-zinc-800 bg-zinc-900",
                    "flex items-center justify-center text-zinc-600",
                    "hover:border-amber-500/40 hover:text-amber-300",
                    "transition-colors",
                  )}
                  title={`Recent bake ${i}`}
                >
                  <ImageIcon size={20} />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 min-w-0 flex flex-col border-r border-zinc-800">
          <PanelHeader title="Compiled Output" />
          <div className="flex-1 min-h-0 p-3 grid grid-cols-2 gap-x-4 gap-y-2 content-start text-xs">
            <DetailRow label="Output size" value="128×128 RGBA" />
            <DetailRow label="GLSL size" value="2.4 KB" />
            <DetailRow label="Compile time" value="1.8 ms" />
            <DetailRow label="Bake time" value="0.9 ms" />
            <DetailRow label="Node count" value="4" />
            <DetailRow label="Hash" value="sha:8e3f…91a2" />
          </div>
          <div className="px-3 pb-2">
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Brush size={12} />
              View GLSL
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
              Export PNG
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

/* ─── Recipe dropdown — minimal inline implementation ───────────── */

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
        <ImageIcon size={12} className="text-amber-400" />
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
                <ImageIcon size={12} className="text-zinc-500" />
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

/* ─── Graph canvas — visual scaffold (no real layout engine yet) ── */

interface GraphCanvasProps {
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

function GraphCanvas({ selectedNodeId, onSelectNode }: GraphCanvasProps) {
  // Static positions roughly matching the ImageLab.png mockup layout:
  // two generator nodes (left), a worley/blend cluster (center), an
  // output node (right). Real graph layout + drag is a follow-up.
  const nodes = [
    { id: "n1", op: "perlin-noise", x: 40, y: 60, w: 160, h: 96 },
    { id: "n2", op: "worley", x: 40, y: 220, w: 160, h: 96 },
    { id: "n3", op: "color-ramp", x: 280, y: 130, w: 180, h: 110 },
    { id: "n4", op: "output", x: 540, y: 130, w: 140, h: 110 },
  ];
  const wires: ReadonlyArray<[string, string]> = [
    ["n1", "n3"],
    ["n2", "n3"],
    ["n3", "n4"],
  ];

  // Compute a wire path between two node centers (output port → input port).
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
      <div className="relative" style={{ width: 760, height: 420 }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width={760}
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
        <ImageIcon
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

/* ─── Preview surface ────────────────────────────────────────────── */

function PreviewSurface({
  background,
}: {
  background: "checker" | "black" | "white";
}) {
  const bgStyle = React.useMemo<React.CSSProperties>(() => {
    if (background === "black") return { background: "#000" };
    if (background === "white") return { background: "#fff" };
    return {
      backgroundImage:
        "linear-gradient(45deg, #1f1f23 25%, transparent 25%), linear-gradient(-45deg, #1f1f23 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f1f23 75%), linear-gradient(-45deg, transparent 75%, #1f1f23 75%)",
      backgroundSize: "12px 12px",
      backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
    };
  }, [background]);

  return (
    <div
      className={cn(
        "relative aspect-square w-full rounded-md border border-zinc-800",
        "flex items-center justify-center overflow-hidden",
      )}
      style={bgStyle}
    >
      <div className="absolute inset-3 rounded-sm bg-gradient-to-br from-amber-900/40 via-zinc-800/60 to-zinc-900 border border-zinc-800/60" />
      <ImageIcon size={28} className="relative text-amber-400/40" />
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

