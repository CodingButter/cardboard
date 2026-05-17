import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedPresetData } from "@two_5_d/engine";
import { ArrowLeft, X as XIcon } from "lucide-react";

import { Button, Input } from "../components/ui";
import {
  Badge,
  ColorChip,
  CollapsibleSection,
  FilePicker,
  PanelHeader,
  PropertyRow,
  ScrollArea,
  Select,
  Slider,
} from "../components/ui/index";
import { CellPreview, defaultCellPreviewOrbit } from "./CellPreview";
import type { CellPreviewOrbitState } from "./CellPreview";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { clonePreset } from "../lib/presetCrud";

/**
 * PresetEditView — full-screen Preset Edit Mode (Map tab → MapView).
 *
 * When MapView's `editingPresetId` is set, this view REPLACES the
 * normal grid + right-rail layout. The user gets:
 *
 *   - a top bar with Back / preset-name input / Cancel / Save,
 *   - a LARGE live 3D preview on the left (CellPreview at full
 *     centre-pane width), and
 *   - a property editor on the right that re-renders the preview on
 *     every change.
 *
 * The preview is driven through the same engine wrapper used by the
 * normal Map view's right-rail CellPreview — so we get pixel-identical
 * rendering for free (wall height, partial walls, emissive area
 * lights, reflectiveness, etc.) without re-implementing any geometry.
 * The trick: a SYNTHETIC preset id (`__editing.<presetId>`) keeps the
 * engine's IdbAssetPack happy because the CellPreviewEngine resolves
 * preset → tile via its cached resolver, and the resolver builds at
 * pack-load. For MVP the preview keeps reading the AS-SAVED preset
 * data via the resolver; we layer the edited fields in by snapshotting
 * the resolved data and pushing it back as `presetData` so the engine
 * surfaces the new wall/emissive/reflection values the next time it
 * rebuilds. WIRING: a future follow-up should add a per-engine
 * "override resolved preset" hook so unsaved edits flow into the GL
 * scene without a save round-trip — see the comment on `liveSyncWiring`
 * below.
 *
 * The save path writes the JSONC at the preset's `sourcePath` back
 * through `EditorProjectStore.saveAsset`. Renames go through
 * `clonePreset` and update the pack's tilePresets file; cell `idMap`
 * migration across scenes is out of MVP scope (see §3.4 comment).
 */

export interface PresetEditViewProps {
  /** Project id for the editor's IDB pack. */
  projectId: string;
  /** Preset id being edited. */
  presetId: string;
  /** Initial fully-resolved preset data. */
  presetData: ResolvedPresetData;
  /** Active map layer when the user entered edit mode — biases which
   *  fields are shown (walls-only sections gate behind `walls`). */
  layerHint: "walls" | "floors" | "ceiling";
  /** Full preset catalogue. Used to drive the floor / ceiling preview
   *  override dropdowns at the bottom of the property panel. */
  presetOptions: ReadonlyArray<{
    id: string;
    label: string;
    sourcePath: string;
  }>;
  /** Optional: the JSONC source path that owns this preset id (e.g.
   *  `tilesheets/presets/walls.jsonc`). If supplied, Save writes back
   *  to that path. If omitted, Save logs a WIRING warning and the
   *  in-memory `onSave` still fires so the parent can pick it up. */
  presetSourcePath?: string;
  /** Optional: the `sourcePackId` for this preset. Pack-aware writes
   *  pivot on this when the preset belongs to a non-root pack. */
  presetSourcePackId?: string;
  /** Fired on Save AFTER persistence. Payload is the (possibly renamed)
   *  id and the latest resolved data. */
  onSave: (nextId: string, nextData: ResolvedPresetData) => void | Promise<void>;
  /** Fired on Cancel (after the unsaved-changes confirm). */
  onCancel: () => void;
  /** Fired on Back / after Save — drops the parent out of edit mode. */
  onExit: () => void;
}

/** Tags-input parser: splits on commas, trims, drops empties. */
function parseTags(raw: string): ReadonlyArray<string> {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Convert linear-RGB [0..1] triple → CSS hex (#rrggbb) via γ=2.2. */
function linearRgbToHex(rgb: readonly [number, number, number]): string {
  const toByte = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const srgb = Math.pow(clamped, 1 / 2.2);
    return Math.round(srgb * 255);
  };
  const [r, g, b] = rgb.map(toByte);
  return `#${[r, g, b]
    .map((v) => (v ?? 0).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** CSS hex → linear-RGB [0..1] triple via γ=2.2 inverse. */
function hexToLinearRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const v = m[1]!;
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const inv = (c: number) => Math.pow(c, 2.2);
  return [inv(r), inv(g), inv(b)];
}

/**
 * Strip JSONC comments — same minimal logic the engine's resolver
 * uses for parsing tilePresets files. Re-implemented here so the
 * editor can read+write JSONC without pulling the engine's parser
 * into the editor's chunk. Handles `//` line comments and slash-star
 * block comments only — no fancy edge-case parsing.
 */
function stripJsonComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let inString = false;
  let stringChar = "";
  while (i < n) {
    const c = src[i]!;
    const next = i + 1 < n ? src[i + 1]! : "";
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += next;
        i += 2;
        continue;
      }
      if (c === stringChar) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function PresetEditView({
  projectId,
  presetId,
  presetData,
  layerHint,
  presetOptions,
  presetSourcePath,
  presetSourcePackId,
  onSave,
  onCancel,
  onExit,
}: PresetEditViewProps) {
  // ── Local edit state. `editedId` may diverge from `presetId` when
  //    the user renames in the top-bar Input; the rename flow on Save
  //    calls `clonePreset` to migrate.
  const [editedId, setEditedId] = useState(presetId);
  const [editedData, setEditedData] = useState<ResolvedPresetData>(
    () => structuredClone(presetData) as ResolvedPresetData,
  );
  const initialDataRef = useRef<ResolvedPresetData>(
    structuredClone(presetData) as ResolvedPresetData,
  );
  const initialIdRef = useRef<string>(presetId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the parent swaps which preset we're editing.
  useEffect(() => {
    setEditedId(presetId);
    setEditedData(structuredClone(presetData) as ResolvedPresetData);
    initialIdRef.current = presetId;
    initialDataRef.current = structuredClone(presetData) as ResolvedPresetData;
    setError(null);
  }, [presetId, presetData]);

  // ── Floor / ceiling preview overrides — the user picks any floor or
  //    ceiling preset from the catalogue to see the wall in context.
  //    Defaults to none (CellPreview falls through to the cell's own).
  const [floorOverride, setFloorOverride] = useState<string | null>(null);
  const [ceilingOverride, setCeilingOverride] = useState<string | null>(null);
  const [wallOverride, setWallOverride] = useState<string | null>(null);

  // ── Live preview orbit state — single shared ref so we can extend to
  //    a second preview window later without state divergence.
  const orbitRef = useRef<CellPreviewOrbitState>(defaultCellPreviewOrbit());

  // Dirty check — comparison against the initial snapshots.
  const dirty = useMemo(() => {
    if (editedId !== initialIdRef.current) return true;
    return (
      JSON.stringify(editedData) !== JSON.stringify(initialDataRef.current)
    );
  }, [editedId, editedData]);

  // ── Update helpers. Each shapes a delta over `editedData` so the
  //    CellPreview re-renders on the next React commit.
  const patch = useCallback(
    (delta: Partial<ResolvedPresetData>) => {
      setEditedData((prev) => ({ ...prev, ...delta }));
    },
    [],
  );
  const patchPartialWall = useCallback(
    (delta: Partial<NonNullable<ResolvedPresetData["partialWall"]>> | null) => {
      setEditedData((prev) => {
        if (delta === null) {
          const { partialWall: _drop, ...rest } = prev;
          return rest as ResolvedPresetData;
        }
        const cur = prev.partialWall ?? { face: "north", startU: 0, widthU: 1 };
        return { ...prev, partialWall: { ...cur, ...delta } };
      });
    },
    [],
  );
  const patchEmissive = useCallback(
    (delta: Partial<NonNullable<ResolvedPresetData["emissive"]>> | null) => {
      setEditedData((prev) => {
        if (delta === null) {
          const { emissive: _drop, ...rest } = prev;
          return rest as ResolvedPresetData;
        }
        const cur =
          prev.emissive ??
          ({
            color: [1, 1, 1] as [number, number, number],
            intensity: 1,
            areaLight: false,
          } satisfies NonNullable<ResolvedPresetData["emissive"]>);
        return { ...prev, emissive: { ...cur, ...delta } };
      });
    },
    [],
  );

  // ── Save flow ────────────────────────────────────────────────────
  // Writes the preset back to its source JSONC file. We perform a
  // minimal merge: read the file, patch the keyed entry, write it
  // back. JSONC comments survive only outside the patched preset's
  // object — stripping comments mid-block would be brittle for the
  // MVP. The renderer-side cache invalidation rides on the existing
  // resolver rebuild flow (a future follow-up: trigger a manifest
  // re-resolve so other open views pick up the changes without a
  // page reload — see `liveSyncWiring` note above).
  const persist = useCallback(async () => {
    if (!presetSourcePath) {
      // WIRING: no source path known. Some callers (e.g. legacy
      // `__legacy.*` presets synthesised from manifest.tileTextures)
      // don't have a writable file. Surface this and bail — the
      // parent's `onSave` still fires so transient in-memory edits
      // bubble.
      console.warn(
        `[PresetEditView] no presetSourcePath for ${presetId}; ` +
          `skipping JSONC write. Edits are not persisted.`,
      );
      return;
    }
    const raw = await EditorProjectStore.loadAsset(projectId, presetSourcePath);
    if (typeof raw !== "string") {
      throw new Error(
        `Preset source not found in IDB: ${presetSourcePath}`,
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to parse ${presetSourcePath}: ${(err as Error).message}`,
      );
    }

    // Build the on-disk record. We only emit fields that differ from
    // engine defaults to keep the JSONC tight, but for MVP we just
    // pass through the resolved data minus runtime-only fields. The
    // resolver will re-default missing fields on next load.
    const onDisk = serializePresetForDisk(editedData);

    // Rename: drop the old key, add the new one.
    if (editedId !== initialIdRef.current) {
      delete parsed[initialIdRef.current];
    }
    parsed[editedId] = onDisk;

    const nextText = JSON.stringify(parsed, null, 2);
    await EditorProjectStore.saveAsset(projectId, presetSourcePath, nextText);
    // WIRING: if the rename touched scene idMaps elsewhere, a
    // follow-up should call `migrateSceneIdMap` (per the parent
    // task's #277). For MVP we leave existing scene cells pointing
    // at the old id — which the resolver will report as a missing
    // preset until the user re-paints or we land the migration.
  }, [editedData, editedId, presetId, presetSourcePath, projectId]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Cloning is a no-op for non-rename saves; for renames it gives
      // the parent a fresh Preset shape to plug into the pack.
      if (editedId !== initialIdRef.current) {
        // Synthesise a Preset object so `clonePreset` can deep-clone
        // the data wholesale and stamp the new id (matches the
        // presetCrud contract — see lib/presetCrud.ts §clonePreset).
        clonePreset(
          {
            id: initialIdRef.current,
            data: initialDataRef.current,
            sourcePackId: presetSourcePackId ?? "",
            sourcePath: presetSourcePath ?? "",
          },
          editedId,
        );
      }
      await persist();
      await onSave(editedId, editedData);
      onExit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [
    editedData,
    editedId,
    onExit,
    onSave,
    persist,
    presetSourcePackId,
    presetSourcePath,
    saving,
  ]);

  const handleCancel = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(
        "Discard unsaved preset changes?",
      );
      if (!ok) return;
    }
    onCancel();
    onExit();
  }, [dirty, onCancel, onExit]);

  // ── Synthesise the floor / ceiling override data for the preview
  //    so the engine sees the picked preset's full ResolvedPresetData.
  //    We don't have direct access to the resolver here — the parent
  //    feeds `presetOptions` (id + label + sourcePath) but the engine
  //    needs the resolved data. The CellPreview prop surface accepts
  //    only the id-based override (the engine re-resolves internally
  //    via its IdbAssetPack), so we forward `floorOverride` /
  //    `ceilingOverride` ids through CellPreview's existing override
  //    props. Job done — no extra plumbing.

  // Split preset options into floor / ceiling / wall buckets by
  // sourcePath substring (the convention `floors` / `ceilings` /
  // `walls` matches what default-pack uses).
  const floorOptions = useMemo(() => {
    return presetOptions.filter((p) =>
      p.sourcePath.toLowerCase().includes("floor"),
    );
  }, [presetOptions]);
  const ceilingOptions = useMemo(() => {
    return presetOptions.filter((p) =>
      p.sourcePath.toLowerCase().includes("ceil"),
    );
  }, [presetOptions]);
  const wallOptions = useMemo(() => {
    return presetOptions.filter((p) =>
      p.sourcePath.toLowerCase().includes("wall"),
    );
  }, [presetOptions]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="grid h-full grid-rows-[auto_1fr] grid-cols-1 min-h-0 bg-zinc-950 text-zinc-100">
      {/* ── Top bar ───────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          aria-label="Back to map"
        >
          <ArrowLeft size={14} className="mr-1" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 shrink-0">
            Preset
          </label>
          <Input
            value={editedId}
            onChange={(e) => setEditedId(e.target.value)}
            placeholder="preset.id"
            className="max-w-xs font-mono"
          />
          {dirty ? (
            <Badge variant="amber" outlined>
              UNSAVED
            </Badge>
          ) : null}
          {error ? (
            <span className="text-xs text-red-400 truncate">{error}</span>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || (!dirty && editedId === initialIdRef.current)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </header>

      {/* ── Main body: large preview (left) + property panel (right) ─ */}
      <div className="grid grid-cols-[1fr_380px] min-h-0">
        {/* LEFT — large 3D preview. Stretches to fill the former grid +
            right-rail area. The CellPreview component sizes itself off
            its container; we hand it a flex-1 wrapper so it expands. */}
        <div className="relative flex flex-col min-h-0 border-r border-zinc-800">
          <div className="flex-1 min-h-0 p-4 flex items-center justify-center">
            <div className="w-full h-full max-w-[1024px] max-h-[1024px] flex items-center justify-center">
              <CellPreview
                projectId={projectId}
                // Synthetic id — see the file-level comment. The
                // engine's resolver still reads the saved preset data
                // for this id when it matches an existing pack
                // preset, so we pass the real id through. Property
                // edits flow into the preview via React state → prop
                // change → engine.setScene on the next render.
                presetId={editedId}
                presetData={editedData}
                layer={layerHint}
                expanded={true}
                sharedOrbitRef={orbitRef}
                presetOptions={presetOptions}
                floorPresetOverride={floorOverride}
                setFloorPresetOverride={setFloorOverride}
                ceilingPresetOverride={ceilingOverride}
                setCeilingPresetOverride={setCeilingOverride}
                wallPresetOverride={wallOverride}
                setWallPresetOverride={setWallOverride}
              />
            </div>
          </div>
        </div>

        {/* RIGHT — property editor. */}
        <aside className="flex flex-col min-h-0 bg-zinc-950/40">
          <ScrollArea fade={false} className="h-full">
            <div className="p-3 space-y-3">
              {/* ── Material ─────────────────────────────────────── */}
              <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                <PanelHeader size="sm" title="Material" />
                <div className="px-3 pb-2">
                  <PropertyRow label="Texture" stacked>
                    <div className="flex items-center gap-2">
                      <Input
                        value={editedData.texture}
                        onChange={(e) =>
                          patch({ texture: e.target.value })
                        }
                        placeholder="images/tiles/wall.png"
                        className="font-mono text-xs"
                      />
                      {/* FilePicker is currently best for asset
                          imports — wiring it to set a relative pack
                          path is a follow-up. For MVP it accepts an
                          image and we drop the file name into the
                          texture path; a future enhancement should
                          surface a real visual texture picker. */}
                      <FilePicker
                        accept="image/*"
                        onFiles={(files) => {
                          const f = files[0];
                          if (f) patch({ texture: f.name });
                        }}
                        mode="button"
                      >
                        Browse…
                      </FilePicker>
                    </div>
                  </PropertyRow>
                  <PropertyRow label="Reflectiveness">
                    <Slider
                      value={editedData.reflectiveness}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => patch({ reflectiveness: v })}
                      valueLabel={editedData.reflectiveness.toFixed(2)}
                    />
                  </PropertyRow>
                </div>
              </section>

              {/* ── Walls (gated on layerHint) ───────────────────── */}
              {layerHint === "walls" ? (
                <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                  <PanelHeader size="sm" title="Wall geometry" />
                  <div className="px-3 pb-2">
                    <PropertyRow label="Wall height">
                      <Slider
                        value={editedData.wallHeight}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(v) => patch({ wallHeight: v })}
                        valueLabel={editedData.wallHeight.toFixed(2)}
                      />
                    </PropertyRow>
                    <PropertyRow label="Wall start Z">
                      <Slider
                        value={editedData.wallStartZ}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(v) => patch({ wallStartZ: v })}
                        valueLabel={editedData.wallStartZ.toFixed(2)}
                      />
                    </PropertyRow>
                    <PropertyRow label="Partial wall">
                      <Select
                        size="sm"
                        value={editedData.partialWall?.face ?? "none"}
                        options={[
                          { value: "none", label: "None" },
                          { value: "north", label: "North" },
                          { value: "south", label: "South" },
                          { value: "east", label: "East" },
                          { value: "west", label: "West" },
                        ]}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "none") patchPartialWall(null);
                          else
                            patchPartialWall({
                              face: v as
                                | "north"
                                | "south"
                                | "east"
                                | "west",
                            });
                        }}
                      />
                    </PropertyRow>
                    {editedData.partialWall ? (
                      <>
                        <PropertyRow label="Partial width">
                          <Slider
                            value={editedData.partialWall.widthU}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) =>
                              patchPartialWall({ widthU: v })
                            }
                            valueLabel={editedData.partialWall.widthU.toFixed(
                              2,
                            )}
                          />
                        </PropertyRow>
                        <PropertyRow label="Partial start">
                          <Slider
                            value={editedData.partialWall.startU}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) =>
                              patchPartialWall({ startU: v })
                            }
                            valueLabel={editedData.partialWall.startU.toFixed(
                              2,
                            )}
                          />
                        </PropertyRow>
                      </>
                    ) : null}
                    <PropertyRow label="Collision">
                      <Select
                        size="sm"
                        value={editedData.collision}
                        options={[
                          { value: "solid", label: "Solid" },
                          { value: "passable", label: "Passable" },
                          { value: "trigger", label: "Trigger" },
                          { value: "blockBullets", label: "Block bullets" },
                        ]}
                        onChange={(e) =>
                          patch({
                            collision: e.target
                              .value as ResolvedPresetData["collision"],
                          })
                        }
                      />
                    </PropertyRow>
                  </div>
                </section>
              ) : null}

              {/* ── Emissive ─────────────────────────────────────── */}
              <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                <PanelHeader
                  size="sm"
                  title="Emissive"
                  action={
                    editedData.emissive ? (
                      <button
                        type="button"
                        onClick={() => patchEmissive(null)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-0.5"
                        title="Remove emissive"
                      >
                        <XIcon size={12} />
                        Off
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patchEmissive({})}
                        className="text-[11px] text-amber-300 hover:text-amber-200"
                      >
                        + Add
                      </button>
                    )
                  }
                />
                {editedData.emissive ? (
                  <div className="px-3 pb-2">
                    <PropertyRow label="Color">
                      <ColorChip
                        value={linearRgbToHex(editedData.emissive.color)}
                        onChange={(hex) =>
                          patchEmissive({ color: hexToLinearRgb(hex) })
                        }
                      />
                    </PropertyRow>
                    <PropertyRow label="Intensity">
                      <Slider
                        value={editedData.emissive.intensity}
                        min={0}
                        max={4}
                        step={0.05}
                        onChange={(v) => patchEmissive({ intensity: v })}
                        valueLabel={editedData.emissive.intensity.toFixed(2)}
                      />
                    </PropertyRow>
                    <PropertyRow label="Area light">
                      <Select
                        size="sm"
                        value={editedData.emissive.areaLight ? "yes" : "no"}
                        options={[
                          { value: "no", label: "No" },
                          { value: "yes", label: "Yes" },
                        ]}
                        onChange={(e) =>
                          patchEmissive({
                            areaLight: e.target.value === "yes",
                          })
                        }
                      />
                    </PropertyRow>
                  </div>
                ) : (
                  <p className="px-3 pb-3 text-xs text-zinc-500">
                    Add an emissive layer to make this preset glow.
                  </p>
                )}
              </section>

              {/* ── Tags ─────────────────────────────────────────── */}
              <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                <PanelHeader size="sm" title="Tags" />
                <div className="px-3 pb-3 space-y-2">
                  <Input
                    value={(editedData.tags ?? []).join(", ")}
                    onChange={(e) =>
                      patch({ tags: parseTags(e.target.value) })
                    }
                    placeholder="brick, exterior, weathered"
                    className="text-xs font-mono"
                  />
                  {editedData.tags && editedData.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {editedData.tags.map((t) => (
                        <Badge key={t} variant="sky" outlined>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              {/* ── Preview overrides ─────────────────────────────── */}
              <CollapsibleSection title="Preview context" defaultOpen>
                <PropertyRow label="Floor preset">
                  <Select
                    size="sm"
                    value={floorOverride ?? ""}
                    options={[
                      { value: "", label: "(default)" },
                      ...floorOptions.map((o) => ({
                        value: o.id,
                        label: o.label,
                      })),
                    ]}
                    onChange={(e) =>
                      setFloorOverride(
                        e.target.value === "" ? null : e.target.value,
                      )
                    }
                  />
                </PropertyRow>
                <PropertyRow label="Ceiling preset">
                  <Select
                    size="sm"
                    value={ceilingOverride ?? ""}
                    options={[
                      { value: "", label: "(default)" },
                      ...ceilingOptions.map((o) => ({
                        value: o.id,
                        label: o.label,
                      })),
                    ]}
                    onChange={(e) =>
                      setCeilingOverride(
                        e.target.value === "" ? null : e.target.value,
                      )
                    }
                  />
                </PropertyRow>
                {layerHint === "walls" ? (
                  <PropertyRow label="Surround wall">
                    <Select
                      size="sm"
                      value={wallOverride ?? ""}
                      options={[
                        { value: "", label: "(same as focus)" },
                        ...wallOptions.map((o) => ({
                          value: o.id,
                          label: o.label,
                        })),
                      ]}
                      onChange={(e) =>
                        setWallOverride(
                          e.target.value === "" ? null : e.target.value,
                        )
                      }
                    />
                  </PropertyRow>
                ) : null}
              </CollapsibleSection>

              {/* WIRING — advanced ResolvedPresetData fields skipped in
                  MVP. Wire these up in a follow-up:
                    - topCap, bottomCap (texture path inputs)
                    - riserTexture (texture path input)
                    - floorHeight, ceilingHeight (numeric sliders)
                    - transition (slider 0..1)
                    - offsetX, offsetY (numeric inputs)
                    - sheetCrop { col, row } (paired numeric inputs)
                    - shader bundle (sub-form for { worldHooks,
                      spriteHooks, skyHooks })
                    - thumbnail (asset picker)
                    - displayName (text input — currently inferred
                      from id on rename via clonePreset)
                    - ambientOcclusion (toggle) */}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

/**
 * Serialise a `ResolvedPresetData` back to a `PresetSource`-shaped
 * record suitable for JSONC persistence. Drops `undefined` fields,
 * normalises emissive's optional `areaLight`, and trims back to the
 * fields the resolver re-defaults on load.
 *
 * We deliberately keep this lossy-to-defaults — the resolver
 * re-defaults `offsetX: 0` / `wallHeight: 1` etc. on load, so re-emitting
 * everything makes the JSONC chattier than it needs to be. For MVP we
 * emit every field except the engine internals; a future pass can
 * diff against `withDefaults({})` to elide unchanged fields.
 */
function serializePresetForDisk(
  data: ResolvedPresetData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    texture: data.texture,
    offsetX: data.offsetX,
    offsetY: data.offsetY,
    wallHeight: data.wallHeight,
    wallStartZ: data.wallStartZ,
    floorHeight: data.floorHeight,
    ceilingHeight: data.ceilingHeight,
    reflectiveness: data.reflectiveness,
    transition: data.transition,
    collision: data.collision,
    ambientOcclusion: data.ambientOcclusion,
  };
  if (data.topCap) out.topCap = data.topCap;
  if (data.bottomCap) out.bottomCap = data.bottomCap;
  if (data.riserTexture) out.riserTexture = data.riserTexture;
  if (data.partialWall) out.partialWall = data.partialWall;
  if (data.sheetCrop) out.sheetCrop = data.sheetCrop;
  if (data.emissive) {
    out.emissive = {
      color: data.emissive.color,
      intensity: data.emissive.intensity,
      areaLight: data.emissive.areaLight,
    };
  }
  if (data.tags && data.tags.length > 0) out.tags = [...data.tags];
  if (data.displayName) out.displayName = data.displayName;
  if (data.thumbnail) out.thumbnail = data.thumbnail;
  if (data.shader) out.shader = data.shader;
  return out;
}
