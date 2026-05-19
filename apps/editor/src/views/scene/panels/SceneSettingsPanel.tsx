// TODO: wire to scene store. For now the panel seeds its state from
// MOCK_SCENE_SETTINGS and keeps edits in-memory only (no persistence;
// resets on remount).
import React from "react";
import { Settings, Minus, Plus, RotateCcw } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { NumberInput } from "../../../components/ui/NumberInput";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_SCENE_SETTINGS,
  type SceneSettingsRow,
} from "../scene-fixtures";

/**
 * SceneSettingsPanel — per-scene render knobs.
 *
 * Visual target: the bottom card of the right column in
 * `Editor Design/Map.png`. Fog density and ambient light are the two
 * most-tuned scene-level parameters in a Wolfenstein-style raycaster
 * and MUST be visible without scrolling at the panel's default size
 * (~180×160). Dimensions + a discreet reset round out the panel.
 *
 * Layout principle: every row is a single ~22px line of
 * `[small label] [control] [value]`. No oversized header, no
 * `NAME` field (name is editable in the project tree elsewhere),
 * no stacked label-above-control variants — at narrow widths the
 * sliders themselves are flex-1 so they shrink before anything else.
 *
 * Commands registered (`Scene` category):
 *   - `scene.settings.editName`           — focus the dimensions input
 *                                            (name field removed; this
 *                                            now falls through to the
 *                                            first focusable control).
 *   - `scene.settings.editDimensions`     — focus the width input.
 *   - `scene.settings.fog.increase`       — step fog by +0.05 (clamped 0..1).
 *   - `scene.settings.fog.decrease`       — step fog by -0.05 (clamped 0..1).
 *   - `scene.settings.ambient.increase`   — step ambient by +0.05 (clamped 0..1).
 *   - `scene.settings.ambient.decrease`   — step ambient by -0.05 (clamped 0..1).
 *   - `scene.settings.reset`              — reset all fields to MOCK_SCENE_SETTINGS.
 */

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

  // Ref for the dimensions width input — the focus target for both
  // `scene.settings.editDimensions` and (since the name field is gone)
  // `scene.settings.editName`. The latter command is preserved for
  // backwards-compatible registration but no longer has a dedicated
  // input to focus inside this panel.
  const widthWrapRef = React.useRef<HTMLDivElement>(null);

  // ────────────────────────────────────────────────────────────────
  // Mutators (used by both the UI and the registered commands).

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
  const focusDimsRef = React.useRef<() => void>(() => {});
  const bumpFogRef = React.useRef(bumpFog);
  const bumpAmbientRef = React.useRef(bumpAmbient);
  const resetRef = React.useRef(reset);

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
        // Name field lives outside this panel; the closest in-panel
        // focus target is the dimensions input.
        run: () => focusDimsRef.current(),
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
      data-panel="scene-settings"
      className="h-full w-full flex flex-col gap-1 overflow-y-auto overflow-x-hidden text-(--color-fg-primary)"
    >
      {/* Eyebrow header — panel name + Reset action. */}
      <div className="flex items-center justify-between h-[18px]">
        <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) select-none">
          Scene Settings
        </div>
        <Tooltip
          wrapperClassName="shrink-0"
          stages={[
            { delay: 1000, content: <span>Reset scene settings</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Reset Scene Settings</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Restore dimensions, fog, and ambient back to their
                    seeded defaults. In-memory only.
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
              "w-4 h-4 rounded border text-(--color-fg-secondary)",
              "border-(--color-border-strong) bg-transparent",
              "hover:text-(--color-fg-primary) hover:border-amber-500/60",
              "transition-colors",
            ].join(" ")}
          >
            <RotateCcw size={10} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {/* Fog density — top of the panel so it's never below the fold. */}
      <SliderRow
        label="Fog"
        tooltipShort="Fog Density"
        tooltipLong="Overall scene fog intensity. Higher values reduce visibility at distance."
        value={settings.fog}
        onChange={setFog}
      />

      {/* Ambient light. */}
      <SliderRow
        label="Ambient"
        tooltipShort="Ambient Light"
        tooltipLong="Base scene lighting applied to every cell. Higher values brighten shadowed areas."
        value={settings.ambient}
        onChange={setAmbient}
      />

      {/* Dimensions — inline `[w] × [h]` pair on a single row. */}
      <div className="flex items-center gap-1.5 h-[22px]">
        <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) w-[40px] shrink-0 select-none">
          Size
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Tooltip
            wrapperClassName="flex-1 min-w-0"
            stages={[
              { delay: 1000, content: <span>Width (tiles)</span> },
              {
                delay: 3000,
                content: (
                  <div className="max-w-[400px]">
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
          <span
            aria-hidden="true"
            className="text-[10px] text-(--color-fg-muted) tabular-nums select-none shrink-0"
          >
            ×
          </span>
          <Tooltip
            wrapperClassName="flex-1 min-w-0"
            stages={[
              { delay: 1000, content: <span>Height (tiles)</span> },
              {
                delay: 3000,
                content: (
                  <div className="max-w-[400px]">
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
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Helper components                                                     */
/* -------------------------------------------------------------------- */

interface SliderRowProps {
  label: string;
  tooltipShort: string;
  tooltipLong: string;
  value: number;
  onChange: (next: number) => void;
}

/** Slider row — `[label] [slider flex-1] [value]` on a single
 *  ~22px line. Label has a fixed-ish width so Fog/Ambient align; the
 *  slider absorbs all slack so the row stays usable at every width.
 *  Step adjustments are reachable via arrow keys on the slider and via
 *  the registered `scene.settings.<fog|ambient>.<increase|decrease>`
 *  commands in the command palette. */
function SliderRow({
  label,
  tooltipShort,
  tooltipLong,
  value,
  onChange,
}: SliderRowProps) {
  return (
    <div className="flex items-center gap-1.5 h-[22px]">
      <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) w-[40px] shrink-0 select-none">
        {label}
      </span>

      <Tooltip
        side="top"
        wrapperClassName="flex-1 min-w-0"
        stages={[
          { delay: 1000, content: <span>{tooltipShort}</span> },
          {
            delay: 3000,
            content: (
              <div className="max-w-[400px]">
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
          className="flex-1 min-w-0 h-4 accent-amber-500"
        />
      </Tooltip>

      <span className="text-[10px] font-mono tabular-nums text-(--color-fg-secondary) w-[28px] text-right select-none shrink-0">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "scene-settings",
  title: "Scene Settings",
  icon: <Settings size={12} />,
};

export default SceneSettingsPanel;
