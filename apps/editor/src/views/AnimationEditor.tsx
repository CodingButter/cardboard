import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Film,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save as SaveIcon,
  Search,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { PackManifest, SpriteDef } from "@two_5_d/engine/AssetPack";
import {
  EditorProjectStore,
  type SpriteSourceMeta,
} from "../lib/EditorProjectStore";
import { BakedSpritePreview } from "./BakedSpritePreview";
import {
  ALLOWED_ANGLES,
  buildCompositePlan,
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
import {
  Badge,
  CollapsibleSection,
  EmptyState,
  IconButton,
  PanelHeader,
  ProgressBar,
  PropertyRow,
  ScrollArea,
  Select,
  Slider,
  Toolbar,
  ToggleSwitch,
  Tooltip,
} from "../components/ui/index";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
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
 * spritesheet editor. Mounts as the "Animation" workflow tab in the
 * R3 shell.
 *
 * R4d layout (3-pane shell grammar, EDITOR_REDESIGN.md §7.4 + §6.5):
 *
 *   ┌──────────────┬───────────────────────────────┬──────────────┐
 *   │ Animation    │ BakedSpritePreview + sprite-  │ Per-tab      │
 *   │ clip list +  │ sheet display side-by-side    │ Assets rail  │
 *   │ FBX source   │ (#206 preserved verbatim)     │ + animation  │
 *   │ list         │                               │ inspector    │
 *   └──────────────┴───────────────────────────────┴──────────────┘
 *   │ Bottom strip: bake controls + frame-rate slider + playback   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The data model + bake pipeline are untouched. `lib/animationBaker.ts`
 * still drives the spritesheet path, `lib/fbxBaker.ts` still drives
 * the FBX path, `BakedSpritePreview` still drives the canvas preview.
 * This file is purely the React state + new shell-aware layout.
 *
 * Shell wiring:
 *   - `useEditorActions().register({ save })` — TopBar Save button
 *     persists the current clip config + canonical PNG via
 *     `handleSave` (delegates to `saveBakedSprite`).
 *   - `useStatusBar().setSections(...)` — pushes `clip-count`,
 *     `clip-name`, `bake-state` to the global StatusBar.
 *
 * Preserved verbatim:
 *   - BakedSpritePreview (#206) — embedded both in pure-preview mode
 *     and in side-by-side mode.
 *   - FbxImporter overlay (#200 + #209) — pre-bake lighting +
 *     colorspace fix lives inside that view; we just open it.
 *   - Bake button (#210) — relocated to the bottom strip but the
 *     pipeline is the same `handleSave` call.
 *   - `animationName` field kind (#196) — the `Input` next to the
 *     selected animation lets the user rename clips.
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<AnimationEditorState | null>(
    null,
  );
  const [activeAnim, setActiveAnim] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);

  /**
   * Center-pane mode selector. The same workflow now hosts three
   * surfaces:
   *   "edit"    — the spritesheet cell-picker (Path A re-edit)
   *   "preview" — the read-only baked-PNG preview (default for any
   *               baked sprite the user clicks; opens via openBaked)
   *   "import"  — the import modal (Path A new sprite) — handled
   *               separately via `importOpen`
   * `null` = empty pane (no sprite selected yet).
   *
   * Per the source-vs-baked split: clicking a baked-sprite row routes
   * to "preview", clicking a source row routes to "edit" (or hands off
   * to the FbxImporter for FBX sources).
   */
  const [centerMode, setCenterMode] = useState<"edit" | "preview" | null>(
    null,
  );
  /** PNG blob loaded from the baked sheet — feeds BakedSpritePreview. */
  const [bakedPngBlob, setBakedPngBlob] = useState<Blob | null>(null);

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
  const panRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);

  // Animation play preview state.
  const [playing, setPlaying] = useState(false);
  const [playFrame, setPlayFrame] = useState(0);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Save-feedback state.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // R4d UI state — filter text for the left rail clip list and for
  // the per-tab Assets rail. Local to this view; no need to persist.
  const [clipFilter, setClipFilter] = useState("");
  const [assetFilter, setAssetFilter] = useState("");

  const refresh = useCallback(async () => {
    const [mf, ss] = await Promise.all([
      EditorProjectStore.loadManifest(projectId),
      EditorProjectStore.listSpriteSources(projectId),
    ]);
    setManifest(mf);
    setSources(ss);
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
   * Load a baked sprite for read-only preview. Reads the canonical PNG
   * from the manifest entry (`images/sprites/<id>-sheet.png` by
   * default) and switches the center pane into "preview" mode.
   */
  const openBaked = useCallback(
    async (spriteId: string) => {
      setSaveError(null);
      setActiveAnim(null);
      setPlaying(false);
      const mf =
        manifest ?? (await EditorProjectStore.loadManifest(projectId));
      const def = mf?.sprites?.[spriteId];
      if (!def) {
        setSaveError(`Sprite "${spriteId}" not in manifest`);
        return;
      }
      const blob = await EditorProjectStore.loadAsset(projectId, def.image);
      if (!(blob instanceof Blob)) {
        setSaveError(
          `Baked PNG missing for "${spriteId}" (${def.image}). ` +
            `Re-bake from the Sources section.`,
        );
        return;
      }
      if (loadedImage) {
        URL.revokeObjectURL(loadedImage.objectUrl);
        loadedImage.bitmap.close?.();
        setLoadedImage(null);
      }
      setBakedPngBlob(blob);
      setActiveId(spriteId);
      setCenterMode("preview");
    },
    [projectId, manifest, loadedImage],
  );

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
        setCenterMode(null);
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
        setEditorState(fromSpriteSourceMeta(source, img.width, img.height));
        setActiveId(spriteId);
        setCenterMode("edit");
        return;
      }
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
        setSaveError(`Sheet asset missing for "${spriteId}" (${def.image})`);
        return;
      }
      const img = await decodeBlobToImage(sheetBlob);
      if (loadedImage) {
        URL.revokeObjectURL(loadedImage.objectUrl);
        loadedImage.bitmap.close?.();
      }
      setLoadedImage(img);
      setExternalImport(true);
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
          const angles = animDef.angles ?? def.angles ?? 1;
          const framesPerAngle = animDef.frames.length;
          const rowBase = (() => {
            let acc = 0;
            for (const k of Object.keys(def.animations ?? {})) {
              if (k === name) return acc;
              const a =
                (def.animations as Record<string, { angles?: number }>)[k]
                  ?.angles ??
                def.angles ??
                1;
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
      setCenterMode("edit");
    },
    [projectId, manifest, loadedImage],
  );

  /**
   * Open the source side of a baked sprite for re-edit. Routes FBX
   * sources to the dedicated FBX importer; spritesheet sources hand
   * off to `openSprite` (the legacy cell-picker).
   */
  const openSource = useCallback(
    async (spriteId: string) => {
      setSaveError(null);
      setExternalImport(false);
      setActiveAnim(null);
      setPlaying(false);
      const source = await EditorProjectStore.loadSpriteSource(
        projectId,
        spriteId,
      );
      if (!source) {
        setSaveError(`No source recorded for "${spriteId}".`);
        return;
      }
      if (source.kind === "fbx" && source.fbx) {
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
        setCenterMode(null);
        return;
      }
      await openSprite(spriteId);
    },
    [projectId, openSprite],
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
      setCenterMode("edit");
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

  const handleRebakeSource = useCallback(
    async (spriteId: string) => {
      setSaveError(null);
      const source = await EditorProjectStore.loadSpriteSource(
        projectId,
        spriteId,
      );
      if (!source) {
        setSaveError(`No source recorded for "${spriteId}".`);
        return;
      }
      if (source.kind === "fbx") {
        await openSource(spriteId);
        return;
      }
      const blob = await EditorProjectStore.loadAsset(
        projectId,
        source.sourcePath,
      );
      if (!(blob instanceof Blob)) {
        setSaveError(
          `Source PNG missing for "${spriteId}" (${source.sourcePath}).`,
        );
        return;
      }
      try {
        setSaving(true);
        const img = await decodeBlobToImage(blob);
        const state = fromSpriteSourceMeta(source, img.width, img.height);
        const plan = buildCompositePlan(state);
        const canvas = document.createElement("canvas");
        canvas.width = plan.outWidth;
        canvas.height = plan.outHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        ctx.imageSmoothingEnabled = false;
        composite(ctx, plan, img.bitmap, state);
        const baked = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png"),
        );
        if (!baked) throw new Error("Failed to encode canonical PNG.");
        const result = await saveBakedSprite(projectId, state, baked);
        setManifest(result.manifest);
        setSavedAt(Date.now());
        onManifestChanged?.();
        await refresh();
        URL.revokeObjectURL(img.objectUrl);
        img.bitmap.close?.();
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [projectId, openSource, onManifestChanged, refresh],
  );

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
      const t = ev.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
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
        setPlayFrame((f) => Math.max(0, f - 1));
        return;
      }
      if (ev.key === "d" || ev.key === "D") {
        if (previewFramesPerAngle > 0) {
          setPlayFrame((f) => Math.min(previewFramesPerAngle - 1, f + 1));
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorState, activeAnim, previewFramesPerAngle]);

  // ── EditorActions wiring (R4d) ─────────────────────────────────
  // Shell TopBar Save → save the active clip config + canonical PNG.
  // Only wired when there's an editable Path A state; the FBX
  // importer / BakedSpritePreview surfaces own their own Save / Bake
  // buttons inside the workflow.
  const { register } = useEditorActions();
  useEffect(() => {
    if (!editorState) return undefined;
    return register({
      save: handleSave,
    });
  }, [register, handleSave, editorState]);

  // ── StatusBar wiring (R4d) ─────────────────────────────────────
  // Push clip-count + clip-name + bake-state while mounted.
  //
  // WIRING: `bake-state` is currently derived from local state
  // (`saving`, `saveError`, `savedAt`) — once the bake pipeline emits
  // a structured progress stream (FBX importer + spritesheet baker
  // share a status helper) this section can subscribe to that
  // instead.
  const clipCount = useMemo(() => {
    if (!manifest?.sprites) return 0;
    let n = 0;
    for (const def of Object.values(manifest.sprites)) {
      n += Object.keys(def.animations ?? {}).length;
    }
    return n;
  }, [manifest]);
  const { setSections } = useStatusBar();
  useEffect(() => {
    const bakeState: { label: string; value: string } = saving
      ? { label: "Bake", value: "Baking…" }
      : saveError
        ? { label: "Bake", value: "Stale" }
        : savedAt
          ? { label: "Bake", value: "Baked OK" }
          : { label: "Bake", value: "Idle" };
    setSections([
      {
        id: "clip-count",
        label: "Clips",
        value: String(clipCount),
      },
      {
        id: "clip-name",
        label: "Editing",
        value: activeAnim ?? activeId ?? "—",
      },
      {
        id: "bake-state",
        label: bakeState.label,
        value: bakeState.value,
        align: "right" as const,
      },
    ]);
    return () => setSections([]);
  }, [
    clipCount,
    activeAnim,
    activeId,
    saving,
    saveError,
    savedAt,
    setSections,
  ]);

  // ── Derived rail data ─────────────────────────────────────────

  /**
   * Baked sprites (PNG-backed) — every entry in `manifest.sprites`.
   * The left rail's "Clips" section lists these as the canonical
   * click target.
   */
  const bakedSprites = useMemo<
    Array<{
      id: string;
      def: SpriteDef;
      sourceKind?: SpriteSourceMeta["kind"];
      animCount: number;
    }>
  >(() => {
    if (!manifest?.sprites) return [];
    const sourceByIdMap = new Map(sources.map((s) => [s.spriteId, s]));
    return Object.entries(manifest.sprites)
      .map(([id, def]) => ({
        id,
        def,
        sourceKind: sourceByIdMap.get(id)?.kind,
        animCount: Object.keys(def.animations ?? {}).length,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [manifest, sources]);

  /** Sources (re-editable inputs) — every `spriteSources` row. */
  const sourceSprites = useMemo<
    Array<{ id: string; meta: SpriteSourceMeta }>
  >(() => {
    return [...sources]
      .sort((a, b) => a.spriteId.localeCompare(b.spriteId))
      .map((meta) => ({ id: meta.spriteId, meta }));
  }, [sources]);

  // Filter both sections of the left rail against a single search box.
  const filteredBaked = useMemo(() => {
    const q = clipFilter.trim().toLowerCase();
    if (!q) return bakedSprites;
    return bakedSprites.filter((r) => r.id.toLowerCase().includes(q));
  }, [bakedSprites, clipFilter]);
  const filteredSources = useMemo(() => {
    const q = clipFilter.trim().toLowerCase();
    if (!q) return sourceSprites;
    return sourceSprites.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.meta.sourcePath.toLowerCase().includes(q),
    );
  }, [sourceSprites, clipFilter]);

  /** Per-tab Assets rail — FBX sources + clips on the active sprite. */
  const fbxSources = useMemo(
    () => sourceSprites.filter((s) => s.meta.kind === "fbx"),
    [sourceSprites],
  );
  const activeAnimationClips = useMemo<
    Array<{ name: string; frames: number; duration: number; loop: boolean }>
  >(() => {
    if (!activeId || !manifest?.sprites?.[activeId]?.animations) return [];
    const anims = manifest.sprites[activeId]!.animations!;
    return Object.entries(anims).map(([name, def]) => ({
      name,
      frames: def.frames.length,
      duration: def.frames.length * def.frameDuration,
      loop: def.loop ?? true,
    }));
  }, [activeId, manifest]);
  const filteredFbxSources = useMemo(() => {
    const q = assetFilter.trim().toLowerCase();
    if (!q) return fbxSources;
    return fbxSources.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.meta.sourcePath.toLowerCase().includes(q),
    );
  }, [fbxSources, assetFilter]);
  const filteredClips = useMemo(() => {
    const q = assetFilter.trim().toLowerCase();
    if (!q) return activeAnimationClips;
    return activeAnimationClips.filter((c) =>
      c.name.toLowerCase().includes(q),
    );
  }, [activeAnimationClips, assetFilter]);

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

  // Bake state label — shared between bottom strip + the right rail.
  const bakeStateLabel: {
    label: string;
    variant: "amber" | "emerald" | "zinc" | "red";
  } = saving
    ? { label: "Baking…", variant: "amber" }
    : saveError
      ? { label: "Stale", variant: "red" }
      : savedAt
        ? { label: "Baked OK", variant: "emerald" }
        : { label: "Idle", variant: "zinc" };

  // Frame-rate slider value — drives the active animation's
  // `frameDuration` indirectly via `1 / fps`. The slider operates in
  // FPS for ergonomics; the data model is duration.
  const activeAnimMeta =
    editorState && activeAnim ? editorState.animationsMeta[activeAnim] : null;
  const activeFps = activeAnimMeta
    ? Math.max(1, Math.min(60, Math.round(1 / activeAnimMeta.frameDuration)))
    : 10;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-[640px] bg-zinc-950 text-zinc-100">
      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail (300px): clip list + source list ─── */}
        <aside className="w-[300px] shrink-0 border-r border-zinc-800 bg-zinc-950/40 flex flex-col min-h-0">
          <PanelHeader
            title="Animations"
            action={
              <>
                <Badge variant="zinc">{bakedSprites.length}</Badge>
                <div className="relative">
                  <Tooltip
                    content="New sprite (spritesheet / FBX)"
                    side="bottom"
                  >
                    <IconButton
                      icon={<Plus size={14} />}
                      tooltip="New sprite"
                      variant="primary"
                      size="sm"
                      onClick={() => setNewSpriteMenuOpen((p) => !p)}
                    />
                  </Tooltip>
                  {newSpriteMenuOpen ? (
                    <div className="absolute right-0 mt-1 z-10 w-56 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg overflow-hidden">
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
              </>
            }
          />

          {/* Search input — filters both sections of the rail. */}
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <Input
                value={clipFilter}
                onChange={(e) => setClipFilter(e.target.value)}
                placeholder="Search clips…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>

          <ScrollArea
            className="flex-1 min-h-0"
            data-testid="anim-sprite-rail"
          >
            {/* ── Clips: every baked sprite the user can pick. ── */}
            <div className="px-3 pt-2 pb-1" data-testid="baked-sprites-header">
              <PanelHeader title="Clips" size="sm" />
            </div>
            {filteredBaked.length === 0 && bakedSprites.length === 0 ? (
              <div className="px-3 py-3">
                <EmptyState
                  icon={<Film size={20} />}
                  title="No clips yet"
                  description='Click "+ New sprite" to import a spritesheet or FBX.'
                  tutorial="animation-intro"
                />
              </div>
            ) : null}
            {filteredBaked.length === 0 && bakedSprites.length > 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500">
                No clips match that search.
              </div>
            ) : null}
            <ul className="divide-y divide-zinc-800/60">
              {filteredBaked.map((row) => {
                const angles = row.def.angles ?? 1;
                const active =
                  activeId === row.id && centerMode === "preview";
                return (
                  <li
                    key={`baked:${row.id}`}
                    onClick={() => openBaked(row.id)}
                    data-testid={`baked-sprite-${row.id}`}
                    className={cn(
                      "px-3 py-2 cursor-pointer border-l-2 transition-colors",
                      active
                        ? "bg-amber-500/10 border-amber-400 text-amber-200"
                        : "border-transparent hover:bg-zinc-800/40 text-zinc-100",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Film
                        size={14}
                        className={
                          active ? "text-amber-300" : "text-zinc-500"
                        }
                      />
                      <div className="text-sm flex-1 truncate">{row.id}</div>
                      {row.sourceKind === "fbx" ? (
                        <Tooltip content="Jump to FBX source" side="left">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSource(row.id);
                            }}
                          >
                            <Badge variant="amber">FBX</Badge>
                          </button>
                        </Tooltip>
                      ) : row.sourceKind === "spritesheet" ? (
                        <Tooltip
                          content="Jump to spritesheet source"
                          side="left"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSource(row.id);
                            }}
                          >
                            <Badge variant="zinc">sheet</Badge>
                          </button>
                        </Tooltip>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-zinc-500 ml-6">
                      {row.def.frameWidth ?? "?"}×
                      {row.def.frameHeight ?? "?"} · {angles} angle
                      {angles === 1 ? "" : "s"}
                      {row.animCount > 0
                        ? ` · ${row.animCount} anim${
                            row.animCount === 1 ? "" : "s"
                          }`
                        : ""}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* ── FBX / spritesheet sources: re-editable inputs. ── */}
            <div className="px-3 pt-3 pb-1" data-testid="sources-header">
              <PanelHeader title="Sources" size="sm" />
            </div>
            {filteredSources.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500">
                {sourceSprites.length === 0
                  ? "No editable sources yet."
                  : "No sources match that search."}
              </div>
            ) : null}
            <ul className="divide-y divide-zinc-800/60">
              {filteredSources.map(({ id, meta }) => {
                const isFbx = meta.kind === "fbx";
                const sourceFile =
                  meta.sourcePath.split("/").pop() ?? meta.sourcePath;
                const cc = meta.fbx?.enabledClips.length ?? 0;
                const active =
                  activeId === id && centerMode !== "preview";
                return (
                  <li
                    key={`source:${id}`}
                    onClick={() => openSource(id)}
                    data-testid={`source-${id}`}
                    className={cn(
                      "px-3 py-2 cursor-pointer border-l-2 transition-colors",
                      active
                        ? "bg-amber-500/10 border-amber-400 text-amber-200"
                        : "border-transparent hover:bg-zinc-800/40 text-zinc-100",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Layers
                        size={14}
                        className={
                          active ? "text-amber-300" : "text-zinc-500"
                        }
                      />
                      <div className="text-sm flex-1 truncate">
                        {sourceFile}
                      </div>
                      <Tooltip
                        content="Re-bake this source into its linked sprite"
                        side="left"
                      >
                        <IconButton
                          icon={<RefreshCw size={12} />}
                          tooltip="Re-bake"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRebakeSource(id);
                          }}
                        />
                      </Tooltip>
                    </div>
                    <div className="text-[11px] text-zinc-500 ml-6">
                      {isFbx
                        ? `${cc} clip${cc === 1 ? "" : "s"} → "${id}"`
                        : `${meta.grid.cols}×${meta.grid.rows} → "${id}"`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </aside>

        {/* ─── Center (fluid): BakedSpritePreview + spritesheet display ─── */}
        <section className="flex-1 min-w-0 overflow-hidden flex flex-col bg-zinc-950/20">
          {/* Top toolbar — sheet info + zoom/pan controls. Only shown
              in edit mode (preview mode owns its own header). */}
          {editorState && loadedImage && grid && centerMode !== "preview" ? (
            <div className="px-3 pt-3 pb-2">
              <Toolbar
                groups={[
                  {
                    id: "sheet-info",
                    children: (
                      <div className="flex items-center gap-2 text-xs text-zinc-400 px-2">
                        <span>
                          Sheet:{" "}
                          <strong className="text-zinc-200">
                            {editorState.spriteId}
                          </strong>
                        </span>
                        <span className="text-zinc-700">·</span>
                        <span>
                          {loadedImage.width}×{loadedImage.height}
                        </span>
                        <span className="text-zinc-700">·</span>
                        <span>
                          Cell {grid.cellW}×{grid.cellH} · Grid {grid.cols}×
                          {grid.rows}
                        </span>
                      </div>
                    ),
                  },
                  {
                    id: "zoom",
                    children: (
                      <>
                        <Tooltip content="Zoom out" side="bottom">
                          <IconButton
                            icon={<span className="text-base leading-none">−</span>}
                            tooltip="Zoom out"
                            size="sm"
                            onClick={() =>
                              setZoom((z) => Math.max(0.25, z / 1.25))
                            }
                          />
                        </Tooltip>
                        <span className="text-[11px] text-zinc-400 font-mono w-12 text-center tabular-nums">
                          {(zoom * 100).toFixed(0)}%
                        </span>
                        <Tooltip content="Zoom in" side="bottom">
                          <IconButton
                            icon={<span className="text-base leading-none">+</span>}
                            tooltip="Zoom in"
                            size="sm"
                            onClick={() =>
                              setZoom((z) => Math.min(8, z * 1.25))
                            }
                          />
                        </Tooltip>
                        <Tooltip content="Reset view" side="bottom">
                          <IconButton
                            icon={<RotateCcw size={14} />}
                            tooltip="Reset view"
                            size="sm"
                            onClick={() => {
                              setZoom(1);
                              setPan({ x: 0, y: 0 });
                            }}
                          />
                        </Tooltip>
                      </>
                    ),
                  },
                ]}
                tail={
                  externalImport ? (
                    <Badge variant="amber">External · approximate</Badge>
                  ) : null
                }
              />
            </div>
          ) : null}

          <div className="flex-1 min-h-0 overflow-hidden">
            {centerMode === "preview" &&
            activeId &&
            bakedPngBlob &&
            manifest?.sprites?.[activeId] ? (
              // Pure preview surface — clicked from the rail's
              // "Clips" section. Preserves BakedSpritePreview (#206)
              // verbatim.
              <div className="h-full overflow-auto">
                <BakedSpritePreview
                  spriteId={activeId}
                  sprite={manifest.sprites[activeId]!}
                  pngBlob={bakedPngBlob}
                  sourceMeta={sources.find((s) => s.spriteId === activeId)}
                  onRebake={
                    sources.find((s) => s.spriteId === activeId)
                      ? () => handleRebakeSource(activeId)
                      : undefined
                  }
                  onOpenSource={
                    sources.find((s) => s.spriteId === activeId)
                      ? () => openSource(activeId)
                      : undefined
                  }
                />
              </div>
            ) : editorState && loadedImage && grid ? (
              // Source-editor surface — side-by-side BakedSpritePreview
              // + spritesheet cell-picker when a baked PNG already
              // exists for this sprite. Per §7.4.
              <div
                className={cn(
                  "h-full grid gap-3 px-3 pb-3 min-h-0",
                  bakedPngBlob && manifest?.sprites?.[editorState.spriteId]
                    ? "grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
                    : "grid-cols-1",
                )}
              >
                {bakedPngBlob &&
                manifest?.sprites?.[editorState.spriteId] ? (
                  <div className="min-w-0 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/40">
                    <BakedSpritePreview
                      spriteId={editorState.spriteId}
                      sprite={manifest.sprites[editorState.spriteId]!}
                      pngBlob={bakedPngBlob}
                      sourceMeta={sources.find(
                        (s) => s.spriteId === editorState.spriteId,
                      )}
                    />
                  </div>
                ) : null}

                {/* Spritesheet cell-picker. Preserved verbatim from the
                    legacy editor — only the surrounding chrome moved. */}
                <div
                  className="min-w-0 overflow-hidden relative rounded-lg border border-zinc-800 bg-zinc-950/40"
                  onWheel={(e) => {
                    e.preventDefault();
                    setZoom((z) => {
                      const delta = e.deltaY > 0 ? 0.9 : 1.1;
                      return Math.max(0.25, Math.min(8, z * delta));
                    });
                  }}
                  onMouseDown={(e) => {
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
                    <svg
                      className="absolute top-0 left-0 pointer-events-none"
                      width={loadedImage.width}
                      height={loadedImage.height}
                    >
                      {Array.from({ length: grid.cols + 1 }, (_, c) => {
                        const x =
                          editorState.offsetX +
                          c * (grid.cellW + editorState.padding);
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
                      {Array.from({ length: grid.rows + 1 }, (_, r) => {
                        const y =
                          editorState.offsetY +
                          r * (grid.cellH + editorState.padding);
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
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  icon={<Film size={28} />}
                  title="No animation selected"
                  description={
                    'Pick a clip on the left, or click "+ New sprite" to import a spritesheet or FBX.'
                  }
                  tutorial="animation-intro"
                />
              </div>
            )}
          </div>
        </section>

        {/* ─── Right rail (380px): per-tab Assets + Animation inspector ─── */}
        <aside className="w-[380px] shrink-0 border-l border-zinc-800 bg-zinc-950/40 flex flex-col min-h-0">
          <PanelHeader
            title="Assets"
            action={
              <Badge variant="zinc">
                {fbxSources.length + activeAnimationClips.length}
              </Badge>
            }
          />
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <Input
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                placeholder="Search assets…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-3">
              <CollapsibleSection
                title={`FBX sources (${filteredFbxSources.length})`}
                defaultOpen
                icon={<Layers size={12} />}
              >
                {filteredFbxSources.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-1">
                    No FBX sources imported yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filteredFbxSources.map((s) => (
                      <li
                        key={`fbx:${s.id}`}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-800/40 cursor-pointer"
                        onClick={() => openSource(s.id)}
                      >
                        <div className="min-w-0 truncate">
                          <div className="text-zinc-100 truncate">{s.id}</div>
                          <div className="text-[10px] text-zinc-500 truncate">
                            {s.meta.sourcePath}
                          </div>
                        </div>
                        <Tooltip content="Re-bake" side="left">
                          <IconButton
                            icon={<RefreshCw size={12} />}
                            tooltip="Re-bake"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRebakeSource(s.id);
                            }}
                          />
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleSection>

              <CollapsibleSection
                title={`Clips on "${activeId ?? "—"}" (${filteredClips.length})`}
                defaultOpen
                icon={<Film size={12} />}
              >
                {filteredClips.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-1">
                    {activeId
                      ? "No clips on this sprite yet."
                      : "Select a sprite to see its clips."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filteredClips.map((c) => (
                      <li
                        key={`clip:${c.name}`}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-xs cursor-pointer",
                          activeAnim === c.name
                            ? "bg-amber-500/10 text-amber-200 border border-amber-500/30"
                            : "hover:bg-zinc-800/40 text-zinc-200 border border-transparent",
                        )}
                        onClick={() => setActiveAnim(c.name)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{c.name}</span>
                          {c.loop ? (
                            <Badge variant="zinc">loop</Badge>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {c.frames} frames · {c.duration.toFixed(2)}s
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleSection>

              {/* Animation properties inspector. */}
              {editorState ? (
                <CollapsibleSection
                  title={
                    activeAnim ? `Inspector — ${activeAnim}` : "Sprite grid"
                  }
                  defaultOpen
                >
                  {activeAnim && activeAnimMeta ? (
                    <div>
                      <PropertyRow
                        label="Name"
                        hint="Manifest animation key (#196)."
                      >
                        <Input
                          value={activeAnim}
                          onChange={(e) =>
                            renameAnimation(activeAnim, e.target.value)
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow
                        label="Frame rate"
                        unit="fps"
                        hint={`${activeAnimMeta.frameDuration.toFixed(
                          3,
                        )}s / frame`}
                      >
                        <Slider
                          value={activeFps}
                          min={1}
                          max={60}
                          step={1}
                          onChange={(fps) =>
                            setAnimationField(
                              activeAnim,
                              "frameDuration",
                              1 / Math.max(1, fps),
                            )
                          }
                          valueLabel={`${activeFps}`}
                        />
                      </PropertyRow>
                      <PropertyRow label="Loop">
                        <ToggleSwitch
                          checked={activeAnimMeta.loop ?? true}
                          onChange={(v) =>
                            setAnimationField(activeAnim, "loop", v)
                          }
                          aria-label="Loop animation"
                        />
                      </PropertyRow>
                      <PropertyRow label="Angles override">
                        <Select
                          value={
                            activeAnimMeta.anglesOverride !== undefined
                              ? String(activeAnimMeta.anglesOverride)
                              : ""
                          }
                          onChange={(e) =>
                            setAnimationField(
                              activeAnim,
                              "anglesOverride",
                              e.target.value
                                ? (Number(
                                    e.target.value,
                                  ) as typeof editorState.angles)
                                : undefined,
                            )
                          }
                          size="sm"
                          options={[
                            { value: "", label: "(default)" },
                            ...ALLOWED_ANGLES.map((a) => ({
                              value: String(a),
                              label: String(a),
                            })),
                          ]}
                        />
                      </PropertyRow>
                      <PropertyRow label="Next clip">
                        <Select
                          value={activeAnimMeta.next ?? ""}
                          onChange={(e) =>
                            setAnimationField(
                              activeAnim,
                              "next",
                              e.target.value || undefined,
                            )
                          }
                          size="sm"
                          options={[
                            { value: "", label: "(none)" },
                            ...editorState.animationOrder
                              .filter((n) => n !== activeAnim)
                              .map((n) => ({ value: n, label: n })),
                          ]}
                        />
                      </PropertyRow>
                      <p className="text-[11px] text-zinc-500 pt-1">
                        rowBase {rowBaseFor(editorState, activeAnim)} ·{" "}
                        {framesPerAngleFor(editorState, activeAnim)}{" "}
                        frames/angle ·{" "}
                        {effectiveAngles(editorState, activeAnim)} angles
                      </p>
                      <div className="flex items-center gap-2 pt-2">
                        <Tooltip content="Delete clip" side="top">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeAnimation(activeAnim)}
                          >
                            Remove
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <PropertyRow label="frameWidth" unit="px">
                        <Input
                          type="number"
                          value={editorState.frameWidth}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              frameWidth: Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow label="frameHeight" unit="px">
                        <Input
                          type="number"
                          value={editorState.frameHeight}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              frameHeight: Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow label="cols">
                        <Input
                          type="number"
                          value={editorState.cols}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              cols: Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow label="rows">
                        <Input
                          type="number"
                          value={editorState.rows}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              rows: Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow label="padding">
                        <Input
                          type="number"
                          value={editorState.padding}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              padding: Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </PropertyRow>
                      <PropertyRow label="Angles">
                        <Select
                          value={String(editorState.angles)}
                          onChange={(e) =>
                            setEditorState({
                              ...editorState,
                              angles: Number(
                                e.target.value,
                              ) as typeof editorState.angles,
                            })
                          }
                          size="sm"
                          options={ALLOWED_ANGLES.map((a) => ({
                            value: String(a),
                            label: `${a} angle${a === 1 ? "" : "s"}`,
                          }))}
                        />
                      </PropertyRow>
                      <p className="text-[11px] text-zinc-500 pt-1">
                        Output rows = {totalOutputRows(editorState)}, cols ={" "}
                        {totalOutputCols(editorState)}
                      </p>
                      <div className="pt-2">
                        <Tooltip content="Add a new clip" side="top">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={addAnimation}
                          >
                            <Plus size={12} className="mr-1" />
                            Add clip
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </CollapsibleSection>
              ) : null}

              {/* Validation issues. */}
              {validation.length > 0 ? (
                <CollapsibleSection
                  title={`Validation (${validation.length})`}
                  defaultOpen
                  trailing={
                    <Badge variant={hasErrors ? "red" : "amber"}>
                      {hasErrors ? "errors" : "warn"}
                    </Badge>
                  }
                >
                  <ul className="space-y-1 text-xs">
                    {validation.map((v, i) => (
                      <li
                        key={i}
                        className={
                          v.kind === "error"
                            ? "text-red-300"
                            : "text-amber-200"
                        }
                      >
                        {v.kind === "error" ? "✕" : "!"} {v.message}
                      </li>
                    ))}
                  </ul>
                </CollapsibleSection>
              ) : null}

              {/* Shortcuts cheat-sheet. */}
              <CollapsibleSection title="Shortcuts">
                <ul className="space-y-1 text-[11px] text-zinc-500">
                  <li>
                    <kbd className="text-zinc-300">1</kbd>–
                    <kbd className="text-zinc-300">9</kbd> — pick animation
                  </li>
                  <li>
                    <kbd className="text-zinc-300">A</kbd>/
                    <kbd className="text-zinc-300">D</kbd> — prev/next preview
                  </li>
                  <li>
                    <kbd className="text-zinc-300">Del</kbd> — drop last cell
                  </li>
                  <li>middle-click drag — pan · wheel — zoom</li>
                  <li>right-click cell — remove from animation</li>
                </ul>
              </CollapsibleSection>
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* ─── Bottom strip: bake controls + frame-rate slider + playback ─── */}
      <div className="border-t border-zinc-800 bg-zinc-950/60 px-3 py-2 min-h-[56px]">
        <Toolbar
          groups={[
            {
              id: "bake",
              children: (
                <>
                  <Tooltip
                    content={
                      hasErrors
                        ? "Resolve validation errors before baking"
                        : "Bake the current sprite (#210)"
                    }
                    side="top"
                  >
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={saving || hasErrors || !editorState}
                      onClick={handleSave}
                    >
                      <SaveIcon size={12} className="mr-1" />
                      {saving ? "Baking…" : "Bake"}
                    </Button>
                  </Tooltip>
                  <Badge variant={bakeStateLabel.variant}>
                    {bakeStateLabel.label}
                  </Badge>
                  {saving ? (
                    <div className="w-32">
                      <ProgressBar value={0} indeterminate size="sm" />
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              id: "frame-rate",
              children:
                activeAnim && activeAnimMeta ? (
                  <>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                      Rate
                    </span>
                    <div className="w-40">
                      <Slider
                        value={activeFps}
                        min={1}
                        max={60}
                        step={1}
                        onChange={(fps) =>
                          setAnimationField(
                            activeAnim,
                            "frameDuration",
                            1 / Math.max(1, fps),
                          )
                        }
                        valueLabel={`${activeFps} fps`}
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-[11px] text-zinc-500 px-2">
                    No clip selected
                  </span>
                ),
            },
            {
              id: "playback",
              children: (
                <>
                  <Tooltip content="Step back one frame" side="top">
                    <IconButton
                      icon={<SkipBack size={14} />}
                      tooltip="Step back"
                      size="sm"
                      disabled={!activeAnim || previewFramesPerAngle === 0}
                      onClick={() =>
                        setPlayFrame((f) => Math.max(0, f - 1))
                      }
                    />
                  </Tooltip>
                  <Tooltip content={playing ? "Pause" : "Play"} side="top">
                    <IconButton
                      icon={
                        playing ? <Pause size={14} /> : <Play size={14} />
                      }
                      tooltip={playing ? "Pause" : "Play"}
                      variant={playing ? "primary" : "ghost"}
                      size="sm"
                      disabled={!activeAnim || previewFramesPerAngle === 0}
                      onClick={() => setPlaying((p) => !p)}
                    />
                  </Tooltip>
                  <Tooltip content="Step forward one frame" side="top">
                    <IconButton
                      icon={<SkipForward size={14} />}
                      tooltip="Step forward"
                      size="sm"
                      disabled={!activeAnim || previewFramesPerAngle === 0}
                      onClick={() =>
                        setPlayFrame((f) =>
                          Math.min(
                            Math.max(0, previewFramesPerAngle - 1),
                            f + 1,
                          ),
                        )
                      }
                    />
                  </Tooltip>
                  <span className="text-[11px] text-zinc-400 font-mono tabular-nums px-2">
                    {previewFramesPerAngle > 0
                      ? `${playFrame + 1}/${previewFramesPerAngle}`
                      : "—"}
                  </span>
                </>
              ),
            },
          ]}
          tail={
            savedAt && !saving && !saveError ? (
              <span className="text-[11px] text-emerald-400 px-2">
                Saved {new Date(savedAt).toLocaleTimeString()}
              </span>
            ) : saveError ? (
              <Tooltip content={saveError} side="top">
                <Badge variant="red">Save failed</Badge>
              </Tooltip>
            ) : null
          }
        />
      </div>

      {/* Import modal — Path A new-sprite flow. */}
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
              Lowercase letters, digits, underscores. Used as the manifest
              key and output filename stem.
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
          touch FBX never pay the Three.js bundle cost. Preserved
          verbatim (#200 + #209 — pre-bake lighting + colorspace fix
          live inside that view). */}
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
