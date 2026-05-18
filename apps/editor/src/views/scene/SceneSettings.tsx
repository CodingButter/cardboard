/**
 * SceneSettings — Scene page right-rail card body.
 *
 * Phase 2 Wave A stub: this file extracts the existing inline
 * Ambient / Brightness / Fog control stack out of `MapView.tsx` so the
 * layout file shrinks and Wave B has a single page-local component to
 * refine.
 *
 * Wave B will:
 *  - Promote this into a richer Scene Settings surface (fog colour /
 *    density, sky tint, render config presets, etc.).
 *  - Wire the values to `editScene.renderConfig` once the engine
 *    ships per-scene render config (today the values live in
 *    localStorage via `useLocalStorage` keyed under `editor.scene.*`).
 *
 * Until then, the component is a thin functional stub that renders the
 * same three controls the previous inline JSX did, so the page keeps
 * working without errors.
 *
 * Mockup: `Editor Design/Map.png` (right-rail card 3 — "SCENE SETTINGS").
 */
import React from "react";
import { PropertyRow, Slider, ToggleSwitch } from "../../components/ui/index";

export interface SceneSettingsProps {
  ambient: number;
  onAmbientChange: (next: number) => void;
  brightness: number;
  onBrightnessChange: (next: number) => void;
  fog: boolean;
  onFogChange: (next: boolean) => void;
}

export function SceneSettings({
  ambient,
  onAmbientChange,
  brightness,
  onBrightnessChange,
  fog,
  onFogChange,
}: SceneSettingsProps) {
  return (
    <div className="space-y-2">
      <PropertyRow label="Ambient">
        <Slider
          value={ambient}
          min={0}
          max={100}
          step={1}
          onChange={onAmbientChange}
          valueLabel={`${ambient}%`}
        />
      </PropertyRow>
      <PropertyRow label="Brightness">
        <Slider
          value={brightness}
          min={0}
          max={200}
          step={1}
          onChange={onBrightnessChange}
          valueLabel={`${brightness}%`}
        />
      </PropertyRow>
      <PropertyRow label="Fog">
        <ToggleSwitch
          aria-label="Scene fog"
          size="sm"
          checked={fog}
          onChange={onFogChange}
        />
      </PropertyRow>
      <p className="text-[10px] text-zinc-500 pt-1 leading-snug">
        Preview-only — engine wiring lands when per-scene render config
        (ambient / fog / brightness) ships.
      </p>
    </div>
  );
}
