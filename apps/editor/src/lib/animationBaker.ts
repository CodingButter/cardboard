/**
 * Animation baker — DOM-free helpers for AE1 of the Animation editor.
 *
 * Splits the heavy logic out of the React component so:
 *  1. The smoke test (`scripts/smoke-anim-editor.ts`) can exercise the
 *     full import → grid-config → cell-assign → save pipeline without
 *     mounting a DOM.
 *  2. The actual editor UI is thin — it only owns React state and
 *     calls into pure functions here.
 *
 * Per `docs/plans/ANIMATION_EDITOR.md` §9 + ANIMATIONS.md §5, AE1 is
 * Path A only (bring-your-own spritesheet). The canonical output PNG
 * encodes a row-per-(animation × angle), col-per-frame layout the
 * engine reads unmodified. AE1 stays canvas2D — no Three.js dep.
 */

import type {
  SpriteDef,
  AnimationDef,
  SpriteAngleCount,
  PackManifest,
} from "@two_5_d/engine/AssetPack";
import {
  EditorProjectStore,
  type SpriteSourceMeta,
} from "./EditorProjectStore";

/**
 * Single source of truth for which angle values the engine accepts.
 * Mirrors `SpriteAngleCount` in `packages/engine/src/AssetPack/types.ts`.
 */
export const ALLOWED_ANGLES: readonly SpriteAngleCount[] = [
  1, 2, 4, 5, 8, 16,
];

/** Common cell sizes the auto-detect heuristic probes. */
const AUTO_DETECT_CELLS = [16, 24, 32, 48, 64, 96, 128] as const;

/**
 * The shape held in editor state for one in-progress sprite. Maps 1:1
 * to a `SpriteSourceMeta` row in IDB — the editor edits this in
 * memory and persists it on Save.
 */
export interface AnimationEditorState {
  spriteId: string;
  sourcePath: string;
  /** Source image dimensions (read from the PNG). */
  imageWidth: number;
  imageHeight: number;
  /** Grid config (input image's cell layout). */
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  padding: number;
  offsetX: number;
  offsetY: number;
  /** Default angles for animations that don't override. */
  angles: SpriteAngleCount;
  /** Ordered list of animation keys — preserved across mutations. */
  animationOrder: string[];
  /** Per-animation cell-index lists (clicks in the preview pane). */
  cellMappings: Record<string, number[]>;
  /** Per-animation runtime fields. */
  animationsMeta: Record<
    string,
    {
      frameDuration: number;
      loop: boolean;
      next?: string;
      anglesOverride?: SpriteAngleCount;
    }
  >;
  /** Last bake epoch ms; 0 if never baked. */
  bakedAt: number;
}

/**
 * Build an initial editor state for a freshly imported sheet. The
 * caller has already read the PNG (passed dimensions); we auto-detect
 * a sane grid by probing common power-of-2 / 24-pixel cell sizes.
 */
export function initialStateFromImport(args: {
  spriteId: string;
  sourcePath: string;
  imageWidth: number;
  imageHeight: number;
}): AnimationEditorState {
  const grid = autoDetectGrid(args.imageWidth, args.imageHeight);
  return {
    spriteId: args.spriteId,
    sourcePath: args.sourcePath,
    imageWidth: args.imageWidth,
    imageHeight: args.imageHeight,
    frameWidth: grid.frameWidth,
    frameHeight: grid.frameHeight,
    cols: grid.cols,
    rows: grid.rows,
    padding: 0,
    offsetX: 0,
    offsetY: 0,
    angles: 1,
    animationOrder: [],
    cellMappings: {},
    animationsMeta: {},
    bakedAt: 0,
  };
}

/**
 * Probe AUTO_DETECT_CELLS for the largest cell size that divides both
 * `width` and `height` evenly. Falls back to 1×1 (single-cell sheet)
 * if nothing divides — that's not actually a useful default but it's
 * a deterministic answer the user can correct via the config panel.
 */
export function autoDetectGrid(
  width: number,
  height: number,
): { frameWidth: number; frameHeight: number; cols: number; rows: number } {
  // Walk largest → smallest so we land on the most "spritesheet-y"
  // guess (a 1024×1024 sheet with 64-px cells = 16×16, not 32×32).
  for (let i = AUTO_DETECT_CELLS.length - 1; i >= 0; i--) {
    const cell = AUTO_DETECT_CELLS[i]!;
    if (width % cell === 0 && height % cell === 0) {
      // Bail on absurd cell counts (a 1024×1024 sheet with 16-px
      // cells = 64×64 = 4096 cells; pick the next size up).
      if (width / cell <= 64 && height / cell <= 64) {
        return {
          frameWidth: cell,
          frameHeight: cell,
          cols: width / cell,
          rows: height / cell,
        };
      }
    }
  }
  return { frameWidth: width, frameHeight: height, cols: 1, rows: 1 };
}

/**
 * "Effective angles" for an animation — the per-clip override falls
 * back to the sprite-level default. Mirrors the engine's resolution
 * (ANIMATIONS.md §5.1).
 */
export function effectiveAngles(
  state: AnimationEditorState,
  animName: string,
): SpriteAngleCount {
  return state.animationsMeta[animName]?.anglesOverride ?? state.angles;
}

/**
 * Per-animation row baseline — `sum(prior animations' effectiveAngles)`.
 * Used by the canonical layout when an animation with fewer angles
 * sits between two larger ones (ANIMATIONS.md §5.1).
 */
export function rowBaseFor(
  state: AnimationEditorState,
  animName: string,
): number {
  let acc = 0;
  for (const name of state.animationOrder) {
    if (name === animName) return acc;
    acc += effectiveAngles(state, name);
  }
  return acc;
}

/**
 * Total output-sheet row count — sum over all animations of their
 * `effectiveAngles`. Drives the `rows` field written to the manifest.
 */
export function totalOutputRows(state: AnimationEditorState): number {
  let total = 0;
  for (const name of state.animationOrder) {
    total += effectiveAngles(state, name);
  }
  return total;
}

/**
 * Maximum frames-per-animation across the sprite — drives the
 * canonical sheet's `cols`. Animations with fewer frames leave the
 * tail cells transparent (engine reads them only if a manifest
 * mis-declares `frames`, fail-safe).
 */
export function totalOutputCols(state: AnimationEditorState): number {
  let max = 1;
  for (const name of state.animationOrder) {
    const cells = state.cellMappings[name] ?? [];
    const angles = effectiveAngles(state, name);
    // We expect the author to map `framesPerAngle * angles` cells —
    // chunked angle-by-angle. AE1 ships the simple flat model: the
    // input cells are the "front" angle's frames; the other angles
    // (if any) are copied from the same indices on subsequent rows
    // of the SOURCE sheet (one cell offset per angle). Cols = floor.
    const framesPerAngle = Math.max(
      1,
      angles === 1 ? cells.length : Math.floor(cells.length / angles) || 1,
    );
    if (framesPerAngle > max) max = framesPerAngle;
  }
  return max;
}

/**
 * Determine the frame-per-angle count for one animation. Encoded
 * separately from the cols computation so the manifest writer and the
 * compositor agree.
 */
export function framesPerAngleFor(
  state: AnimationEditorState,
  animName: string,
): number {
  const cells = state.cellMappings[animName] ?? [];
  const angles = effectiveAngles(state, animName);
  if (cells.length === 0) return 0;
  if (angles === 1) return cells.length;
  return Math.max(1, Math.floor(cells.length / angles));
}

/**
 * Resolve a (sourceCol, sourceRow) from a source-sheet cell index
 * given the input grid dimensions. Indices are row-major from
 * top-left, matching the visual order in the editor preview pane.
 */
export function indexToCell(
  index: number,
  cols: number,
): { col: number; row: number } {
  return { col: index % cols, row: Math.floor(index / cols) };
}

/** Inverse of `indexToCell`. */
export function cellToIndex(col: number, row: number, cols: number): number {
  return row * cols + col;
}

/**
 * Validation errors produced by `validateState`. Returned as a list
 * so the UI can surface all of them at once.
 */
export interface ValidationIssue {
  kind: "error" | "warning";
  field: string;
  message: string;
}

/**
 * Pre-bake validation. Returns an empty list when the state is
 * shippable. The bake/save flow refuses to write when any error is
 * present (warnings are informational).
 */
export function validateState(
  state: AnimationEditorState,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!state.spriteId || !/^[a-z0-9_]+$/.test(state.spriteId)) {
    issues.push({
      kind: "error",
      field: "spriteId",
      message: "Sprite id must be lowercase letters, digits, or underscores.",
    });
  }
  if (state.frameWidth <= 0 || state.frameHeight <= 0) {
    issues.push({
      kind: "error",
      field: "grid",
      message: "Frame width / height must be positive.",
    });
  }
  if (state.cols <= 0 || state.rows <= 0) {
    issues.push({
      kind: "error",
      field: "grid",
      message: "Cols / rows must be positive.",
    });
  }
  // Source-grid coverage must fit the actual image.
  const declaredW =
    state.frameWidth * state.cols + state.padding * (state.cols - 1) +
    2 * state.offsetX;
  const declaredH =
    state.frameHeight * state.rows + state.padding * (state.rows - 1) +
    2 * state.offsetY;
  if (declaredW > state.imageWidth || declaredH > state.imageHeight) {
    issues.push({
      kind: "error",
      field: "grid",
      message:
        `Grid (${declaredW}×${declaredH}) is larger than the source image ` +
        `(${state.imageWidth}×${state.imageHeight}).`,
    });
  }
  if (!ALLOWED_ANGLES.includes(state.angles)) {
    issues.push({
      kind: "error",
      field: "angles",
      message: `angles must be one of ${ALLOWED_ANGLES.join(", ")}.`,
    });
  }
  for (const animName of state.animationOrder) {
    const meta = state.animationsMeta[animName];
    const cells = state.cellMappings[animName] ?? [];
    if (!meta) {
      issues.push({
        kind: "error",
        field: animName,
        message: `Animation "${animName}" missing metadata.`,
      });
      continue;
    }
    if (cells.length === 0) {
      issues.push({
        kind: "warning",
        field: animName,
        message: `Animation "${animName}" has no frames assigned.`,
      });
    }
    for (const idx of cells) {
      if (idx < 0 || idx >= state.cols * state.rows) {
        issues.push({
          kind: "error",
          field: animName,
          message: `Cell index ${idx} out of bounds (max ${state.cols * state.rows - 1}).`,
        });
      }
    }
    if (meta.frameDuration <= 0) {
      issues.push({
        kind: "error",
        field: animName,
        message: `frameDuration must be > 0.`,
      });
    }
    if (meta.anglesOverride && !ALLOWED_ANGLES.includes(meta.anglesOverride)) {
      issues.push({
        kind: "error",
        field: animName,
        message: `angles override must be one of ${ALLOWED_ANGLES.join(", ")}.`,
      });
    }
    if (meta.next && !state.animationsMeta[meta.next]) {
      issues.push({
        kind: "warning",
        field: animName,
        message: `next: "${meta.next}" — no such animation on this sprite.`,
      });
    }
  }
  return issues;
}

/**
 * Produce the manifest's `SpriteDef` entry for this sprite. The
 * canonical sheet path is `images/sprites/<id>-sheet.png` per
 * ANIMATION_EDITOR.md §4.3.
 *
 * Animations are written in `animationOrder` order so the engine's
 * `rowBase[a] = sum(prior effectiveAngles)` math (ANIMATIONS.md §5.1)
 * stays deterministic.
 *
 * Frame indices in the output manifest are 0..framesPerAngle-1 —
 * indices into a row, NOT the cell-index list the editor uses
 * internally. The compositor (§5 below) lays out frames col-major in
 * the canonical sheet so `frames: [0,1,2,...]` always reads in order.
 */
export function buildSpriteDef(state: AnimationEditorState): SpriteDef {
  const animations: Record<string, AnimationDef> = {};
  for (const name of state.animationOrder) {
    const meta = state.animationsMeta[name];
    if (!meta) continue;
    const framesPerAngle = framesPerAngleFor(state, name);
    const def: AnimationDef = {
      frames: Array.from({ length: framesPerAngle }, (_, i) => i),
      frameDuration: meta.frameDuration,
      loop: meta.loop,
    };
    if (meta.next) def.next = meta.next;
    if (meta.anglesOverride) def.angles = meta.anglesOverride;
    animations[name] = def;
  }
  const def: SpriteDef = {
    image: `images/sprites/${state.spriteId}-sheet.png`,
    frameWidth: state.frameWidth,
    frameHeight: state.frameHeight,
    cols: totalOutputCols(state),
    rows: totalOutputRows(state),
    angles: state.angles,
    animations,
  };
  return def;
}

/**
 * Splice an updated sprite entry into a manifest, preserving every
 * other field verbatim. Re-saving via `EditorProjectStore.saveManifest`
 * is the caller's responsibility.
 */
export function applySpriteToManifest(
  manifest: PackManifest,
  spriteId: string,
  def: SpriteDef,
): PackManifest {
  const out: PackManifest = {
    ...manifest,
    sprites: {
      ...(manifest.sprites ?? {}),
      [spriteId]: def,
    },
  };
  return out;
}

/**
 * Build the `SpriteSourceMeta` row for IDB persistence. Round-trips
 * the editor state byte-for-byte (modulo intentional normalization of
 * angle counts to the constrained `SpriteAngleCount`).
 */
export function toSpriteSourceMeta(
  projectId: string,
  state: AnimationEditorState,
  overrides?: Partial<Pick<SpriteSourceMeta, "kind" | "fbx">>,
): SpriteSourceMeta {
  const out: SpriteSourceMeta = {
    projectId,
    spriteId: state.spriteId,
    kind: overrides?.kind ?? "spritesheet",
    sourcePath: state.sourcePath,
    grid: {
      frameWidth: state.frameWidth,
      frameHeight: state.frameHeight,
      cols: state.cols,
      rows: state.rows,
      padding: state.padding,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
    },
    angles: state.angles,
    cellMappings: { ...state.cellMappings },
    animationsMeta: { ...state.animationsMeta },
    animationOrder: [...state.animationOrder],
    bakedAt: state.bakedAt,
  };
  if (overrides?.fbx) out.fbx = overrides.fbx;
  return out;
}

/**
 * Restore editor state from a previously-saved SpriteSourceMeta. The
 * inverse of `toSpriteSourceMeta`. Caller is responsible for reading
 * the source PNG dimensions back out and passing them in (the meta
 * doesn't store image dimensions — they're a property of the asset).
 */
export function fromSpriteSourceMeta(
  meta: SpriteSourceMeta,
  imageWidth: number,
  imageHeight: number,
): AnimationEditorState {
  return {
    spriteId: meta.spriteId,
    sourcePath: meta.sourcePath,
    imageWidth,
    imageHeight,
    frameWidth: meta.grid.frameWidth,
    frameHeight: meta.grid.frameHeight,
    cols: meta.grid.cols,
    rows: meta.grid.rows,
    padding: meta.grid.padding,
    offsetX: meta.grid.offsetX,
    offsetY: meta.grid.offsetY,
    angles: meta.angles,
    animationOrder: meta.animationOrder ?? Object.keys(meta.cellMappings),
    cellMappings: { ...meta.cellMappings },
    animationsMeta: { ...meta.animationsMeta },
    bakedAt: meta.bakedAt,
  };
}

/**
 * Pure-data plan for how the compositor lays out the canonical sheet.
 * Driven separately so the smoke test can assert on the layout
 * without invoking a real canvas. Each entry is a copy directive: "blit
 * the source cell at `srcIndex` to the output (col, row)."
 */
export interface CompositePlan {
  /** Output sheet dimensions in cells. */
  outCols: number;
  outRows: number;
  /** Output sheet dimensions in pixels. */
  outWidth: number;
  outHeight: number;
  /** Per-cell copy instructions. */
  ops: Array<{
    srcIndex: number;
    dstCol: number;
    dstRow: number;
    animName: string;
    angleIdx: number;
    frameIdx: number;
  }>;
}

/**
 * Build a composite plan from the editor state. AE1's simple model:
 *
 *  - The author maps `framesPerAngle * angles` cells per animation in
 *    angle-major order: `[angle0_frame0, angle0_frame1, …,
 *    angle1_frame0, …]`. For angles=1 the list is just the frames.
 *  - The canonical layout reorders into row-per-(animation × angle),
 *    col-per-frame (ANIMATIONS.md §5.1). The compositor is a flat
 *    re-blit; no per-pixel math beyond the copy.
 */
export function buildCompositePlan(
  state: AnimationEditorState,
): CompositePlan {
  const outCols = totalOutputCols(state);
  const outRows = totalOutputRows(state);
  const ops: CompositePlan["ops"] = [];
  let rowOffset = 0;
  for (const animName of state.animationOrder) {
    const angles = effectiveAngles(state, animName);
    const cells = state.cellMappings[animName] ?? [];
    const framesPerAngle = framesPerAngleFor(state, animName);
    for (let angleIdx = 0; angleIdx < angles; angleIdx++) {
      for (let frameIdx = 0; frameIdx < framesPerAngle; frameIdx++) {
        // Author-side layout: cells[angleIdx * framesPerAngle + frameIdx]
        // for multi-angle, cells[frameIdx] for angles=1.
        const cellPos =
          angles === 1
            ? frameIdx
            : angleIdx * framesPerAngle + frameIdx;
        const srcIndex = cells[cellPos];
        if (srcIndex === undefined) continue;
        ops.push({
          srcIndex,
          dstCol: frameIdx,
          dstRow: rowOffset + angleIdx,
          animName,
          angleIdx,
          frameIdx,
        });
      }
    }
    rowOffset += angles;
  }
  return {
    outCols,
    outRows,
    outWidth: outCols * state.frameWidth,
    outHeight: outRows * state.frameHeight,
    ops,
  };
}

/**
 * Whether the input layout already matches the canonical output
 * layout — when true the compositor can short-circuit and re-emit
 * the source bytes verbatim (per ANIMATION_EDITOR.md §5: "if the
 * input already matches the canonical layout, just copy it through
 * unchanged.").
 *
 * The check is structural: the plan's ops describe a strict identity
 * permutation iff every cell's `srcIndex` matches its `dstCol +
 * dstRow * outCols` — i.e. the author mapped cells in canonical
 * order without skipping. AE1 doesn't ship this short-circuit (the
 * canvas compositor is cheap enough) but the smoke test asserts on
 * it as a correctness check.
 */
export function isIdentityPlan(plan: CompositePlan): boolean {
  for (const op of plan.ops) {
    const expected = op.dstCol + op.dstRow * plan.outCols;
    if (op.srcIndex !== expected) return false;
  }
  return true;
}

/**
 * Composite the canonical sheet onto a 2D canvas. Pure-ish — the
 * caller supplies the source ImageBitmap / HTMLImageElement and the
 * target canvas; we drive `drawImage` against the plan.
 *
 * In a browser this is straightforward `CanvasRenderingContext2D`.
 * The smoke test substitutes a mock 2D context (see
 * `scripts/smoke-anim-editor.ts`) — the function only ever calls
 * `drawImage`, so a minimal mock suffices.
 *
 * Type loosened to `unknown` for the source so this module can stay
 * portable between Node (smoke test) and the browser (UI). Callers
 * pass an `HTMLImageElement` or `ImageBitmap` and let the runtime
 * shape match `drawImage`'s overloads.
 */
// `drawImage`'s sliced overload — typed loose enough that a synthetic
// mock context from the smoke test still satisfies it. The browser's
// `CanvasRenderingContext2D` matches because TS's structural typing
// only verifies that the method exists and accepts (any-typed)
// arguments — the unknown-typed first param widens to anything the
// real method accepts.
//
// We `as never` the source on call so the caller's exact source type
// (`HTMLImageElement` / `ImageBitmap` / `OffscreenCanvas` / mock) is
// preserved up to the boundary without leaking DOM types into this
// module.
type DrawImageSliced = (
  source: never,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) => void;

export interface Canvas2DLike {
  drawImage: DrawImageSliced;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function composite(
  ctx: { drawImage: (...args: any[]) => void },
  plan: CompositePlan,
  source: unknown,
  state: AnimationEditorState,
): void {
  const fw = state.frameWidth;
  const fh = state.frameHeight;
  const pad = state.padding;
  const ox = state.offsetX;
  const oy = state.offsetY;
  for (const op of plan.ops) {
    const { col: srcCol, row: srcRow } = indexToCell(op.srcIndex, state.cols);
    const sx = ox + srcCol * (fw + pad);
    const sy = oy + srcRow * (fh + pad);
    const dx = op.dstCol * fw;
    const dy = op.dstRow * fh;
    ctx.drawImage(source, sx, sy, fw, fh, dx, dy, fw, fh);
  }
}

/**
 * Persist a baked sprite end-to-end: writes the manifest entry, the
 * canonical PNG, and the spriteSources meta row. Caller supplies the
 * already-composited PNG as a Blob.
 *
 * Why split this from `composite`? The compositor is DOM-bound (it
 * needs a real `<canvas>` to call `toBlob` against); the persistence
 * step is pure async-IDB. The smoke test exercises persistence with
 * a synthetic blob to avoid an OffscreenCanvas dep.
 */
export async function saveBakedSprite(
  projectId: string,
  state: AnimationEditorState,
  bakedSheetBlob: Blob,
): Promise<{ manifest: PackManifest; def: SpriteDef }> {
  const manifest =
    (await EditorProjectStore.loadManifest(projectId)) ??
    ({
      name: "Untitled",
      version: "0.1.0",
      engine: "*",
      tileTextures: {},
      tileSheets: [],
      startScene: "scenes/start.json",
    } as PackManifest);
  const def = buildSpriteDef(state);
  const nextManifest = applySpriteToManifest(manifest, state.spriteId, def);
  await EditorProjectStore.saveManifest(projectId, nextManifest);
  await EditorProjectStore.saveAsset(
    projectId,
    def.image,
    bakedSheetBlob,
  );
  const meta = toSpriteSourceMeta(projectId, {
    ...state,
    bakedAt: Date.now(),
  });
  await EditorProjectStore.saveSpriteSource(
    projectId,
    state.spriteId,
    meta,
  );
  return { manifest: nextManifest, def };
}
