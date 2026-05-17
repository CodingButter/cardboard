import React from "react";
import {
  Badge,
  ChartLegend,
  CollapsibleSection,
  ColorChip,
  DropdownMenu,
  EmptyState,
  FilePicker,
  FpsGraph,
  IconButton,
  KeyValueList,
  LogPanel,
  PanelHeader,
  PieChart,
  ProgressBar,
  PropertyRow,
  ScrollArea,
  SegmentedControl,
  Select,
  Slider,
  StatsBlock,
  StatusBar,
  StatusPill,
  TabStrip,
  ToggleSwitch,
  Toolbar,
  Tooltip,
  TopBar,
  type LogLine,
} from "../components/ui/index";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../components/ui";

/**
 * StyleGuide — dev-only route for R2 visual QA.
 *
 * Renders every primitive in `apps/editor/src/components/ui/` with
 * representative props. NOT shipped in production builds (see
 * `App.tsx` for routing — the StyleGuide is intentionally not wired
 * into the live editor; mount it manually when iterating).
 *
 * To render it locally:
 *
 *   import { StyleGuide } from "./views/_StyleGuide";
 *   // then replace the App body with <StyleGuide />.
 */

export function StyleGuide() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <StyleGuideTopBar />
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-12">
        <Header />
        <SliderSection />
        <ToggleSection />
        <SegmentedControlSection />
        <PropertyRowSection />
        <PanelHeaderSection />
        <CollapsibleSectionSection />
        <ColorChipSection />
        <BadgeSection />
        <StatusPillSection />
        <IconButtonSection />
        <TabStripSection />
        <ProgressBarSection />
        <LogPanelSection />
        <StatsBlockSection />
        <KeyValueListSection />
        <FpsGraphSection />
        <DropdownMenuSection />
        <FilePickerSection />
        <PieChartSection />
        <ChartLegendSection />
        <ScrollAreaSection />
        <ToolbarSection />
        <EmptyStateSection />
        <TooltipSection />
        <SelectSection />
      </div>
      <StyleGuideStatusBar />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Header — palette swatches + scale check                               */
/* -------------------------------------------------------------------- */

function Header() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Editor primitive library — R2</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Every primitive listed in EDITOR_REDESIGN.md §4 rendered with
          representative props. Use this view to visually verify the
          design contract against the seven mockups in
          <code className="ml-1 font-mono text-zinc-200">Editor Design/</code>.
        </p>
        <div className="grid grid-cols-7 gap-2">
          {[
            ["bg-zinc-950", "app"],
            ["bg-zinc-900", "panel"],
            ["bg-zinc-800", "card"],
            ["bg-amber-500", "accent"],
            ["bg-emerald-500", "ok"],
            ["bg-red-500", "danger"],
            ["bg-sky-400", "info"],
          ].map(([cls, label]) => (
            <div
              key={label}
              className="rounded-md border border-zinc-800 overflow-hidden"
            >
              <div className={`${cls} h-12`} />
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {label}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Section wrapper                                                       */
/* -------------------------------------------------------------------- */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        {description && (
          <span className="text-xs text-zinc-500">{description}</span>
        )}
      </div>
      <Card>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Slider                                                                */
/* -------------------------------------------------------------------- */

function SliderSection() {
  const [fov, setFov] = React.useState(90);
  const [intensity, setIntensity] = React.useState(0.6);
  return (
    <Section title="1. Slider" description="amber thumb, dark track">
      <div className="grid grid-cols-2 gap-6">
        <Slider
          value={fov}
          min={30}
          max={150}
          onChange={setFov}
          valueLabel={`${fov}°`}
        />
        <Slider
          value={intensity}
          min={0}
          max={1}
          step={0.01}
          onChange={setIntensity}
          valueLabel={intensity.toFixed(2)}
          valueChipVariant="solid"
        />
        <Slider value={50} onChange={() => {}} disabled valueLabel="50" />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* ToggleSwitch                                                          */
/* -------------------------------------------------------------------- */

function ToggleSection() {
  const [solid, setSolid] = React.useState(true);
  const [fog, setFog] = React.useState(false);
  return (
    <Section title="2. ToggleSwitch" description="iOS-style">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={solid}
            onChange={setSolid}
            aria-label="Solid"
          />
          <span className="text-sm text-zinc-300">Solid</span>
        </div>
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={fog}
            onChange={setFog}
            size="sm"
            aria-label="Fog"
          />
          <span className="text-sm text-zinc-300">Fog (sm)</span>
        </div>
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked
            onChange={() => {}}
            disabled
            aria-label="Locked"
          />
          <span className="text-sm text-zinc-500">Disabled</span>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* SegmentedControl                                                      */
/* -------------------------------------------------------------------- */

function SegmentedControlSection() {
  const [mode, setMode] = React.useState<"free" | "walk" | "debug" | null>(
    "free",
  );
  return (
    <Section
      title="19. SegmentedControl"
      description="radio-style grouped toggles"
    >
      <SegmentedControl
        options={[
          { id: "free", label: "Free camera" },
          { id: "walk", label: "Half walk" },
          { id: "debug", label: "Debug view" },
        ]}
        value={mode}
        onChange={setMode}
        allowEmpty
        aria-label="Playtest mode"
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* PropertyRow                                                           */
/* -------------------------------------------------------------------- */

function PropertyRowSection() {
  const [x, setX] = React.useState("33");
  const [solid, setSolid] = React.useState(true);
  return (
    <Section title="3. PropertyRow" description="inspector workhorse">
      <PropertyRow label="Position X">
        <input
          className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 font-mono"
          value={x}
          onChange={(e) => setX(e.target.value)}
        />
      </PropertyRow>
      <PropertyRow label="Solid" hint="Blocks player movement.">
        <ToggleSwitch
          checked={solid}
          onChange={setSolid}
          aria-label="Solid"
        />
      </PropertyRow>
      <PropertyRow label="FOV" unit="DEG">
        <Slider value={90} min={30} max={150} onChange={() => {}} />
      </PropertyRow>
      <PropertyRow
        label="Background"
        labelStyle="plain"
        stacked
        hint="Used by the welcome screen."
      >
        <Select
          options={[
            { value: "sky", label: "Sky" },
            { value: "warehouse", label: "Warehouse" },
            { value: "void", label: "Void" },
          ]}
          defaultValue="sky"
        />
      </PropertyRow>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* PanelHeader                                                           */
/* -------------------------------------------------------------------- */

function PanelHeaderSection() {
  return (
    <Section title="4. PanelHeader" description="sidebar section header">
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
          <PanelHeader title="Tile presets" action={<Badge variant="zinc">12</Badge>} />
          <div className="p-3 text-sm text-zinc-500">…panel body…</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
          <PanelHeader
            title="Entities"
            size="sm"
            action={
              <IconButton
                icon={<SearchIcon />}
                tooltip="Search"
                size="sm"
              />
            }
          />
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* CollapsibleSection                                                    */
/* -------------------------------------------------------------------- */

function CollapsibleSectionSection() {
  const [enabled, setEnabled] = React.useState(true);
  return (
    <Section title="5. CollapsibleSection" description="entities inspector folds">
      <CollapsibleSection
        title="Light"
        icon={<SunIcon />}
        defaultOpen
        trailing={
          <ToggleSwitch
            checked={enabled}
            onChange={setEnabled}
            size="sm"
            aria-label="Enable light"
          />
        }
      >
        <PropertyRow label="Intensity">
          <Slider value={0.8} min={0} max={2} step={0.01} onChange={() => {}} />
        </PropertyRow>
        <PropertyRow label="Color">
          <ColorChip value="#f59e0b" onChange={() => {}} />
        </PropertyRow>
      </CollapsibleSection>
      <CollapsibleSection title="Sprite">
        <p className="text-sm text-zinc-500">…component body…</p>
      </CollapsibleSection>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* ColorChip                                                             */
/* -------------------------------------------------------------------- */

function ColorChipSection() {
  const [color, setColor] = React.useState("#f59e0b");
  return (
    <Section title="6. ColorChip">
      <div className="flex gap-3 items-center">
        <ColorChip value={color} onChange={setColor} />
        <ColorChip value={color} onChange={setColor} shape="circle" />
        <ColorChip value="#444" onChange={() => {}} disabled />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* Badge                                                                 */
/* -------------------------------------------------------------------- */

function BadgeSection() {
  return (
    <Section title="7. Badge">
      <div className="flex flex-wrap gap-2 items-center">
        <Badge variant="amber">Walls</Badge>
        <Badge variant="emerald">Live</Badge>
        <Badge variant="purple">solid</Badge>
        <Badge variant="sky">draws</Badge>
        <Badge variant="red">3</Badge>
        <Badge variant="yellow">warn</Badge>
        <Badge variant="zinc" shape="pill">
          floor
        </Badge>
        <Badge variant="amber" outlined>
          outlined
        </Badge>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* StatusPill                                                            */
/* -------------------------------------------------------------------- */

function StatusPillSection() {
  return (
    <Section title="8. StatusPill">
      <div className="flex flex-wrap gap-3 items-center">
        <StatusPill variant="ok">All changes saved</StatusPill>
        <StatusPill variant="info">Saving…</StatusPill>
        <StatusPill variant="warn">Unsaved changes</StatusPill>
        <StatusPill variant="error">Save failed</StatusPill>
        <StatusPill variant="neutral" noDot>
          Ready
        </StatusPill>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* IconButton                                                            */
/* -------------------------------------------------------------------- */

function IconButtonSection() {
  return (
    <Section title="9. IconButton">
      <div className="flex gap-2 items-center">
        <IconButton icon={<SearchIcon />} tooltip="Search" />
        <IconButton icon={<TrashIcon />} tooltip="Delete" variant="danger" />
        <IconButton icon={<PlusIcon />} tooltip="Add" variant="primary" />
        <IconButton
          icon={<SearchIcon />}
          tooltip="Search (md)"
          size="md"
          variant="secondary"
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* TabStrip                                                              */
/* -------------------------------------------------------------------- */

function TabStripSection() {
  const [primary, setPrimary] = React.useState<"home" | "scene" | "scripts">(
    "scene",
  );
  const [secondary, setSecondary] = React.useState<
    "manifest" | "deps" | "export"
  >("manifest");
  return (
    <Section title="10. TabStrip">
      <div className="space-y-4">
        <TabStrip
          variant="primary"
          tabs={[
            { id: "home", label: "Home", icon: <HomeIcon /> },
            { id: "scene", label: "Scene", icon: <GridIcon /> },
            { id: "scripts", label: "Scripts", icon: <CodeIcon /> },
          ]}
          value={primary}
          onChange={setPrimary}
          aria-label="Primary"
        />
        <TabStrip
          variant="secondary"
          tabs={[
            { id: "manifest", label: "Manifest" },
            { id: "deps", label: "Dependencies", badge: <Badge variant="red">2</Badge> },
            { id: "export", label: "Export" },
          ]}
          value={secondary}
          onChange={setSecondary}
          aria-label="Secondary"
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* ProgressBar                                                           */
/* -------------------------------------------------------------------- */

function ProgressBarSection() {
  const [v, setV] = React.useState(0.35);
  React.useEffect(() => {
    const t = setInterval(() => setV((x) => (x >= 1 ? 0.05 : x + 0.05)), 600);
    return () => clearInterval(t);
  }, []);
  return (
    <Section title="13. ProgressBar">
      <ProgressBar
        value={v}
        label="Baking lights"
        caption={`${Math.round(v * 100)}%`}
      />
      <ProgressBar value={0} indeterminate label="Importing pack" />
      <ProgressBar value={0.6} size="sm" />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* LogPanel                                                              */
/* -------------------------------------------------------------------- */

function LogPanelSection() {
  const [filter, setFilter] = React.useState<ReadonlyArray<LogLine["type"]>>([
    "info",
    "warn",
    "error",
    "success",
    "debug",
  ]);
  const lines: LogLine[] = [
    { id: "1", type: "info", time: "12:34:21", message: "Pack loaded (1.2 MB)" },
    { id: "2", type: "success", time: "12:34:22", message: "Lights baked" },
    { id: "3", type: "warn", time: "12:34:24", message: "Sprite atlas missing fallback" },
    { id: "4", type: "error", time: "12:34:25", message: "Failed to parse scene 'level2.scn'" },
    { id: "5", type: "debug", time: "12:34:26", message: "frame 1.42ms / 60fps" },
  ];
  return (
    <Section title="14. LogPanel">
      <LogPanel
        lines={lines}
        filter={filter}
        onFilterChange={setFilter}
        onClear={() => {}}
        className="h-56"
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* StatsBlock                                                            */
/* -------------------------------------------------------------------- */

function StatsBlockSection() {
  return (
    <Section title="15. StatsBlock">
      <div className="grid grid-cols-4 gap-4">
        <StatsBlock label="FPS" value="60" trend="up" emphasis="success" />
        <StatsBlock label="Draw calls" value="124" />
        <StatsBlock label="Memory" value="42 MB" trend="flat" />
        <StatsBlock label="Build" value="ERR" emphasis="error" trend="down" />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* KeyValueList                                                          */
/* -------------------------------------------------------------------- */

function KeyValueListSection() {
  return (
    <Section title="16. KeyValueList">
      <div className="grid grid-cols-2 gap-6">
        <KeyValueList
          rows={[
            { label: "Pack", value: "default" },
            { label: "Version", value: "1.4.2" },
            { label: "Size", value: "1.2 MB" },
            { label: "Last edited", value: "2 hours ago" },
          ]}
        />
        <KeyValueList
          density="dense"
          divided={false}
          rows={[
            { label: "Tilt", value: "0.4" },
            { label: "Pitch", value: "0.0" },
            { label: "Yaw", value: "1.57" },
          ]}
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* FpsGraph                                                              */
/* -------------------------------------------------------------------- */

function FpsGraphSection() {
  const [samples, setSamples] = React.useState<number[]>(
    Array.from({ length: 60 }, () => 14 + Math.random() * 6),
  );
  React.useEffect(() => {
    const t = setInterval(() => {
      setSamples((s) => [...s.slice(1), 14 + Math.random() * 12]);
    }, 100);
    return () => clearInterval(t);
  }, []);
  return (
    <Section title="17. FpsGraph">
      <FpsGraph samples={samples} target={16.67} legend="16.7ms target" />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* DropdownMenu                                                          */
/* -------------------------------------------------------------------- */

function DropdownMenuSection() {
  const [value, setValue] = React.useState("default");
  return (
    <Section title="18. DropdownMenu">
      <DropdownMenu
        trigger={
          <div className="inline-flex items-center justify-between w-56 h-9 px-3 rounded-md border border-zinc-700 bg-zinc-900 text-sm text-zinc-100">
            <span>
              {value === "default" ? "default pack" : value}
            </span>
            <ChevronIcon />
          </div>
        }
        value={value}
        options={[
          { id: "default", label: "default pack" },
          { id: "horror", label: "horror pack" },
          { id: "demo", label: "demo (disabled)", disabled: true },
        ]}
        onChange={setValue}
        width={224}
      />
      <div className="mt-3">
        <DropdownMenu
          trigger={
            <div className="inline-flex items-center justify-between w-56 h-9 px-3 rounded-md border border-zinc-700 bg-zinc-900/50 text-sm text-zinc-500">
              <span>disabled trigger</span>
              <ChevronIcon />
            </div>
          }
          value=""
          options={[]}
          onChange={() => {}}
          disabled
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* FilePicker                                                            */
/* -------------------------------------------------------------------- */

function FilePickerSection() {
  return (
    <Section title="20. FilePicker">
      <div className="space-y-4">
        <FilePicker mode="button" accept=".apg,.zip" onFiles={() => {}}>
          Choose pack…
        </FilePicker>
        <FilePicker
          mode="dropzone"
          accept="image/*"
          multiple
          onFiles={() => {}}
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* PieChart                                                              */
/* -------------------------------------------------------------------- */

function PieChartSection() {
  return (
    <Section title="21. PieChart" description="build size composition">
      <PieChart
        segments={[
          { id: "scripts", label: "Scripts", value: 240, variant: "amber" },
          { id: "sprites", label: "Sprites", value: 540, variant: "sky" },
          { id: "audio", label: "Audio", value: 180, variant: "emerald" },
          { id: "manifest", label: "Manifest", value: 40, variant: "purple" },
        ]}
        size={120}
        legend
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* ChartLegend                                                           */
/* -------------------------------------------------------------------- */

function ChartLegendSection() {
  return (
    <Section title="27. ChartLegend">
      <ChartLegend
        layout="horizontal"
        items={[
          { label: "Scripts", value: "240 kB", variant: "amber" },
          { label: "Sprites", value: "540 kB", variant: "sky" },
          { label: "Audio", value: "180 kB", variant: "emerald" },
        ]}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* ScrollArea                                                            */
/* -------------------------------------------------------------------- */

function ScrollAreaSection() {
  return (
    <Section title="22. ScrollArea">
      <ScrollArea className="h-32 border border-zinc-800 rounded-md p-3">
        {Array.from({ length: 30 }, (_, i) => (
          <div key={i} className="py-1 text-sm text-zinc-300">
            row {i + 1} — lorem ipsum dolor sit amet.
          </div>
        ))}
      </ScrollArea>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* Toolbar                                                               */
/* -------------------------------------------------------------------- */

function ToolbarSection() {
  return (
    <Section title="23. Toolbar">
      <Toolbar
        groups={[
          {
            id: "tools",
            children: (
              <>
                <IconButton icon={<PencilIcon />} tooltip="Brush" variant="primary" />
                <IconButton icon={<EraserIcon />} tooltip="Erase" />
              </>
            ),
          },
          {
            id: "layers",
            children: (
              <>
                <Badge variant="amber">Walls</Badge>
                <Badge variant="zinc">Floors</Badge>
              </>
            ),
          },
        ]}
        tail={<IconButton icon={<SettingsIcon />} tooltip="Settings" />}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* EmptyState                                                            */
/* -------------------------------------------------------------------- */

function EmptyStateSection() {
  return (
    <Section
      title="24. EmptyState"
      description="cardboard hex bg + tab glyph"
    >
      <EmptyState
        icon={<GridIcon />}
        title="No scenes yet"
        description="Create your first scene to start placing tiles."
        action={
          <>
            <Button variant="primary" size="sm">
              New scene
            </Button>
            <Button variant="secondary" size="sm">
              Import…
            </Button>
          </>
        }
        tutorial="map-getting-started"
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* Tooltip                                                               */
/* -------------------------------------------------------------------- */

function TooltipSection() {
  return (
    <Section title="25. Tooltip" description="hover delay 400ms">
      <div className="flex gap-4 items-center">
        <Tooltip content="Top tooltip" side="top">
          <button className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-sm">
            Hover top
          </button>
        </Tooltip>
        <Tooltip content="Bottom tooltip" side="bottom">
          <button className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-sm">
            Hover bottom
          </button>
        </Tooltip>
        <Tooltip content="Right side" side="right" delay={100}>
          <button className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-sm">
            Quick
          </button>
        </Tooltip>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* Select                                                                */
/* -------------------------------------------------------------------- */

function SelectSection() {
  const [value, setValue] = React.useState("classic");
  return (
    <Section title="26. Select" description="native styled select">
      <div className="flex gap-3 items-center">
        <Select
          options={[
            { value: "classic", label: "Classic 90°" },
            { value: "wide", label: "Wide 110°" },
            { value: "ultra", label: "Ultra 130°" },
          ]}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Select
          size="sm"
          options={[
            { value: "1x", label: "1.0×" },
            { value: "2x", label: "2.0×" },
          ]}
          defaultValue="1x"
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* TopBar + StatusBar — rendered around the page                         */
/* -------------------------------------------------------------------- */

function StyleGuideTopBar() {
  const [active, setActive] = React.useState(false);
  return (
    <TopBar
      projectName="default-pack"
      projects={[
        { id: "a", name: "default-pack" },
        { id: "b", name: "horror-pack" },
      ]}
      onSelectProject={() => {}}
      sceneName="main.scn"
      scenes={[
        { path: "main.scn", label: "main.scn" },
        { path: "level2.scn", label: "level2.scn" },
      ]}
      onSelectScene={() => {}}
      saveState="saved"
      playtestActive={active}
      onTogglePlaytest={() => setActive((v) => !v)}
      onExport={() => {}}
      onSave={() => {}}
      onOpenSettings={() => {}}
      userInitials="JN"
    />
  );
}

function StyleGuideStatusBar() {
  return (
    <StatusBar
      sections={[
        { id: "cell", label: "cell", value: "(33, 31, 0)" },
        { id: "layer", label: "layer", value: "Walls" },
        { id: "tile", label: "tile", value: "Brick Wall 01" },
        { id: "zoom", label: "zoom", value: "100%", align: "right" },
      ]}
    />
  );
}

/* -------------------------------------------------------------------- */
/* Inline icons (no lucide dep)                                          */
/* -------------------------------------------------------------------- */

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function EraserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20H7L3 16l9-9 9 9-5 5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2.1 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12z" />
    </svg>
  );
}
