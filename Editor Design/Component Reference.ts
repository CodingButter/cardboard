import {
  Box,
  Code2,
  Cuboid,
  FileJson,
  Film,
  Folder,
  Gamepad2,
  Grid3X3,
  Home,
  ImageIcon,
  Layers,
  Package,
  Play,
  Plus,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Upload,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const navItems = [
  { label: "Home", icon: Home },
  { label: "Map", icon: Grid3X3, active: true },
  { label: "Entities", icon: Cuboid },
  { label: "Assets", icon: ImageIcon },
  { label: "Scripts", icon: Code2 },
  { label: "Animation", icon: Film },
  { label: "Project", icon: Package },
];

export default function RaycastEditorReference() {
  return (
    <div className="min-h-screen bg-[#08090b] text-zinc-100">
      <EditorShell />
    </div>
  );
}

function EditorShell() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,#17120a_0,#08090b_36%,#050607_100%)]">
      <TopBar />
      <MainNav />

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_380px] border-t border-zinc-800/80">
        <AssetSidebar />
        <MapCanvasPanel />
        <InspectorPanel />
      </div>

      <StatusConsole />
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex h-20 items-center gap-4 border-b border-zinc-800/80 bg-black/40 px-5 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl border border-amber-500/50 bg-amber-500/10 text-amber-400">
          <Box className="size-5" />
        </div>

        <div>
          <div className="text-lg font-black tracking-wide">RAYCAST</div>
          <div className="-mt-1 text-xs font-bold uppercase tracking-[0.25em] text-amber-400">
            Editor
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-2 h-10 bg-zinc-800" />

      <div className="grid w-56 gap-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Project
        </div>
        <Select defaultValue="my-pack">
          <SelectTrigger className="h-9 border-zinc-800 bg-zinc-950/80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="my-pack">my-pack</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid w-56 gap-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Scene
        </div>
        <Select defaultValue="scene1">
          <SelectTrigger className="h-9 border-zinc-800 bg-zinc-950/80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="scene1">scene1</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <span className="size-2 rounded-full bg-emerald-500" />
          All changes saved
        </div>

        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          <Play className="mr-2 size-4" />
          Playtest
        </Button>

        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          <Upload className="mr-2 size-4" />
          Export
        </Button>

        <Button className="bg-amber-500 text-black hover:bg-amber-400">
          <Save className="mr-2 size-4" />
          Save
        </Button>

        <Button variant="outline" size="icon" className="border-zinc-800 bg-zinc-950">
          <Settings className="size-4" />
        </Button>

        <div className="grid size-10 place-items-center rounded-full border border-zinc-800 bg-slate-950 text-sm font-semibold text-sky-300">
          JD
        </div>
      </div>
    </header>
  );
}

function MainNav() {
  return (
    <nav className="flex h-14 items-center gap-1 border-b border-zinc-800/80 bg-zinc-950/60 px-5">
      {navItems.map((item) => {
        const Icon = item.icon;

        return (
          <Button
            key={item.label}
            variant="ghost"
            className={[
              "h-14 rounded-none border-b-2 px-5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              item.active
                ? "border-amber-400 bg-amber-500/5 text-amber-400"
                : "border-transparent",
            ].join(" ")}
          >
            <Icon className="mr-2 size-4" />
            {item.label}
          </Button>
        );
      })}

      <div className="ml-auto flex items-center gap-8 text-xs uppercase tracking-wider text-zinc-500">
        <div>
          Raycast Mode{" "}
          <span className="ml-2 font-bold text-amber-400">Classic 90°</span>
        </div>
        <div>
          Grid <span className="ml-2 font-bold text-amber-400">16 × 16</span>
        </div>
        <div>
          Zoom <span className="ml-2 font-bold text-amber-400">100%</span>
        </div>
      </div>
    </nav>
  );
}

function AssetSidebar() {
  return (
    <aside className="min-h-0 border-r border-zinc-800/80 bg-zinc-950/70">
      <div className="border-b border-zinc-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Tile Presets
          </h2>

          <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-400">
            <Plus className="mr-1 size-4" />
            New
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-zinc-500" />
          <Input
            placeholder="Search tiles..."
            className="border-zinc-800 bg-black/40 pl-9"
          />
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-260px)]">
        <div className="space-y-6 p-4">
          <TileSection title="Walls" count={24} />
          <TileSection title="Floors" count={18} />
          <TileSection title="Ceilings" count={12} />
          <TileSection title="Doors" count={6} />
          <TileSection title="Decor" count={12} />
        </div>
      </ScrollArea>
    </aside>
  );
}

function TileSection({ title, count }: { title: string; count: number }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-zinc-500">
        <span>{title}</span>
        <span>{count}</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <button
            key={index}
            className={[
              "aspect-square rounded-md border bg-zinc-900/80 p-1 transition hover:border-amber-400",
              index === 0 ? "border-amber-400" : "border-zinc-800",
            ].join(" ")}
          >
            <div className="h-full rounded-sm bg-[linear-gradient(135deg,#3a3328,#171717_55%,#4a3b25)] shadow-inner" />
          </button>
        ))}
      </div>
    </section>
  );
}

function MapCanvasPanel() {
  return (
    <main className="min-w-0 bg-[#0b0d10]">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
        <ToolButton label="Select" />
        <ToolButton label="Paint" active />
        <ToolButton label="Entity" />
        <ToolButton label="Light" />

        <Separator orientation="vertical" className="mx-3 h-7 bg-zinc-800" />

        <Badge className="bg-amber-500/10 text-amber-400 hover:bg-amber-500/10">
          Walls
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          Floors
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          Ceilings
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          Entities
        </Badge>

        <div className="ml-auto text-xs text-zinc-500">scenes/scene1.json</div>
      </div>

      <div className="relative h-[calc(100vh-260px)] overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="absolute left-12 top-10 grid grid-cols-24 gap-0">
          {Array.from({ length: 24 * 16 }).map((_, index) => {
            const isWall =
              index < 24 ||
              index > 24 * 15 ||
              index % 24 === 0 ||
              index % 24 === 23 ||
              [83, 84, 85, 110, 134, 135, 136, 210, 211, 235].includes(index);

            return (
              <div
                key={index}
                className={[
                  "size-8 border border-black/30",
                  isWall
                    ? "bg-[linear-gradient(135deg,#4b4234,#151515)]"
                    : "bg-zinc-900/70",
                ].join(" ")}
              />
            );
          })}
        </div>

        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/60 p-2 backdrop-blur">
          <Badge className="bg-amber-500/10 text-amber-400">Walls</Badge>
          <Badge className="bg-emerald-500/10 text-emerald-400">Floors</Badge>
          <Badge className="bg-sky-500/10 text-sky-400">Ceilings</Badge>
          <Badge className="bg-purple-500/10 text-purple-300">Entities</Badge>
          <Badge className="bg-yellow-500/10 text-yellow-300">Lights</Badge>
        </div>
      </div>
    </main>
  );
}

function ToolButton({
  label,
  active,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      className={
        active
          ? "bg-amber-500 text-black hover:bg-amber-400"
          : "border-zinc-800 bg-zinc-950 text-zinc-300"
      }
    >
      {label}
    </Button>
  );
}

function InspectorPanel() {
  return (
    <aside className="min-h-0 border-l border-zinc-800/80 bg-zinc-950/70">
      <ScrollArea className="h-[calc(100vh-190px)]">
        <div className="space-y-4 p-4">
          <PreviewCard />
          <CellInspectorCard />
          <SceneSettingsCard />
          <QuickToolsCard />
        </div>
      </ScrollArea>
    </aside>
  );
}

function PreviewCard() {
  return (
    <Card className="border-zinc-800 bg-black/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm uppercase tracking-wider text-zinc-300">
          3D Preview
        </CardTitle>
        <Badge className="bg-emerald-500/10 text-emerald-400">Live</Badge>
      </CardHeader>

      <CardContent>
        <div className="aspect-video rounded-lg border border-zinc-800 bg-[radial-gradient(circle_at_center,#4a3720,#111_70%)]" />

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-zinc-500">FOV</span>
          <Slider defaultValue={[90]} max={120} min={60} step={1} />
          <Badge variant="outline" className="border-zinc-700">
            90°
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CellInspectorCard() {
  return (
    <Card className="border-zinc-800 bg-black/30">
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wider text-zinc-300">
          Cell Inspector
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500">
          <InfoValue label="X" value="33" />
          <InfoValue label="Y" value="31" />
          <InfoValue label="Z" value="0" />
        </div>

        <Field label="Layer">
          <Select defaultValue="walls">
            <SelectTrigger className="border-zinc-800 bg-zinc-950">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="walls">Walls</SelectItem>
              <SelectItem value="floors">Floors</SelectItem>
              <SelectItem value="ceilings">Ceilings</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Tile">
          <Select defaultValue="brick-wall-01">
            <SelectTrigger className="border-zinc-800 bg-zinc-950">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brick-wall-01">Brick Wall 01</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleRow label="Solid" enabled />
        <ToggleRow label="Block Light" enabled />

        <Field label="Height">
          <Input value="64" readOnly className="border-zinc-800 bg-zinc-950" />
        </Field>

        <div className="flex gap-2">
          <Badge className="bg-purple-500/10 text-purple-300">wall</Badge>
          <Badge className="bg-purple-500/10 text-purple-300">solid</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function SceneSettingsCard() {
  return (
    <Card className="border-zinc-800 bg-black/30">
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wider text-zinc-300">
          Scene Settings
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <Field label="Ambient Light">
          <Slider defaultValue={[25]} max={100} step={1} />
        </Field>

        <Field label="Brightness">
          <Slider defaultValue={[100]} max={200} step={1} />
        </Field>

        <ToggleRow label="Fog" />
      </CardContent>
    </Card>
  );
}

function QuickToolsCard() {
  return (
    <Card className="border-zinc-800 bg-black/30">
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wider text-zinc-300">
          Quick Tools
        </CardTitle>
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          Fill Area
        </Button>
        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          Replace
        </Button>
        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          Erase
        </Button>
        <Button variant="outline" className="border-zinc-800 bg-zinc-950">
          Clear
        </Button>
      </CardContent>
    </Card>
  );
}

function StatusConsole() {
  return (
    <footer className="grid h-28 grid-cols-[1fr_420px] border-t border-zinc-800 bg-black/50">
      <div>
        <Tabs defaultValue="output" className="h-full">
          <TabsList className="h-10 rounded-none border-b border-zinc-800 bg-transparent px-4">
            <TabsTrigger
              value="output"
              className="data-[state=active]:bg-transparent data-[state=active]:text-amber-400"
            >
              Output
            </TabsTrigger>
            <TabsTrigger
              value="problems"
              className="data-[state=active]:bg-transparent data-[state=active]:text-amber-400"
            >
              Problems
            </TabsTrigger>
            <TabsTrigger
              value="search"
              className="data-[state=active]:bg-transparent data-[state=active]:text-amber-400"
            >
              Search
            </TabsTrigger>
          </TabsList>

          <div className="px-4 py-2 font-mono text-xs text-zinc-500">
            <div>[12:34:21] Project "my-pack" loaded successfully.</div>
            <div>[12:34:22] Scene "scene1" loaded. 4 entities, 128 cells.</div>
            <div className="text-emerald-400">[12:34:23] Ready.</div>
          </div>
        </Tabs>
      </div>

      <div className="grid grid-cols-4 border-l border-zinc-800 text-xs">
        <InfoValue label="Position" value="(33, 31, 0)" />
        <InfoValue label="Cell" value="Brick Wall 01" />
        <InfoValue label="Layer" value="Walls" />
        <InfoValue label="Selection" value="1 cell" />
      </div>
    </footer>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  enabled,
}: {
  label: string;
  enabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-300">{label}</span>
      <Switch checked={enabled} />
    </div>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid place-items-center border-r border-zinc-800 px-4 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-zinc-200">{value}</div>
    </div>
  );
}

/**
 * Optional page examples below.
 * These are static sections you can mount in place of MapCanvasPanel.
 */

export function HomeProjectPageReference() {
  return (
    <div className="grid min-h-screen grid-cols-[1.2fr_1fr] gap-5 bg-[#08090b] p-6 text-zinc-100">
      <Card className="border-zinc-800 bg-zinc-950/70">
        <CardHeader>
          <CardTitle>Recent Projects</CardTitle>
          <p className="text-sm text-zinc-500">Pick up where you left off.</p>
        </CardHeader>

        <CardContent className="space-y-3">
          {["my-pack", "dungeon-crawl", "cyber-outpost", "test-lab"].map(
            (project, index) => (
              <div
                key={project}
                className={[
                  "grid grid-cols-[180px_1fr_auto] items-center gap-4 rounded-lg border p-3",
                  index === 0
                    ? "border-amber-400 bg-amber-500/5"
                    : "border-zinc-800 bg-black/20",
                ].join(" ")}
              >
                <div className="aspect-video rounded-md bg-[radial-gradient(circle,#4a3720,#101010)]" />
                <div>
                  <div className="text-lg font-semibold">{project}</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    Last edited today, 2:41 PM
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="outline">0.2.0</Badge>
                    <Badge variant="outline">two_5_d@0.1</Badge>
                  </div>
                </div>
                <Button size="icon" className="bg-amber-500 text-black">
                  <Play className="size-4" />
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle>Create or Import</CardTitle>
            <p className="text-sm text-zinc-500">
              Start a new project or load an existing pack.
            </p>
          </CardHeader>

          <CardContent className="space-y-3">
            <Button className="h-14 w-full justify-start bg-amber-500 text-black hover:bg-amber-400">
              <Plus className="mr-3 size-5" />
              New Project
            </Button>
            <Button
              variant="outline"
              className="h-14 w-full justify-start border-zinc-800 bg-black/30"
            >
              <Upload className="mr-3 size-5" />
              Import Pack
            </Button>
            <Button
              variant="outline"
              className="h-14 w-full justify-start border-zinc-800 bg-black/30"
            >
              <Folder className="mr-3 size-5" />
              Open URL Pack
            </Button>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>

          <CardContent className="grid grid-cols-3 gap-3">
            {["Empty", "Classic Dungeon", "Sci-Fi Base"].map((template) => (
              <div
                key={template}
                className="rounded-lg border border-zinc-800 bg-black/30 p-3 hover:border-amber-400"
              >
                <div className="mb-3 aspect-video rounded bg-zinc-900" />
                <div className="font-semibold">{template}</div>
                <div className="text-sm text-zinc-500">Quick start preset</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AssetLibraryPageReference() {
  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr_360px] bg-[#08090b] text-zinc-100">
      <aside className="border-r border-zinc-800 bg-zinc-950/70 p-4">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-2.5 size-4 text-zinc-500" />
          <Input className="border-zinc-800 bg-black/40 pl-9" placeholder="Search assets..." />
        </div>

        {[
          "All Assets",
          "Textures",
          "Wall Textures",
          "Floor Textures",
          "Ceiling Textures",
          "Sprites",
          "Pickups",
          "Weapons",
          "Enemies",
          "Audio",
          "Prefabs",
        ].map((item, index) => (
          <div
            key={item}
            className={[
              "flex items-center justify-between rounded-md px-3 py-2 text-sm",
              index === 2 ? "bg-amber-500/10 text-amber-400" : "text-zinc-400",
            ].join(" ")}
          >
            <span>{item}</span>
            <span className="text-xs text-zinc-600">{Math.floor(Math.random() * 200)}</span>
          </div>
        ))}
      </aside>

      <main className="p-5">
        <div className="mb-5 flex items-center gap-3">
          <Button className="bg-amber-500 text-black hover:bg-amber-400">
            <Upload className="mr-2 size-4" />
            Import Files
          </Button>
          <Button variant="outline" className="border-zinc-800 bg-zinc-950">
            <Folder className="mr-2 size-4" />
            New Folder
          </Button>
          <Button variant="outline" className="border-zinc-800 bg-zinc-950">
            <WandSparkles className="mr-2 size-4" />
            Generate Preview
          </Button>
        </div>

        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 36 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border border-zinc-800 bg-black/30 p-2 hover:border-amber-400"
            >
              <div className="aspect-video rounded bg-[linear-gradient(135deg,#4a3b25,#111)]" />
              <div className="mt-2 truncate text-center text-xs text-zinc-400">
                brick_wall_{String(index + 1).padStart(2, "0")}
              </div>
            </div>
          ))}
        </div>
      </main>

      <aside className="border-l border-zinc-800 bg-zinc-950/70 p-4">
        <Card className="border-zinc-800 bg-black/30">
          <CardHeader>
            <CardTitle>Asset Inspector</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="aspect-video rounded-lg bg-[linear-gradient(135deg,#4a3b25,#111)]" />
            <InfoLine label="Name" value="brick_wall_01.png" />
            <InfoLine label="Type" value="Texture" />
            <InfoLine label="Dimensions" value="64 × 64" />
            <InfoLine label="Used In" value="12 maps, 4 prefabs" />

            <Button variant="outline" className="w-full border-zinc-800 bg-zinc-950">
              Rename
            </Button>
            <Button variant="destructive" className="w-full">
              Delete
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-zinc-800 pb-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}