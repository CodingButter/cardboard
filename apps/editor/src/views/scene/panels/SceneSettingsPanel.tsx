// TODO: wire to scene store. For now the panel seeds its state from
// MOCK_SCENE_SETTINGS and keeps edits in-memory only (no persistence;
// resets on remount).
import React from "react";
import { Settings, Minus, Plus, RotateCcw } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { TextInput } from "../../../components/ui/TextInput";
import { NumberInput } from "../../../components/ui/NumberInput";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_SCENE_SETTINGS,
  type SceneSettingsRow,
} from "../scene-fixtures";

/**
 * SceneSettingsPanel — per-scene metadata + global render knobs.
 *
 * Visual target: the bottom card of the right column in
 * `Editor Design/Map.png` — scene name, grid dimensions, fog density,
 * and ambient light. Rendered inside a `PanelSurface` card (DockShell
 * wraps it), so the root is layout-only — no extra card chrome.
 *
 * Responsive behaviour: a `ResizeObserver` on the panel root flips
 * each property row from `[label] [control]` to a stacked
 * `[label]\n[control]` layout below `NARROW_WIDTH_PX`. The dimensions
 * row likewise stacks its `w × h` pair vertically at narrow widths.
 * Vertical overflow uses the themed scrollbar; native horizontal
 * scroll is never introduced.
 *
 * Commands registered (`Scene` category):
 *   - `scene.settings.editName`           — focus the name input.
 *   - `scene.settings.editDimensions`     — focus the width input.
 *   - `scene.settings.fog.increase`       — step fog by +0.05 (clamped 0..1).
 *   - `scene.settings.fog.decrease`       — step fog by -0.05 (clamped 0..1).
 *   - `scene.settings.ambient.increase`   — step ambient by +0.05 (clamped 0..1).
 *   - `scene.settings.ambient.decrease`   — step ambient by -0.05 (clamped 0..1).
 *   - `scene.settings.reset`              — reset all fields to MOCK_SCENE_SETTINGS.
 */

/** Width below which property rows collapse to a single-column stacked
 *  layout. Picked to match `CellInspectorPanel`'s narrow threshold for
 *  consistency across the right column. */
const NARROW_WIDTH_PX = 220;

/** Step + bounds for the 0..1 sliders. Matches the brief's spec. */
const SLIDER_STEP = 0.05;
const SLIDER_MIN = 0;
const SLIDER_MAX = 1;

/** Minimum/maximum scene dimensions. The fixture seeds 64x64; we
 *  permit a reasonable engineering range without inviting absurd
 *  values like 0 or 1024. */
const DIM_MIN = 1;
const DIM_MAX = 256;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, n));
}

/** Round to 2 decimals so the readout doesn't end up with
 *  floating-point garbage like 0.30000000000000004. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return DIM_MIN;
  return Math.max(DIM_MIN, Math.min(DIM_MAX, Math.round(n)));
}

function seedSettings(): SceneSettingsRow {
  return {
    name: MOCK_SCENE_SETTINGS.name,
    dimensions: {
      w: MOCK_SCENE_SETTINGS.dimensions.w,
      h: MOCK_SCENE_SETTINGS.dimensions.h,
    },
    fog: MOCK_SCENE_SETTINGS.fog,
    ambient: MOCK_SCENE_SETTINGS.ambient,
  };
}

export function SceneSettingsPanel(): React.JSX.Element {
  // Local panel state — owns the mutable copy of MOCK_SCENE_SETTINGS.
  const [settings, setSettings] = React.useState<SceneSettingsRow>(
    seedSettings,
  );

  // Refs for the inputs the command palette can focus.
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const widthWrapRef = React.useRef<HTMLDivElement>(null);

  // Container width tracking for responsive layout.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number>(NARROW_WIDTH_PX + 1);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < NARROW_WIDTH_PX;

  // ────────────────────────────────────────────────────────────────
  // Mutators (used by both the UI and the registered commands).

  const setName = React.useCallback((next: string) => {
    setSettings((prev) => ({ ...prev, name: next }));
  }, []);

  const setWidthValue = React.useCallback((next: number) => {
    setSettings((prev) => ({
      ...prev,
      dimensions: { ...prev.dimensions, w: clampDim(next) },
    }));
  }, []);

  const setHeightValue = React.useCallback((next: number) => {
    setSettings((prev) => ({
      ...prev,
      dimensions: { ...prev.dimensions, h: clampDim(next) },
    }));
  }, []);

  const setFog = React.useCallback((next: number) => {
    setSettings((prev) => ({ ...prev, fog: round2(clamp01(next)) }));
  }, []);

  const bumpFog = React.useCallback((direction: 1 | -1) => {
    setSettings((prev) => ({
      ...prev,
      fog: round2(clamp01(prev.fog + direction * SLIDER_STEP)),
    }));
  }, []);

  const setAmbient = React.useCallback((next: number) => {
    setSettings((prev) => ({ ...prev, ambient: round2(clamp01(next)) }));
  }, []);

  const bumpAmbient = React.useCallback((direction: 1 | -1) => {
    setSettings((prev) => ({
      ...prev,
      ambient: round2(clamp01(prev.ambient + direction * SLIDER_STEP)),
    }));
  }, []);

  const reset = React.useCallback(() => {
    setSettings(seedSettings());
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Handler refs so the command registrations don't have to re-run
  // on every state change.
  const focusNameRef = React.useRef<() => void>(() => {});
  const focusDimsRef = React.useRef<() => void>(() => {});
  const bumpFogRef = React.useRef(bumpFog);
  const bumpAmbientRef = React.useRef(bumpAmbient);
  const resetRef = React.useRef(reset);

  React.useEffect(() => {
    focusNameRef.current = () => nameInputRef.current?.focus();
  }, []);
  React.useEffect(() => {
    focusDimsRef.current = () => {
      // Width input lives inside the wrapper div; reach the first
      // descendant input (NumberInput renders one and only one).
      const input = widthWrapRef.current?.querySelector("input");
      input?.focus();
    };
  }, []);
  React.useEffect(() => {
    bumpFogRef.current = bumpFog;
  }, [bumpFog]);
  React.useEffect(() => {
    bumpAmbientRef.current = bumpAmbient;
  }, [bumpAmbient]);
  React.useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // ────────────────────────────────────────────────────────────────
  // Static command registrations — registered once on mount.

  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.settings.editName",
        title: "Edit Scene Name",
        category: "Scene",
        keywords: ["scene", "name", "rename", "edit"],
        run: () => focusNameRef.current(),
      }),
      registerCommand({
        id: "scene.settings.editDimensions",
        title: "Edit Scene Dimensions",
        category: "Scene",
        keywords: ["scene", "dimensions", "size", "width", "height", "edit"],
        run: () => focusDimsRef.current(),
      }),
      registerCommand({
        id: "scene.settings.fog.increase",
        title: "Increase Fog Density",
        category: "Scene",
        keywords: ["scene", "fog", "increase", "density"],
        icon: <Plus size={14} />,
        run: () => bumpFogRef.current(1),
      }),
      registerCommand({
        id: "scene.settings.fog.decrease",
        title: "Decrease Fog Density",
        category: "Scene",
        keywords: ["scene", "fog", "decrease", "density"],
        icon: <Minus size={14} />,
        run: () => bumpFogRef.current(-1),
      }),
      registerCommand({
        id: "scene.settings.ambient.increase",
        title: "Increase Ambient Light",
        category: "Scene",
        keywords: ["scene", "ambient", "light", "increase", "brighten"],
        icon: <Plus size={14} />,
        run: () => bumpAmbientRef.current(1),
      }),
      registerCommand({
        id: "scene.settings.ambient.decrease",
        title: "Decrease Ambient Light",
        category: "Scene",
        keywords: ["scene", "ambient", "light", "decrease", "darken"],
        icon: <Minus size={14} />,
        run: () => bumpAmbientRef.current(-1),
      }),
      registerCommand({
        id: "scene.settings.reset",
        title: "Reset Scene Settings",
        category: "Scene",
        keywords: ["scene", "reset", "defaults", "revert"],
        icon: <RotateCcw size={14} />,
        run: () => resetRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Render.

  return (
    <div
      ref={rootRef}
      data-panel="scene-settings"
      className="h-full w-full flex flex-col gap-2 overflow-y-auto overflow-x-hidden text-(--color-fg-primary)"
    >
      {/* Header — title + reset. Reset is the only action that needs a
          chrome affordance; everything else is field-scoped. */}
      <header
        className={[
          "flex gap-2",
          narrow ? "flex-col" : "items-start justify-between",
        ].join(" ")}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
            Scene
          </div>
          <div className="font-mono text-sm text-(--color-fg-primary) truncate">
            {settings.name || "(unnamed)"}
          </div>
        </div>

        <Tooltip
          stages={[
            { delay: 2000, content: <span>Reset scene settings</span> },
            {
              delay: 5000,
              content: (
                <div className="max-w-[220px]">
                  <div className="font-semibold">Reset Scene Settings</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Restore name, dimensions, fog, and ambient back to
                    their seeded defaults. In-memory only.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label="Reset scene settings"
            onClick={reset}
            className={[
              "shrink-0 inline-flex items-center justify-center",
              "w-6 h-6 rounded border text-(--color-fg-secondary)",
              "border-(--color-border-strong) bg-transparent",
              "hover:text-(--color-fg-primary) hover:border-amber-500/60",
              "transition-colors",
            ].join(" ")}
          >
            <RotateCcw size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      </header>

      {/* Property rows. */}
      <section className="flex flex-col gap-1.5">
        {/* Name */}
        <Row label="Name" stacked={narrow}>
          <Tooltip
            stages={[
              { delay: 2000, content: <span>Scene Name</span> },
              {
                delay: 5000,
                content: (
                  <div className="max-w-[220px]">
                    <div className="font-semibold">Scene Name</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1">
                      Identifier shown in the scene picker and saved with
                      the project file.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <TextInput
              ref={nameInputRef}
              value={settings.name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Scene name"
            />
          </Tooltip>
        </Row>

        {/* Dimensions — `[w] × [h]` inline at wider widths; stacks at
            narrow widths. The width wrapper is the focus target for
            `scene.settings.editDimensions`. */}
        <Row label="Dimensions" stacked={narrow}>
          <div
            className={[
              "flex min-w-0 gap-1",
              narrow ? "flex-col" : "items-center",
            ].join(" ")}
          >
            <Tooltip
              stages={[
                { delay: 2000, content: <span>Width (tiles)</span> },
                {
                  delay: 5000,
                  content: (
                    <div className="max-w-[220px]">
                      <div className="font-semibold">Scene Width</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Width of the scene grid in tiles. Clamped to
                        {` ${DIM_MIN}..${DIM_MAX}`}.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <div ref={widthWrapRef} className="min-w-0 flex-1">
                <NumberInput
                  value={settings.dimensions.w}
                  onChange={(next) => setWidthValue(next)}
                  min={DIM_MIN}
                  max={DIM_MAX}
                  step={1}
                  precision={0}
                  aria-label="Scene width"
                />
              </div>
            </Tooltip>
            {!narrow && (
              <span
                aria-hidden="true"
                className="text-[10px] text-(--color-fg-muted) tabular-nums select-none"
              >
                ×
              </span>
            )}
            <Tooltip
              stages={[
                { delay: 2000, content: <span>Height (tiles)</span> },
                {
                  delay: 5000,
                  content: (
                    <div className="max-w-[220px]">
                      <div className="font-semibold">Scene Height</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Height of the scene grid in tiles. Clamped to
                        {` ${DIM_MIN}..${DIM_MAX}`}.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <div className="min-w-0 flex-1">
                <NumberInput
                  value={settings.dimensions.h}
                  onChange={(next) => setHeightValue(next)}
                  min={DIM_MIN}
                  max={DIM_MAX}
                  step={1}
                  precision={0}
                  aria-label="Scene height"
                />
              </div>
            </Tooltip>
          </div>
        </Row>

        {/* Fog density slider with +/- steppers. */}
        <SliderRow
          label="Fog"
          tooltipShort="Fog Density"
          tooltipLong="Overall scene fog intensity. Higher values reduce visibility at distance."
          value={settings.fog}
          onChange={setFog}
          onIncrease={() => bumpFog(1)}
          onDecrease={() => bumpFog(-1)}
          narrow={narrow}
        />

        {/* Ambient light slider with +/- steppers. */}
        <SliderRow
          label="Ambient"
          tooltipShort="Ambient Light"
          tooltipLong="Base scene lighting applied to every cell. Higher values brighten shadowed areas."
          value={settings.ambient}
          onChange={setAmbient}
          onIncrease={() => bumpAmbient(1)}
          onDecrease={() => bumpAmbient(-1)}
          narrow={narrow}
        />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Helper components                                                     */
/* -------------------------------------------------------------------- */

/** Property row — `[label] [control]` at wider widths, stacked at
 *  narrow widths. Same shape as `CellInspectorPanel.Row` so the right
 *  column reads as a cohesive property sheet. */
function Row({
  label,
  children,
  stacked,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  stacked: boolean;
}) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-1 py-0.5">
        <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
          {label}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 py-0.5">
      <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  tooltipShort: string;
  tooltipLong: string;
  value: number;
  onChange: (next: number) => void;
  onIncrease: () => void;
  onDecrease: () => void;
  narrow: boolean;
}

/** Slider row — label + `[-]` + slider + `[+]` + numeric readout.
 *  The slider absorbs slack so the row stays usable at wide widths,
 *  while the +/- steppers stay square. */
function SliderRow({
  label,
  tooltipShort,
  tooltipLong,
  value,
  onChange,
  onIncrease,
  onDecrease,
  narrow,
}: SliderRowProps) {
  const atMin = value <= SLIDER_MIN;
  const atMax = value >= SLIDER_MAX;

  const readoutNode = (
    <span className="text-[10px] font-mono tabular-nums text-(--color-fg-secondary) min-w-[2.5ch] text-right select-none">
      {value.toFixed(2)}
    </span>
  );

  const controlNode = (
    <div className="flex items-center gap-1 min-w-0">
      <Tooltip
        side="top"
        stages={[
          { delay: 2000, content: <span>{`Decrease ${label}`}</span> },
          {
            delay: 5000,
            content: (
              <div className="max-w-[220px]">
                <div className="font-semibold">{`Decrease ${tooltipShort}`}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1">
                  Step {label.toLowerCase()} down by {SLIDER_STEP.toFixed(2)}
                  {` (minimum ${SLIDER_MIN.toFixed(2)})`}.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={atMin}
          onClick={onDecrease}
          className={[
            "h-5 w-5 shrink-0 rounded",
            "flex items-center justify-center",
            "border transition-colors",
            atMin
              ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-50 cursor-not-allowed"
              : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <Minus size={10} aria-hidden="true" />
        </button>
      </Tooltip>

      <Tooltip
        side="top"
        stages={[
          { delay: 2000, content: <span>{tooltipShort}</span> },
          {
            delay: 5000,
            content: (
              <div className="max-w-[240px]">
                <div className="font-semibold">{tooltipShort}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                  {tooltipLong}
                </div>
              </div>
            ),
          },
        ]}
      >
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          aria-label={`${label} (slider)`}
          className="flex-1 min-w-0 h-5 accent-amber-500"
        />
      </Tooltip>

      <Tooltip
        side="top"
        stages={[
          { delay: 2000, content: <span>{`Increase ${label}`}</span> },
          {
            delay: 5000,
            content: (
              <div className="max-w-[220px]">
                <div className="font-semibold">{`Increase ${tooltipShort}`}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1">
                  Step {label.toLowerCase()} up by {SLIDER_STEP.toFixed(2)}
                  {` (maximum ${SLIDER_MAX.toFixed(2)})`}.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={atMax}
          onClick={onIncrease}
          className={[
            "h-5 w-5 shrink-0 rounded",
            "flex items-center justify-center",
            "border transition-colors",
            atMax
              ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-50 cursor-not-allowed"
              : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <Plus size={10} aria-hidden="true" />
        </button>
      </Tooltip>

      {readoutNode}
    </div>
  );

  return (
    <Row label={label} stacked={narrow}>
      {controlNode}
    </Row>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "scene-settings",
  title: "Scene Settings",
  icon: <Settings size={12} />,
};

export default SceneSettingsPanel;
