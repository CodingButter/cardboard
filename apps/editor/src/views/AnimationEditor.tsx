import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PackManifest, SpriteDef } from "@two_5_d/engine/AssetPack";
import {
  EditorProjectStore,
  type SpriteSourceMeta,
} from "../lib/EditorProjectStore";
import {
  ALLOWED_ANGLES,
  buildCompositePlan,
  buildSpriteDef,
  composite,
  effectiveAngles,
  fromSpriteSourceMeta,
  framesPerAngleFor,
  indexToCell,
  initialStateFromImport,
  rowBaseFor,
  saveBakedSprite,
  toSpriteSourceMeta,
  totalOutputCols,
  totalOutputRows,
  validateState,
  type AnimationEditorState,
  type ValidationIssue,
} from "../lib/animationBaker";
import type { FbxBakeConfig } from "../lib/fbxBaker";
import { Button, Input, Label, Modal } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Lazy-loaded FBX importer. AE2's headline feature dynamic-imports
 * Three.js (~600 KB) only when the user clicks "From FBX (Path B)" in
 * the "+ New sprite" submenu. Users who only ever touch Path A
 * (hand-painted spritesheets) never download Three.js. Under Bun's
 * bundler with `--splitting`, this becomes its own chunk.
 */
const FbxImporter = lazy(() =>
  import("./FbxImporter").then((m) => ({ default: m.FbxImporter })),
);

/**
 * AE1 of `docs/plans/ANIMATION_EDITOR.md` — bring-your-own
 * spritesheet editor. Mounts as a workflow mode in `ProjectView`.
 *
 * Layout (left → right):
 *   1. Sprite list — every animation-bearing entry in `manifest.sprites`
 *      that also has a `spriteSources` row (i.e. editor-baked).
 *      Plus "+ New sprite" → file picker modal.
 *   2. Preview / cell-picker — the imported PNG with a green grid
 *      overlay. Click cells to assign them to the active animation in
 *      order. Right-click removes. Drag-to-pan, wheel-to-zoom.
 *   3. Config + Save — sprite-level grid + angle settings, per-animation
 *      list (frameDuration, loop, next, anglesOverride), Save button.
 *
 * The heavy lifting (grid math, plan building, manifest writing) lives
 * in `lib/animationBaker.ts` so the smoke test exercises the same
 * path. This component is the React state + DOM-bound bits (image
 * decode, canvas composite, `<canvas>` element wrangling).
 */

export interface AnimationEditorProps {
  projectId: string;
  /** Tell the parent which sprites this mode has touched so it can
   *  refresh asset lists / manifest editor without a remount. */
  onManifestChanged?: () => void;
}

// ── Internals ────────────────────────────────────────────────────────

/**
 * Loaded source image bundle — the raw blob (round-tripped to IDB),
 * a decoded ImageBitmap for `drawImage`, and an object-URL for the
 * `<img>` preview. Track all three so the preview pane can render
 * without re-decoding on every state mutation.
 */
interface LoadedImage {
  bitmap: ImageBitmap;
  objectUrl: string;
  width: number;
  height: number;
}

async function decodeBlobToImage(blob: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  return {
    bitmap,
    objectUrl,
    width: bitmap.width,
    height: bitmap.height,
  };
}

/** UI-side animation-row state. Keeps the editor JSX flat. */
function blankAnimationMeta(): AnimationEditorState["animationsMeta"][string] {
  return { frameDuration: 0.1, loop: true };
}

// ── Component ────────────────────────────────────────────────────────

export function AnimationEditor({
  projectId,
  onManifestChanged,
}: AnimationEditorProps) {
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [sources, setSources] = useState<SpriteSourceMeta[]>([]);
  /** Sprites surfaced in the left rail — union of manifest sprites with
   *  `animations` AND spriteSources entries (orphan sources OK). */
  const [sheetSpriteIds, setSheetSpriteIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<AnimationEditorState | null>(
    null,
  );
  const [activeAnim, setActiveAnim] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);

  /** Roundtrip badge — set when the sprite was opened from the manifest
   *  but no `spriteSources` row existed. Tells the UI to surface
   *  "Imported externally — round-trip not available." */
  const [externalImport, setExternalImport] = useState(false);

  // Modal state for "+ New sprite".
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importIdDraft, setImportIdDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  /**
   * "+ New sprite" submenu selector. AE2 adds Path B (FBX); the
   * default is still null (closed) — the Path A modal opens when the
   * user clicks "From spritesheet" or the dedicated FbxImporter takes
   * over when they pick "From FBX".
   */
  const [newSpriteMenuOpen, setNewSpriteMenuOpen] = useState(false);
  /** When non-null, the FbxImporter is mounted (lazy-loads Three.js). */
  const [fbxImporterState, setFbxImporterState] = useState<{
    blob?: Blob;
    config?: FbxBakeConfig;
    spriteId?: string;
  } | null>(null);

  // Preview pane interaction state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(
    null,
  );

  // Animation play preview state.
  const [playing, setPlaying] = useState(false);
  const [playFrame, setPlayFrame] = useState(0);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Save-feedback state.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mf, ss] = await Promise.all([
      EditorProjectStore.loadManifest(projectId),
      EditorProjectStore.listSpriteSources(projectId),
    ]);
    setManifest(mf);
    setSources(ss);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const meta of ss) {
      if (!seen.has(meta.spriteId)) {
        seen.add(meta.spriteId);
        ids.push(meta.spriteId);
      }
    }
    // Manifest sprites with animations — surface them too, even
    // without a source row (so external imports can be reopened).
    if (mf?.sprites) {
      for (const [id, def] of Object.entries(mf.sprites)) {
        if (def.animations && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    ids.sort();
    setSheetSpriteIds(ids);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Tear down any loaded ImageBitmap / object URL when the active
  // sprite changes — keeps memory + GPU resources bounded.
  useEffect(() => {
    return () => {
      if (loadedImage) {
        URL.revokeObjectURL(loadedImage.objectUrl);
        loadedImage.bitmap.close?.();
      }
    };
    // We deliberately let `loadedImage` change without cleanup here —
    // the swap below revokes the old URL itself; this effect only
    // fires on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Load a sprite into the editor by id. If a spriteSources row
   * exists, restore the saved state; otherwise treat the canonical
   * sheet (`images/sprites/<id>-sheet.png`) as the source and surface
   * the "external import" badge.
   */
  const openSprite = useCallback(
    async (spriteId: string) => {
      setSaveError(null);
      setExternalImport(false);
      setActiveAnim(null);
      setPlaying(false);
      const source = await EditorProjectStore.loadSpriteSource(
        projectId,
        spriteId,
      );
      // ── AE2: route FBX-sourced sprites to the FBX importer ──
      // Per ANIMATION_EDITOR.md §7.4, opening an existing FBX sprite
      // restores its config from the spriteSources row and lets the
      // user adjust + re-bake. The dedicated FbxImporter view handles
      // the re-edit flow end-to-end.
      if (source && source.kind === "fbx" && source.fbx) {
        const fbxBlob = await EditorProjectStore.loadAsset(
          projectId,
          source.sourcePath,
        );
        if (!(fbxBlob instanceof Blob)) {
          setSaveError(
            `Source FBX missing for "${spriteId}" (${source.sourcePath}). ` +
              `Re-upload via "+ New sprite" → "From FBX".`,
          );
          return;
        }
        // Reconstruct the bake config from the persisted meta. Clip
        // durations are loaded by the importer when it re-parses the
        // FBX — we pass an empty map; the importer fills it in.
        const { restoreFbxBakeConfig } = await import("../lib/fbxBaker");
        const config = restoreFbxBakeConfig(
          spriteId,
          source.fbx,
          source.animationsMeta,
          source.animationOrder ?? Object.keys(source.animationsMeta),
          source.angles,
          {},
        );
        setFbxImporterState({
          blob: fbxBlob,
          config,
          spriteId,
        });
        setActiveId(spriteId);
        return;
      }
      if (source) {
        const blob = await EditorProjectStore.loadAsset(
          projectId,
          source.sourcePath,
        );
        if (!(blob instanceof Blob)) {
          setSaveError(
            `Source asset missing for "${spriteId}" (${source.sourcePath})`,
          );
          return;
        }
        const img = await decodeBlobToImage(blob);
        if (loadedImage) {
          URL.revokeObjectURL(loadedImage.objectUrl);
          loadedImage.bitmap.close?.();
        }
        setLoadedImage(img);
        setEditorState(
          fromSpriteSourceMeta(source, img.width, img.height),
        );
        setActiveId(spriteId);
        return;
      }
      // No source row — treat the canonical sheet as the source.
      const mf =
        manifest ?? (await EditorProjectStore.loadManifest(projectId));
      const def = mf?.sprites?.[spriteId];
      if (!def) {
        setSaveError(`Sprite "${spriteId}" not in manifest`);
        return;
      }
      const sheetBlob = await EditorProjectStore.loadAsset(
        projectId,
        def.image,
      );
      if (!(sheetBlob instanceof Blob)) {
        setSaveError(
          `Sheet asset missing for "${spriteId}" (${def.image})`,
        );
        return;
      }
      const img = await decodeBlobToImage(sheetBlob);
      if (loadedImage) {
        URL.revokeObjectURL(loadedImage.objectUrl);
        loadedImage.bitmap.close?.();
      }
      setLoadedImage(img);
      setExternalImport(true);
      // Synthesize a state from the manifest's declared grid.
      const synthesized: AnimationEditorState = {
        spriteId,
        sourcePath: def.image,
        imageWidth: img.width,
        imageHeight: img.height,
        frameWidth: def.frameWidth ?? img.width,
        frameHeight: def.frameHeight ?? img.height,
        cols: def.cols ?? 1,
        rows: def.rows ?? 1,
        padding: 0,
        offsetX: 0,
        offsetY: 0,
        angles: def.angles ?? 1,
        animationOrder: def.animations ? Object.keys(def.animations) : [],
        cellMappings: {},
        animationsMeta: {},
        bakedAt: 0,
      };
      if (def.animations) {
        for (const [name, animDef] of Object.entries(def.animations)) {
          synthesized.animationsMeta[name] = {
            frameDuration: animDef.frameDuration,
            loop: animDef.loop ?? true,
            next: animDef.next,
            anglesOverride: animDef.angles,
          };
          // We can't recover the original click order (the manifest's
          // `frames` array is 0..N-1 by construction), but we CAN
          // back-fill plausible cell indices by mapping the
          // (row, col) layout into our flat source-grid model. This
          // gets the user back to a workable starting point.
          const angles = animDef.angles ?? def.angles ?? 1;
          const framesPerAngle = animDef.frames.length;
          const rowBase = (() => {
            let acc = 0;
            for (const k of Object.keys(def.animations ?? {})) {
              if (k === name) return acc;
              const a =
                (def.animations as Record<string, { angles?: number }>)[k]
                  ?.angles ?? def.angles ?? 1;
              acc += a;
            }
            return acc;
          })();
          const indices: number[] = [];
          const cols = def.cols ?? 1;
          for (let angleIdx = 0; angleIdx < angles; angleIdx++) {
            for (let f = 0; f < framesPerAngle; f++) {
              indices.push((rowBase + angleIdx) * cols + f);
            }
          }
          synthesized.cellMappings[name] = indices;
        }
      }
      setEditorState(synthesized);
      setActiveId(spriteId);
    },
    [projectId, manifest, loadedImage],
  );

  // ── Import flow ──

  const handleImportConfirm = useCallback(async () => {
    if (!importFile) {
      setImportError("Pick a PNG first.");
      return;
    }
    const id = importIdDraft.trim();
    if (!/^[a-z0-9_]+$/.test(id)) {
      setImportError(
        "Sprite id must be lowercase letters, digits, or underscores.",
      );
      return;
    }
    setImportError(null);
    try {
      const img = await decodeBlobToImage(importFile);
      const sourcePath = `_source/${id}-source.png`;
      await EditorProjectStore.saveAsset(projectId, sourcePath, importFile);
      const state = initialStateFromImport({
        spriteId: id,
        sourcePath,
        imageWidth: img.width,
        imageHeight: img.height,
      });
      // Persist an initial spriteSources row so this sprite shows up in
      // the left rail immediately even before the first Save.
      await EditorProjectStore.saveSpriteSource(
        projectId,
        id,
        toSpriteSourceMeta(projectId, state),
      );
      if (loadedImage) {
        URL.revokeObjectURL(loadedImage.objectUrl);
        loadedImage.bitmap.close?.();
      }
      setLoadedImage(img);
      setEditorState(state);
      setActiveId(id);
      setActiveAnim(null);
      setExternalImport(false);
      setImportOpen(false);
      setImportFile(null);
      setImportIdDraft("");
      await refresh();
    } catch (err) {
      setImportError((err as Error).message);
    }
  }, [importFile, importIdDraft, projectId, loadedImage, refresh]);

  // ── Animation management ──

  const addAnimation = useCallback(() => {
    if (!editorState) return;
    let i = 1;
    let name = "idle";
    while (editorState.animationOrder.includes(name)) {
      name = `anim${i++}`;
    }
    setEditorState({
      ...editorState,
      animationOrder: [...editorState.animationOrder, name],
      animationsMeta: {
        ...editorState.animationsMeta,
        [name]: blankAnimationMeta(),
      },
      cellMappings: {
        ...editorState.cellMappings,
        [name]: [],
      },
    });
    setActiveAnim(name);
  }, [editorState]);

  const removeAnimation = useCallback(
    (name: string) => {
      if (!editorState) return;
      const order = editorState.animationOrder.filter((n) => n !== name);
      const meta = { ...editorState.animationsMeta };
      delete meta[name];
      const cells = { ...editorState.cellMappings };
      delete cells[name];
      setEditorState({
        ...editorState,
        animationOrder: order,
        animationsMeta: meta,
        cellMappings: cells,
      });
      if (activeAnim === name) setActiveAnim(null);
    },
    [editorState, activeAnim],
  );

  const renameAnimation = useCallback(
    (oldName: string, newName: string) => {
      if (!editorState) return;
      if (oldName === newName) return;
      if (editorState.animationOrder.includes(newName)) return;
      const order = editorState.animationOrder.map((n) =>
        n === oldName ? newName : n,
      );
      const meta = { ...editorState.animationsMeta };
      meta[newName] = meta[oldName]!;
      delete meta[oldName];
      const cells = { ...editorState.cellMappings };
      cells[newName] = cells[oldName] ?? [];
      delete cells[oldName];
      setEditorState({
        ...editorState,
        animationOrder: order,
        animationsMeta: meta,
        cellMappings: cells,
      });
      if (activeAnim === oldName) setActiveAnim(newName);
    },
    [editorState, activeAnim],
  );

  const setAnimationField = useCallback(
    <K extends keyof AnimationEditorState["animationsMeta"][string]>(
      name: string,
      field: K,
      value: AnimationEditorState["animationsMeta"][string][K],
    ) => {
      if (!editorState) return;
      setEditorState({
        ...editorState,
        animationsMeta: {
          ...editorState.animationsMeta,
          [name]: {
            ...editorState.animationsMeta[name]!,
            [field]: value,
          },
        },
      });
    },
    [editorState],
  );

  // ── Cell-picker ──

  const cellClick = useCallback(
    (index: number, button: number) => {
      if (!editorState || !activeAnim) return;
      const cells = [...(editorState.cellMappings[activeAnim] ?? [])];
      if (button === 2) {
        // Right-click → remove the last occurrence of this cell.
        const last = cells.lastIndexOf(index);
        if (last !== -1) cells.splice(last, 1);
      } else {
        cells.push(index);
      }
      setEditorState({
        ...editorState,
        cellMappings: { ...editorState.cellMappings, [activeAnim]: cells },
      });
    },
    [editorState, activeAnim],
  );

  // ── Bake / save ──

  const validation = useMemo<ValidationIssue[]>(() => {
    if (!editorState) return [];
    return validateState(editorState);
  }, [editorState]);

  const hasErrors = useMemo(
    () => validation.some((v) => v.kind === "error"),
    [validation],
  );

  /**
   * Compose the canonical sheet on a hidden `<canvas>` and convert it
   * to a PNG blob. Bound to the DOM via `document.createElement`; the
   * smoke test bypasses this and supplies a synthetic blob.
   */
  const compositeAndEncode = useCallback(async (): Promise<Blob | null> => {
    if (!editorState || !loadedImage) return null;
    const plan = buildCompositePlan(editorState);
    const canvas = document.createElement("canvas");
    canvas.width = plan.outWidth;
    canvas.height = plan.outHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    composite(ctx, plan, loadedImage.bitmap, editorState);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
  }, [editorState, loadedImage]);

  const handleSave = useCallback(async () => {
    if (!editorState) return;
    if (hasErrors) {
      setSaveError(
        validation.find((v) => v.kind === "error")?.message ??
          "Validation failed",
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const blob = await compositeAndEncode();
      if (!blob) throw new Error("Failed to encode canonical PNG.");
      const result = await saveBakedSprite(projectId, editorState, blob);
      setManifest(result.manifest);
      setEditorState({ ...editorState, bakedAt: Date.now() });
      setSavedAt(Date.now());
      onManifestChanged?.();
      await refresh();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [
    editorState,
    hasErrors,
    validation,
    compositeAndEncode,
    projectId,
    onManifestChanged,
    refresh,
  ]);

  // ── Live playback preview ──

  const previewFramesPerAngle = activeAnim
    ? framesPerAngleFor(editorState!, activeAnim)
    : 0;

  useEffect(() => {
    if (!playing || !editorState || !activeAnim) {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }
    const meta = editorState.animationsMeta[activeAnim];
    if (!meta || previewFramesPerAngle === 0) return;
    playTimerRef.current = setInterval(() => {
      setPlayFrame((f) => {
        const next = f + 1;
        if (next >= previewFramesPerAngle) {
          return meta.loop ? 0 : previewFramesPerAngle - 1;
        }
        return next;
      });
    }, meta.frameDuration * 1000);
    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [playing, editorState, activeAnim, previewFramesPerAngle]);

  // ── Keyboard shortcuts ──

  useEffect(() => {
    if (!editorState) return;
    const handler = (ev: KeyboardEvent) => {
      // Ignore when typing in inputs / textareas.
      const t = ev.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // 1-9 → select that animation by ordinal.
      if (/^[1-9]$/.test(ev.key)) {
        const idx = Number(ev.key) - 1;
        const name = editorState.animationOrder[idx];
        if (name) setActiveAnim(name);
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (!activeAnim) return;
        const cells = [...(editorState.cellMappings[activeAnim] ?? [])];
        if (cells.length === 0) return;
        cells.pop();
        setEditorState({
          ...editorState,
          cellMappings: { ...editorState.cellMappings, [activeAnim]: cells },
        });
        ev.preventDefault();
        return;
      }
      if (ev.key === "a" || ev.key === "A") {
        setPlayFrame((f) =>
          Math.max(0, f - 1),
        );
        return;
      }
      if (ev.key === "d" || ev.key === "D") {
        if (previewFramesPerAngle > 0) {
          setPlayFrame((f) =>
            Math.min(previewFramesPerAngle - 1, f + 1),
          );
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorState, activeAnim, previewFramesPerAngle]);

  // ── Render ──

  const grid = editorState
    ? {
        cellW: editorState.frameWidth,
        cellH: editorState.frameHeight,
        cols: editorState.cols,
        rows: editorState.rows,
      }
    : null;

  /** Index → highlight color when this cell is in `activeAnim`. */
  const cellHighlights = useMemo(() => {
    const out = new Map<number, number>();
    if (!editorState || !activeAnim) return out;
    const cells = editorState.cellMappings[activeAnim] ?? [];
    cells.forEach((idx, i) => {
      out.set(idx, i);
    });
    return out;
  }, [editorState, activeAnim]);

  return (
    <div className="flex h-full min-h-[640px]">
      {/* Left rail: sprite list. */}
      <aside className="w-60 border-r border-zinc-800 bg-zinc-950/40 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800 relative">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => setNewSpriteMenuOpen((p) => !p)}
          >
            + New sprite
          </Button>
          {newSpriteMenuOpen ? (
            <div className="absolute left-4 right-4 mt-1 z-10 rounded border border-zinc-700 bg-zinc-900 shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setNewSpriteMenuOpen(false);
                  setImportOpen(true);
                }}
                className="block w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <div className="font-medium">From spritesheet</div>
                <div className="text-zinc-500 text-[11px]">
                  Path A · hand-painted PNG
                </div>
              </button>
              <button
                onClick={() => {
                  setNewSpriteMenuOpen(false);
                  setFbxImporterState({});
                }}
                className="block w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 border-t border-zinc-800"
              >
                <div className="font-medium">From FBX (3D model)</div>
                <div className="text-zinc-500 text-[11px]">
                  Path B · auto-render multi-angle
                </div>
              </button>
            </div>
          ) : null}
        </div>
        <ul className="flex-1 overflow-auto divide-y divide-zinc-800">
          {sheetSpriteIds.length === 0 ? (
            <li className="px-4 py-3 text-xs text-zinc-500">
              No animation sprites yet. Click "+ New sprite" to import a
              spritesheet.
            </li>
          ) : null}
          {sheetSpriteIds.map((id) => {
            const src = sources.find((s) => s.spriteId === id);
            return (
              <li
                key={id}
                onClick={() => openSprite(id)}
                className={cn(
                  "px-4 py-2 cursor-pointer hover:bg-zinc-800/40",
                  activeId === id && "bg-zinc-800/60",
                )}
              >
                <div className="text-sm text-zinc-100">{id}</div>
                <div className="text-xs text-zinc-500">
                  {src
                    ? `${src.grid.cols}×${src.grid.rows} · ${
                        Object.keys(src.cellMappings).length
                      } anim${
                        Object.keys(src.cellMappings).length === 1 ? "" : "s"
                      }`
                    : "imported externally"}
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Center: preview pane. */}
      <section className="flex-1 flex flex-col bg-zinc-950/20 overflow-hidden">
        {editorState && loadedImage && grid ? (
          <>
            <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-3 text-xs text-zinc-400">
              <span>
                Sheet: <strong className="text-zinc-200">{editorState.spriteId}</strong>
              </span>
              <span>·</span>
              <span>
                {loadedImage.width}×{loadedImage.height} px
              </span>
              <span>·</span>
              <span>
                Cell {grid.cellW}×{grid.cellH} · Grid {grid.cols}×{grid.rows}
              </span>
              {externalImport ? (
                <span
                  className="ml-auto rounded bg-amber-700/40 text-amber-100 px-2 py-0.5"
                  title="No sprite-source meta — opened from compiled sheet"
                >
                  Imported externally — round-trip approximate
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
                >
                  −
                </Button>
                <span className="text-zinc-500 w-12 text-right">
                  {(zoom * 100).toFixed(0)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                >
                  +
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
            <div
              className="flex-1 overflow-hidden relative"
              onWheel={(e) => {
                e.preventDefault();
                setZoom((z) => {
                  const delta = e.deltaY > 0 ? 0.9 : 1.1;
                  return Math.max(0.25, Math.min(8, z * delta));
                });
              }}
              onMouseDown={(e) => {
                // Middle-click drag = pan; left/right click on cell = paint.
                if (e.button === 1) {
                  e.preventDefault();
                  setPanning(true);
                  panRef.current = {
                    x: pan.x,
                    y: pan.y,
                    startX: e.clientX,
                    startY: e.clientY,
                  };
                }
              }}
              onMouseMove={(e) => {
                if (panning && panRef.current) {
                  setPan({
                    x:
                      panRef.current.x +
                      (e.clientX - panRef.current.startX),
                    y:
                      panRef.current.y +
                      (e.clientY - panRef.current.startY),
                  });
                }
              }}
              onMouseUp={() => {
                setPanning(false);
                panRef.current = null;
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div
                className="absolute"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <img
                  src={loadedImage.objectUrl}
                  alt={editorState.spriteId}
                  style={{
                    width: loadedImage.width,
                    height: loadedImage.height,
                    imageRendering: "pixelated",
                    display: "block",
                  }}
                  draggable={false}
                />
                {/* Grid + cell overlays */}
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={loadedImage.width}
                  height={loadedImage.height}
                >
                  {/* vertical lines */}
                  {Array.from({ length: grid.cols + 1 }, (_, c) => {
                    const x =
                      editorState.offsetX + c * (grid.cellW + editorState.padding);
                    return (
                      <line
                        key={`v${c}`}
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={loadedImage.height}
                        stroke="rgba(74, 222, 128, 0.6)"
                        strokeWidth={1 / zoom}
                      />
                    );
                  })}
                  {/* horizontal lines */}
                  {Array.from({ length: grid.rows + 1 }, (_, r) => {
                    const y =
                      editorState.offsetY + r * (grid.cellH + editorState.padding);
                    return (
                      <line
                        key={`h${r}`}
                        x1={0}
                        x2={loadedImage.width}
                        y1={y}
                        y2={y}
                        stroke="rgba(74, 222, 128, 0.6)"
                        strokeWidth={1 / zoom}
                      />
                    );
                  })}
                </svg>
                {/* Clickable cell layer */}
                <div
                  className="absolute top-0 left-0"
                  style={{
                    width: loadedImage.width,
                    height: loadedImage.height,
                  }}
                >
                  {Array.from(
                    { length: grid.cols * grid.rows },
                    (_, i) => {
                      const { col, row } = indexToCell(i, grid.cols);
                      const x =
                        editorState.offsetX +
                        col * (grid.cellW + editorState.padding);
                      const y =
                        editorState.offsetY +
                        row * (grid.cellH + editorState.padding);
                      const order = cellHighlights.get(i);
                      return (
                        <div
                          key={i}
                          onMouseDown={(e) => {
                            // Skip middle-click — that's panning.
                            if (e.button === 1) return;
                            e.preventDefault();
                            cellClick(i, e.button);
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          className="absolute"
                          style={{
                            left: x,
                            top: y,
                            width: grid.cellW,
                            height: grid.cellH,
                            cursor: activeAnim ? "crosshair" : "default",
                            outline:
                              order !== undefined
                                ? `2px solid #f59e0b`
                                : "transparent",
                            outlineOffset: "-2px",
                            background:
                              order !== undefined
                                ? "rgba(245, 158, 11, 0.18)"
                                : "transparent",
                          }}
                        >
                          {order !== undefined ? (
                            <div
                              className="text-[10px] font-bold text-amber-200"
                              style={{
                                position: "absolute",
                                top: 1,
                                left: 1,
                                textShadow: "0 1px 0 rgba(0,0,0,0.8)",
                              }}
                            >
                              {order}
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
            Pick a sprite on the left, or click "+ New sprite" to start.
          </div>
        )}
      </section>

      {/* Right: config panel. */}
      <aside className="w-96 border-l border-zinc-800 bg-zinc-950/40 overflow-auto">
        {editorState ? (
          <div className="p-4 space-y-4">
            <section>
              <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                Grid
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <FieldNumber
                  label="frameWidth"
                  value={editorState.frameWidth}
                  onChange={(v) =>
                    setEditorState({ ...editorState, frameWidth: v })
                  }
                />
                <FieldNumber
                  label="frameHeight"
                  value={editorState.frameHeight}
                  onChange={(v) =>
                    setEditorState({ ...editorState, frameHeight: v })
                  }
                />
                <FieldNumber
                  label="cols"
                  value={editorState.cols}
                  onChange={(v) =>
                    setEditorState({ ...editorState, cols: v })
                  }
                />
                <FieldNumber
                  label="rows"
                  value={editorState.rows}
                  onChange={(v) =>
                    setEditorState({ ...editorState, rows: v })
                  }
                />
                <FieldNumber
                  label="padding"
                  value={editorState.padding}
                  onChange={(v) =>
                    setEditorState({ ...editorState, padding: v })
                  }
                />
                <FieldNumber
                  label="offsetX"
                  value={editorState.offsetX}
                  onChange={(v) =>
                    setEditorState({ ...editorState, offsetX: v })
                  }
                />
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                Angles
              </h3>
              <select
                value={editorState.angles}
                onChange={(e) =>
                  setEditorState({
                    ...editorState,
                    angles: Number(e.target.value) as typeof editorState.angles,
                  })
                }
                className={cn(
                  "flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm",
                  "text-zinc-100 focus-visible:outline-none focus-visible:ring-2",
                  "focus-visible:ring-amber-400",
                )}
              >
                {ALLOWED_ANGLES.map((a) => (
                  <option key={a} value={a}>
                    {a} angle{a === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-1">
                Default for animations without an override. Output rows ={" "}
                {totalOutputRows(editorState)}, cols ={" "}
                {totalOutputCols(editorState)}.
              </p>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wide text-zinc-400">
                  Animations
                </h3>
                <Button variant="ghost" size="sm" onClick={addAnimation}>
                  + Add
                </Button>
              </div>
              {editorState.animationOrder.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  No animations yet. Click "+ Add" then click cells in the
                  preview to assign frames.
                </p>
              ) : null}
              <ul className="space-y-2">
                {editorState.animationOrder.map((name, idx) => {
                  const meta = editorState.animationsMeta[name];
                  const cells = editorState.cellMappings[name] ?? [];
                  if (!meta) return null;
                  const isActive = activeAnim === name;
                  return (
                    <li
                      key={name}
                      className={cn(
                        "rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-2",
                        isActive && "border-amber-500/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          className={cn(
                            "text-xs px-2 py-0.5 rounded",
                            isActive
                              ? "bg-amber-500 text-zinc-950"
                              : "bg-zinc-800 text-zinc-200",
                          )}
                          onClick={() => setActiveAnim(name)}
                        >
                          {idx + 1}
                        </button>
                        <Input
                          value={name}
                          onChange={(e) =>
                            renameAnimation(name, e.target.value)
                          }
                          className="h-7 text-xs flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAnimation(name)}
                        >
                          ×
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className="flex flex-col">
                          <span className="text-zinc-500">frameDuration</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={meta.frameDuration}
                            onChange={(e) =>
                              setAnimationField(
                                name,
                                "frameDuration",
                                Number(e.target.value),
                              )
                            }
                            className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-zinc-500">angles</span>
                          <select
                            value={meta.anglesOverride ?? ""}
                            onChange={(e) =>
                              setAnimationField(
                                name,
                                "anglesOverride",
                                e.target.value
                                  ? (Number(e.target.value) as typeof editorState.angles)
                                  : undefined,
                              )
                            }
                            className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2"
                          >
                            <option value="">(default)</option>
                            {ALLOWED_ANGLES.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 col-span-2">
                          <input
                            type="checkbox"
                            checked={meta.loop ?? true}
                            onChange={(e) =>
                              setAnimationField(name, "loop", e.target.checked)
                            }
                          />
                          <span className="text-zinc-500">loop</span>
                        </label>
                        <label className="flex flex-col col-span-2">
                          <span className="text-zinc-500">next</span>
                          <select
                            value={meta.next ?? ""}
                            onChange={(e) =>
                              setAnimationField(
                                name,
                                "next",
                                e.target.value || undefined,
                              )
                            }
                            className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2"
                          >
                            <option value="">(none)</option>
                            {editorState.animationOrder
                              .filter((n) => n !== name)
                              .map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {cells.length} cell{cells.length === 1 ? "" : "s"} ·
                        rowBase {rowBaseFor(editorState, name)} ·{" "}
                        {framesPerAngleFor(editorState, name)} frames/angle ·{" "}
                        {effectiveAngles(editorState, name)} angles
                      </p>
                      {isActive && cells.length > 0 ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPlaying((p) => !p)}
                          >
                            {playing ? "⏸ Pause" : "▶ Play"}
                          </Button>
                          <span className="text-xs text-zinc-400">
                            frame {playFrame + 1}/{previewFramesPerAngle}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            {validation.length > 0 ? (
              <section className="rounded border border-amber-700/60 bg-amber-900/20 p-2 text-xs space-y-1">
                {validation.map((v, i) => (
                  <div
                    key={i}
                    className={
                      v.kind === "error" ? "text-red-300" : "text-amber-200"
                    }
                  >
                    {v.kind === "error" ? "✕" : "!"} {v.message}
                  </div>
                ))}
              </section>
            ) : null}

            <section className="space-y-2">
              <Button
                variant="primary"
                className="w-full"
                disabled={saving || hasErrors}
                onClick={handleSave}
              >
                {saving ? "Saving…" : "Save sprite"}
              </Button>
              {savedAt ? (
                <p className="text-xs text-emerald-400">
                  Saved {new Date(savedAt).toLocaleTimeString()} —{" "}
                  manifest + canonical PNG written.
                </p>
              ) : null}
              {saveError ? (
                <p className="text-xs text-red-300">{saveError}</p>
              ) : null}
            </section>

            <section className="text-[11px] text-zinc-500 border-t border-zinc-800 pt-3">
              <p className="font-semibold text-zinc-400 mb-1">Shortcuts</p>
              <ul className="space-y-0.5">
                <li>
                  <kbd className="text-zinc-300">1</kbd>–
                  <kbd className="text-zinc-300">9</kbd> — pick animation
                </li>
                <li>
                  <kbd className="text-zinc-300">A</kbd>/
                  <kbd className="text-zinc-300">D</kbd> — prev/next preview
                  frame
                </li>
                <li>
                  <kbd className="text-zinc-300">Del</kbd> — drop last cell
                </li>
                <li>middle-click drag — pan · wheel — zoom</li>
                <li>right-click cell — remove from animation</li>
              </ul>
            </section>
          </div>
        ) : (
          <div className="p-4 text-sm text-zinc-500">
            No sprite selected.
          </div>
        )}
      </aside>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import spritesheet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleImportConfirm}>
              Import
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="ae-import-id">Sprite id</Label>
            <Input
              id="ae-import-id"
              value={importIdDraft}
              onChange={(e) => setImportIdDraft(e.target.value)}
              placeholder="zombie"
              className="mt-1"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Lowercase letters, digits, underscores. Used as the
              manifest key and output filename stem.
            </p>
          </div>
          <div>
            <Label htmlFor="ae-import-file">Source PNG</Label>
            <input
              id="ae-import-file"
              type="file"
              accept="image/png"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs text-zinc-300"
            />
          </div>
          {importError ? (
            <p className="text-xs text-red-300">{importError}</p>
          ) : null}
        </div>
      </Modal>

      {/* AE2 — Path B FBX importer. Lazy-loaded so users who never
          touch FBX never pay the Three.js bundle cost. Mounted at the
          AnimationEditor root so it overlays the whole mode area. */}
      {fbxImporterState ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-zinc-200">
              <div className="bg-zinc-900 border border-zinc-700 rounded p-6">
                Loading three.js (~600 KB)…
              </div>
            </div>
          }
        >
          <FbxImporter
            projectId={projectId}
            initialBlob={fbxImporterState.blob}
            initialConfig={fbxImporterState.config}
            initialSpriteId={fbxImporterState.spriteId}
            onCancel={() => setFbxImporterState(null)}
            onBaked={(id) => {
              // Bake complete — close the importer, refresh the sprite
              // list, and select the newly-baked sprite. We deliberately
              // don't `openSprite(id)` here because that would re-open
              // the FBX importer for round-trip (FBX-kind sprites
              // always route there). The user can click the sprite in
              // the rail explicitly to re-edit.
              setFbxImporterState(null);
              setActiveId(id);
              refresh();
              onManifestChanged?.();
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2 mt-0.5 text-zinc-100"
      />
    </label>
  );
}
