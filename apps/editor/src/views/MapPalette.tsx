/**
 * MapPalette — left-rail tile-preset palette for the §7.2 Scene tab.
 *
 * Hoisted out of GridEditor's internal left aside so the Scene shell
 * body honours the §6.5 three-rail grammar:
 *
 *     +----------+----------------+----------+
 *     | LEFT     | CENTER         | RIGHT    |
 *     | MapPale.. | GridEditor    | Cell     |
 *     | (this)   | (palette       | Preview  |
 *     |          |  hidden)       | + Insp.  |
 *     +----------+----------------+----------+
 *
 * State this component owns locally:
 *   - presetFilter (search input)
 *   - texture object-URL cache (revoked on unmount)
 *
 * State threaded through props (controlled, lives in MapView):
 *   - activePresetId / onActivePresetChange
 *   - showAnonymousPresets / onShowAnonymousPresetsChange
 *
 * It loads its own `IdbAssetPack` + `PresetResolver` because the engine
 * APIs are already cache-friendly (IDB row cache + dedupe inside the
 * pack). Two callers loading them in parallel hit the same rows.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IdbAssetPack,
  type PresetResolver,
  type ResolvedPresetData,
} from "@two_5_d/engine";
import { PanelHeader, ScrollArea, ToggleSwitch } from "../components/ui/index";
import { cn } from "../lib/cn";

/** Texture preview bundle — local mirror of GridEditor's internal type
 *  (kept in sync until the two consolidate). */
interface PresetPreview {
  presetId: string;
  data: ResolvedPresetData;
  url: string | null;
  kind: "named" | "anonymous";
}

export interface MapPaletteProps {
  projectId: string;
  activePresetId: string | null;
  onActivePresetChange: (id: string | null) => void;
  showAnonymousPresets: boolean;
  onShowAnonymousPresetsChange: (next: boolean) => void;
  /** Palette double-click — enter PresetEditView (mirrors GridEditor). */
  onEditPreset?: (id: string) => void;
  /** Palette right-click — opens MapView's preset context menu. */
  onPresetContextMenu?: (id: string, screenX: number, screenY: number) => void;
}

/** Stable swatch color for a preset id (matches GridEditor's choice so
 *  the two palettes stay visually consistent if both are ever mounted). */
const FALLBACK_PALETTE = [
  "#d97706",
  "#0891b2",
  "#65a30d",
  "#c026d3",
  "#dc2626",
  "#4f46e5",
  "#0d9488",
  "#a16207",
];
function colorForPreset(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length]!;
}

/** Texture loader scoped to this palette mount. Object URLs are revoked
 *  on unmount. */
function useTexturePack(projectId: string) {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const inflightRef = useRef<Map<string, Promise<string>>>(new Map());
  const packRef = useRef<IdbAssetPack | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    IdbAssetPack.fromProject(projectId).then((pack) => {
      if (!alive) return;
      packRef.current = pack;
      force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      cache.clear();
    };
  }, []);

  const loadTexture = useCallback((path: string): string | null => {
    const cached = cacheRef.current.get(path);
    if (cached) return cached;
    const pack = packRef.current;
    if (!pack || !pack.has(path)) return null;
    if (inflightRef.current.has(path)) return null;
    const promise = pack.textureBlob(path).then((blob) => {
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(path, url);
      inflightRef.current.delete(path);
      force((n) => n + 1);
      return url;
    });
    inflightRef.current.set(path, promise);
    return null;
  }, []);

  return { pack: packRef.current, loadTexture };
}

function useResolver(pack: IdbAssetPack | null): {
  resolver: PresetResolver | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    resolver: PresetResolver | null;
    error: string | null;
  }>({ resolver: null, error: null });

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    pack
      .presets()
      .then((resolver) => {
        if (!alive) return;
        setState({ resolver, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({ resolver: null, error: (err as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [pack]);

  return state;
}

export function MapPalette({
  projectId,
  activePresetId,
  onActivePresetChange,
  showAnonymousPresets,
  onShowAnonymousPresetsChange,
  onEditPreset,
  onPresetContextMenu,
}: MapPaletteProps) {
  const { pack, loadTexture } = useTexturePack(projectId);
  const { resolver, error: resolverError } = useResolver(pack);

  const [presetFilter, setPresetFilter] = useState("");

  const allPresets = useMemo<PresetPreview[]>(() => {
    if (!resolver) return [];
    const out: PresetPreview[] = [];
    for (const preset of resolver) {
      if (preset.id.startsWith("__legacy.")) continue;
      const kind: "named" | "anonymous" = preset.id.startsWith("_")
        ? "anonymous"
        : "named";
      out.push({
        presetId: preset.id,
        data: preset.data,
        url: loadTexture(preset.data.texture),
        kind,
      });
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "named" ? -1 : 1;
      return a.presetId.localeCompare(b.presetId);
    });
    return out;
  }, [resolver, loadTexture]);

  const hiddenAnonCount = useMemo(() => {
    if (showAnonymousPresets) return 0;
    let n = 0;
    for (const p of allPresets) if (p.kind === "anonymous") n++;
    return n;
  }, [allPresets, showAnonymousPresets]);

  const presetList = useMemo<PresetPreview[]>(() => {
    if (showAnonymousPresets) return allPresets;
    return allPresets.filter((p) => p.kind !== "anonymous");
  }, [allPresets, showAnonymousPresets]);

  const filteredPresets = useMemo(() => {
    const q = presetFilter.trim().toLowerCase();
    if (!q) return presetList;
    return presetList.filter((p) => p.presetId.toLowerCase().includes(q));
  }, [presetList, presetFilter]);

  // Default-activate the first preset once the palette populates and
  // no caller-driven active preset is set.
  useEffect(() => {
    if (!activePresetId && presetList.length > 0) {
      onActivePresetChange(presetList[0]!.presetId);
    }
  }, [presetList, activePresetId, onActivePresetChange]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader
        title="Tile Presets"
        action={
          hiddenAnonCount > 0 ? (
            <span className="text-[10px] font-medium text-zinc-500 tabular-nums">
              +{hiddenAnonCount} hidden
            </span>
          ) : undefined
        }
      />
      <div className="px-3 py-2 border-b border-zinc-800/80 space-y-2">
        <input
          value={presetFilter}
          onChange={(e) => setPresetFilter(e.target.value)}
          placeholder="Filter presets…"
          className="w-full h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <div className="flex items-center gap-2">
          <ToggleSwitch
            size="sm"
            checked={showAnonymousPresets}
            onChange={onShowAnonymousPresetsChange}
            aria-label="Show anonymous presets"
          />
          <span className="text-[11px] text-zinc-400">Show anonymous</span>
        </div>
      </div>
      <ScrollArea fade={false} className="flex-1">
        <div className="p-2 space-y-1">
          {resolverError ? (
            <div className="text-xs text-red-400">
              Preset load failed: {resolverError}
            </div>
          ) : null}
          {filteredPresets.length === 0 && !resolverError ? (
            <div className="text-xs text-zinc-500 py-2 px-1">
              {resolver
                ? "No named presets in manifest.tilePresets[]."
                : "Loading…"}
            </div>
          ) : null}
          {filteredPresets.map((p) => {
            const isAnon = p.kind === "anonymous";
            const isActive = activePresetId === p.presetId;
            return (
              <button
                key={p.presetId}
                onClick={() => onActivePresetChange(p.presetId)}
                onDoubleClick={() => onEditPreset?.(p.presetId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPresetContextMenu?.(p.presetId, e.clientX, e.clientY);
                }}
                className={cn(
                  "flex items-center gap-2 w-full rounded-md px-2 py-1 text-left text-xs",
                  "transition-colors duration-150",
                  isActive
                    ? "bg-amber-500 text-zinc-950"
                    : isAnon
                      ? "hover:bg-zinc-800 text-zinc-400"
                      : "hover:bg-zinc-800 text-zinc-200",
                )}
                title={
                  isAnon
                    ? `${p.presetId} — Anonymous preset (per-cell variant) · double-click to edit`
                    : `${p.presetId} · double-click to edit`
                }
              >
                <span
                  className="block w-6 h-6 rounded-sm border border-zinc-700 shrink-0"
                  style={{
                    background: p.url
                      ? `url("${p.url}") center/cover`
                      : colorForPreset(p.presetId),
                  }}
                />
                <span
                  className={cn(
                    "truncate",
                    isAnon && !isActive && "italic",
                  )}
                >
                  {p.presetId}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
