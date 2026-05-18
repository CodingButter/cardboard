/**
 * CellInspector — Scene page right-rail "Cell Inspector" card body.
 *
 * Phase 2 Wave A stub: extracts the per-cell read-only inspector out of
 * `MapView.tsx`. Renders the active selection's coords + layer + preset
 * stack (active / floor / ceiling) + preset metadata (texture,
 * reflectiveness, solid, wall vertical-extent, partial wall, emissive,
 * tags).
 *
 * Wave B will:
 *  - Make the Layer + Preset rows editable (today they're read-only —
 *    layer selection still lives inside GridEditor's toolbar).
 *  - Surface tag editing inline (today the tag pills are display-only).
 *  - Add a kebab/"more" menu for cell-scoped actions (copy / paste /
 *    clear / edit parent preset).
 *
 * For Wave A the component takes the selection snapshot + the
 * `onEditPreset` callback and renders the same inline JSX the previous
 * MapView did. The empty-state path remains the same chirpy hint.
 *
 * Mockup: `Editor Design/Map.png` (right-rail card 2 — "CELL INSPECTOR").
 */
import React from "react";
import { Pencil } from "lucide-react";
import {
  Badge,
  Button,
  PropertyRow,
  Select,
  StatsBlock,
  ToggleSwitch,
} from "../../components/ui/index";
import type { MapSelectionInfo } from "../GridEditor";

export interface CellInspectorProps {
  selection: MapSelectionInfo | null;
  /** Fires when the user clicks "Edit preset" — owner enters preset edit mode. */
  onEditPreset: (presetId: string) => void;
}

export function CellInspector({ selection, onEditPreset }: CellInspectorProps) {
  if (!selection?.selected) {
    return (
      <p className="text-xs text-zinc-500">
        Left-click a cell in the grid to inspect it. The 3D preview above
        re-renders live as you edit the cell's preset.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <StatsBlock label="X" value={selection.selected.x} />
        <StatsBlock label="Y" value={selection.selected.y} />
        <StatsBlock label="Z" value={0} />
      </div>
      <PropertyRow label="Layer">
        <Select
          size="sm"
          value={selection.layer}
          // WIRING (Wave B): layer selection still lives inside GridEditor
          // — wire this Select to MapView's `setMapLayer` once the cell
          // inspector becomes the canonical layer-picker for the selected
          // cell.
          disabled
          options={[
            { value: "walls", label: "Walls" },
            { value: "floors", label: "Floors" },
            { value: "ceiling", label: "Ceilings" },
          ]}
          onChange={() => undefined}
        />
      </PropertyRow>
      <PropertyRow label="Preset">
        <span className="text-xs font-mono text-zinc-200 truncate">
          {selection.selectedPresetId ?? "(empty)"}
        </span>
      </PropertyRow>
      <div className="pt-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={!selection.selectedPresetId}
          onClick={() => {
            if (selection.selectedPresetId) {
              onEditPreset(selection.selectedPresetId);
            }
          }}
          className="w-full"
        >
          <Pencil size={12} className="mr-1.5" />
          Edit preset
        </Button>
      </div>
      <PropertyRow label="Floor preset">
        <span className="text-[11px] font-mono text-zinc-300 truncate">
          {selection.floorPresetId ?? "(none)"}
        </span>
      </PropertyRow>
      <PropertyRow label="Ceiling preset">
        <span className="text-[11px] font-mono text-zinc-300 truncate">
          {selection.ceilingPresetId ?? "(none)"}
        </span>
      </PropertyRow>
      {selection.selectedPresetData ? (
        <>
          <PropertyRow label="Texture">
            <span className="text-[11px] font-mono text-zinc-300 truncate">
              {selection.selectedPresetData.texture}
            </span>
          </PropertyRow>
          <PropertyRow label="Reflectiveness">
            <span className="text-xs font-mono text-zinc-200">
              {selection.selectedPresetData.reflectiveness.toFixed(2)}
            </span>
          </PropertyRow>
          <PropertyRow label="Solid">
            <ToggleSwitch
              aria-label="Solid collision"
              size="sm"
              checked={selection.selectedPresetData.collision === "solid"}
              // Read-only summary — preset edits happen via the Tile Presets
              // surface / PresetEditView.
              disabled
              onChange={() => undefined}
            />
          </PropertyRow>
          {selection.layer === "walls" &&
          selection.selectedPresetData.wallHeight !== 1 ? (
            <PropertyRow label="Wall height">
              <span className="text-xs font-mono text-zinc-200">
                {selection.selectedPresetData.wallHeight.toFixed(2)}
              </span>
            </PropertyRow>
          ) : null}
          {selection.layer === "walls" &&
          selection.selectedPresetData.wallStartZ !== 0 ? (
            <PropertyRow label="Wall start Z">
              <span className="text-xs font-mono text-zinc-200">
                {selection.selectedPresetData.wallStartZ.toFixed(2)}
              </span>
            </PropertyRow>
          ) : null}
          {selection.selectedPresetData.partialWall ? (
            <PropertyRow label="Partial wall">
              <span className="text-[11px] font-mono text-zinc-300">
                {selection.selectedPresetData.partialWall.face} ·{" "}
                {(
                  selection.selectedPresetData.partialWall.widthU * 100
                ).toFixed(0)}
                %
              </span>
            </PropertyRow>
          ) : null}
          {selection.selectedPresetData.emissive ? (
            <>
              <PropertyRow label="Emissive color">
                <EmissiveSwatch
                  color={selection.selectedPresetData.emissive.color}
                />
              </PropertyRow>
              <PropertyRow label="Emissive intensity">
                <span className="text-xs font-mono text-zinc-200">
                  {selection.selectedPresetData.emissive.intensity.toFixed(2)}
                  <span className="text-zinc-500"> ×</span>
                </span>
              </PropertyRow>
            </>
          ) : null}
          {selection.selectedPresetData.tags &&
          selection.selectedPresetData.tags.length > 0 ? (
            <div className="pt-1 flex flex-wrap gap-1">
              {selection.selectedPresetData.tags.map((t) => (
                <Badge key={t} variant="sky" outlined>
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Small read-only colour swatch + hex readout for the emissive row.
 * The engine stores emissive colour as linear RGB floats [0..1]; we
 * convert to sRGB 0..255 with a γ=2.2 approximation for display.
 */
function EmissiveSwatch({
  color,
}: {
  color: readonly [number, number, number];
}) {
  const toByte = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const srgb = Math.pow(clamped, 1 / 2.2);
    return Math.round(srgb * 255);
  };
  const r = toByte(color[0]);
  const g = toByte(color[1]);
  const b = toByte(color[2]);
  const hex = `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
      <span
        aria-hidden
        className="inline-block w-4 h-4 rounded-sm border border-zinc-700 shrink-0"
        style={{ background: `rgb(${r}, ${g}, ${b})` }}
      />
      <span className="text-[11px] font-mono uppercase text-zinc-200 select-text">
        {hex}
      </span>
    </span>
  );
}
