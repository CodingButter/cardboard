/**
 * FBX baker — AE2's headline pipeline, refactored into DOM-free helpers
 * so the smoke test (`scripts/smoke-fbx-bake.ts`) can exercise the
 * composition + manifest writer without a real WebGL context.
 *
 * Per `docs/plans/ANIMATION_EDITOR.md` §6 the FBX bake is a triple
 * loop: animations × angles × frames. Each cell renders into an
 * offscreen `WebGLRenderTarget`, is read back into an RGBA byte
 * buffer, and is blitted into the master canvas at the canonical
 * `(frame, rowBase + angle)` cell position from ANIMATIONS.md §5.
 *
 * Split into three layers so each is independently testable:
 *
 *   1. `planFbxBake` — pure plan builder. Given (animation × angle ×
 *      frame) config, produces the same `CompositePlan` shape the AE1
 *      compositor uses + a flat list of capture descriptors the live
 *      renderer iterates.
 *   2. `buildFbxSpriteState` — produces an `AnimationEditorState` so
 *      the shared manifest writer + `saveBakedSprite` (animationBaker)
 *      consume the FBX output unmodified.
 *   3. `bakeFbxOffscreen` — the actual three.js loop, DOM-bound. Calls
 *      into 1+2 then handles the WebGL rendering and PNG encoding.
 *
 * Layer 3 is dynamic-imported only when a user opens the FBX importer
 * — Three.js is ~600 KB minified, and the editor's main bundle never
 * pulls it in. The smoke test only exercises layers 1+2, which are
 * pure TypeScript with no Three.js types in their signatures.
 */

import type { SpriteAngleCount, SpriteDef } from "@two_5_d/engine/AssetPack";
import {
  buildSpriteDef,
  rowBaseFor,
  effectiveAngles,
  type AnimationEditorState,
} from "./animationBaker";
import {
  DEFAULT_FBX_RENDER_META,
  type FbxRenderMeta,
} from "./EditorProjectStore";

/**
 * Re-export the meta render shape under the baker's own type alias —
 * keeps the importer's call sites self-documenting while leaving the
 * persisted contract owned by EditorProjectStore.
 */
export type FbxRenderConfig = FbxRenderMeta;
export const DEFAULT_FBX_RENDER_CONFIG: FbxRenderConfig =
  DEFAULT_FBX_RENDER_META;
import {
  DEFAULT_FBX_RENDER_META,
  type FbxRenderMeta,
} from "./EditorProjectStore";

/**
 * Re-export the meta render shape under the baker's own type alias —
 * keeps the importer's call sites self-documenting while leaving the
 * persisted contract owned by EditorProjectStore.
 */
export type FbxRenderConfig = FbxRenderMeta;
export const DEFAULT_FBX_RENDER_CONFIG: FbxRenderConfig =
  DEFAULT_FBX_RENDER_META;

/**
 * One animation's bake configuration. The author picks frame count
 * per FBX clip; the editor maps clip → output-name via the rename UI.
 */
export interface FbxAnimConfig {
  /** Name of the FBX clip (e.g. "mixamo.com:Idle"). */
  fbxClipName: string;
  /** Output animation name (e.g. "idle") — the manifest key. */
  outputName: string;
  /** Frames to sample from this clip's duration. */
  frameCount: number;
  /** Per-frame duration in seconds for the output manifest. */
  frameDuration: number;
  /** Default true. */
  loop: boolean;
  /** Optional name of next animation to chain to. */
  next?: string;
  /** Optional per-clip angles override (e.g. die collapses to 1). */
  anglesOverride?: SpriteAngleCount;
  /** Source clip duration in seconds; needed to compute sample time. */
  clipDurationSec: number;
}

/**
 * Top-level config for one FBX bake. Persisted in `spriteSources.fbx`
 * on save so re-opening the sprite restores every knob.
 */
export interface FbxBakeConfig {
  spriteId: string;
  /** Default angle count for animations without an override. */
  angleCount: SpriteAngleCount;
  /** Output cell size in pixels (frameWidth = frameHeight). */
  cellSize: number;
  /** Author-set model rotation applied before rendering. */
  forwardRotation: { x: number; y: number; z: number };
  /** Camera elevation above horizon in radians. */
  cameraElevation: number;
  /** Per-animation configs in render order. */
  animations: FbxAnimConfig[];
  /**
   * Render-pipeline knobs (lighting, tone, background, shadow). The
   * preview and the offscreen bake both consume this so the
   * spritesheet matches the viewport. Optional in legacy configs
   * loaded from pre-render-block IDB rows — restoration helpers fill
   * in `DEFAULT_FBX_RENDER_CONFIG` so downstream code can rely on
   * it being defined.
   */
  render: FbxRenderConfig;
}

/**
 * One render-capture descriptor — what the live three.js loop reads.
 * The flat list is in deterministic insertion order so the live
 * progress bar can index it linearly.
 */
export interface FbxCaptureOp {
  /** Index of `FbxBakeConfig.animations`. */
  animIndex: number;
  /** FBX clip name (so the live loop can pull the right AnimationClip). */
  fbxClipName: string;
  /** Output manifest animation name. */
  outputName: string;
  /** Angle index within this animation's effective angles. */
  angleIdx: number;
  /** Frame index within this animation's frameCount. */
  frameIdx: number;
  /** Atlas col + row in the OUTPUT sheet (canonical layout). */
  dstCol: number;
  dstRow: number;
  /**
   * Animation-clip sample time in seconds: `(frameIdx / frameCount) * clipDuration`.
   */
  sampleTime: number;
  /**
   * Azimuth in radians for camera positioning. The live loop uses
   * this + `cameraElevation` + `forwardRotation` to place the camera.
   */
  azimuth: number;
}

/**
 * Plan for the canonical FBX bake. Mirrors `CompositePlan` from
 * animationBaker but with the per-capture descriptors needed by the
 * three.js render loop. The smoke test asserts on this shape.
 */
export interface FbxBakePlan {
  /** Output sheet dims in cells (cols = max frame count, rows = sum effective angles). */
  outCols: number;
  outRows: number;
  /** Output sheet dims in pixels (cellSize × outCols / outRows). */
  outWidth: number;
  outHeight: number;
  /** Cell size in pixels. */
  cellSize: number;
  /** Per-cell capture descriptors. */
  captures: FbxCaptureOp[];
}

/**
 * Effective angles for one anim — per-clip override falls back to
 * sprite default. Mirrors the engine's resolution (ANIMATIONS.md §5.1).
 */
function fbxEffectiveAngles(
  defaultAngles: SpriteAngleCount,
  override: SpriteAngleCount | undefined,
): number {
  return override ?? defaultAngles;
}

/**
 * Build the capture plan for an FBX bake. Pure — no Three.js, no DOM.
 *
 * Output layout matches ANIMATIONS.md §5.1 exactly:
 *  - cols = max frame count across animations
 *  - rows = sum over animations of effectiveAngles
 *  - capture for (anim, angle, frame) → cell (frame, rowBase[anim] + angle)
 *
 * This is the shape the engine reads at runtime; the editor's AE1
 * compositor produces the same shape from a hand-painted sheet.
 * Cross-path parity by construction.
 */
export function planFbxBake(config: FbxBakeConfig): FbxBakePlan {
  let outCols = 1;
  for (const anim of config.animations) {
    if (anim.frameCount > outCols) outCols = anim.frameCount;
  }
  let outRows = 0;
  const rowBases: number[] = [];
  for (const anim of config.animations) {
    rowBases.push(outRows);
    outRows += fbxEffectiveAngles(config.angleCount, anim.anglesOverride);
  }
  const captures: FbxCaptureOp[] = [];
  for (let animIdx = 0; animIdx < config.animations.length; animIdx++) {
    const anim = config.animations[animIdx]!;
    const angles = fbxEffectiveAngles(
      config.angleCount,
      anim.anglesOverride,
    );
    const rowBase = rowBases[animIdx]!;
    for (let angleIdx = 0; angleIdx < angles; angleIdx++) {
      // Angle id 0 is the model's intuitive "front" — camera looks
      // from azimuth 0 (forward). Subsequent angles step CW. Per
      // ANIMATIONS.md §3.1 angles are 0-indexed CW from front.
      const azimuth = (angleIdx / angles) * Math.PI * 2;
      for (let frameIdx = 0; frameIdx < anim.frameCount; frameIdx++) {
        const sampleTime =
          anim.frameCount > 1
            ? (frameIdx / anim.frameCount) * anim.clipDurationSec
            : 0;
        captures.push({
          animIndex: animIdx,
          fbxClipName: anim.fbxClipName,
          outputName: anim.outputName,
          angleIdx,
          frameIdx,
          dstCol: frameIdx,
          dstRow: rowBase + angleIdx,
          sampleTime,
          azimuth,
        });
      }
    }
  }
  return {
    outCols,
    outRows,
    outWidth: outCols * config.cellSize,
    outHeight: outRows * config.cellSize,
    cellSize: config.cellSize,
    captures,
  };
}

/**
 * Build an `AnimationEditorState` from an FBX bake config + the bake
 * plan. The state is what `saveBakedSprite` consumes — by going
 * through this shape, the FBX path reuses the AE1 manifest writer.
 *
 * `cellMappings` is intentionally empty: the FBX path doesn't use the
 * source-cell index model (there's no source sheet to map FROM). The
 * compositor in `bakeFbxOffscreen` writes cells directly by
 * (animName, angleIdx, frameIdx) — same canonical layout the AE1
 * compositor produces, just by a different code path.
 */
export function buildFbxSpriteState(
  config: FbxBakeConfig,
  plan: FbxBakePlan,
  sourcePath: string,
): AnimationEditorState {
  const animationsMeta: AnimationEditorState["animationsMeta"] = {};
  const animationOrder: string[] = [];
  for (const anim of config.animations) {
    animationOrder.push(anim.outputName);
    animationsMeta[anim.outputName] = {
      frameDuration: anim.frameDuration,
      loop: anim.loop,
      next: anim.next,
      anglesOverride: anim.anglesOverride,
    };
  }
  // We synthesize cellMappings so `framesPerAngleFor` returns the
  // right column count. Each anim claims `framesPerAngle * angles`
  // cells where indices are unused (the FBX compositor ignores
  // srcIndex — it writes directly from WebGL render targets).
  const cellMappings: Record<string, number[]> = {};
  for (const anim of config.animations) {
    const angles = fbxEffectiveAngles(
      config.angleCount,
      anim.anglesOverride,
    );
    const total =
      angles === 1 ? anim.frameCount : angles * anim.frameCount;
    cellMappings[anim.outputName] = Array.from({ length: total }, (_, i) => i);
  }
  return {
    spriteId: config.spriteId,
    sourcePath,
    imageWidth: plan.outWidth,
    imageHeight: plan.outHeight,
    frameWidth: config.cellSize,
    frameHeight: config.cellSize,
    cols: plan.outCols,
    rows: plan.outRows,
    padding: 0,
    offsetX: 0,
    offsetY: 0,
    angles: config.angleCount,
    animationOrder,
    cellMappings,
    animationsMeta,
    bakedAt: 0,
  };
}

/**
 * Convenience — emit the manifest entry the engine reads. Goes
 * through `buildSpriteDef` so the AE1 + AE2 paths produce identical
 * manifests for identical (animation, angle, frame) counts.
 */
export function buildFbxSpriteDef(
  config: FbxBakeConfig,
  plan: FbxBakePlan,
  sourcePath: string,
): SpriteDef {
  const state = buildFbxSpriteState(config, plan, sourcePath);
  return buildSpriteDef(state);
}

/**
 * Default bake config — sensible starting point for a freshly loaded
 * FBX. The author overrides via the importer UI.
 *
 *  - 8 angles (classic Doom)
 *  - 64 px cells
 *  - 8 frames per clip (good for ~1 s animations at 60 fps; bigger
 *    clips look smoother but balloon the sheet)
 *  - +Z forward (typical FBX export convention)
 *  - 8° elevation above horizon (Doom 3/4-view feel)
 */
export function defaultFbxBakeConfig(
  spriteId: string,
  clips: Array<{ name: string; duration: number }>,
): FbxBakeConfig {
  return {
    spriteId,
    angleCount: 8,
    cellSize: 64,
    forwardRotation: { x: 0, y: 0, z: 0 },
    cameraElevation: (8 * Math.PI) / 180,
    animations: clips.map((c) => ({
      fbxClipName: c.name,
      outputName: sanitizeClipName(c.name),
      frameCount: 8,
      frameDuration: c.duration > 0 ? c.duration / 8 : 0.1,
      loop: true,
      clipDurationSec: c.duration,
    })),
    // Clone the defaults so callers can freely mutate without
    // tainting the shared `DEFAULT_FBX_RENDER_CONFIG` constant.
    render: cloneRenderConfig(DEFAULT_FBX_RENDER_CONFIG),
  };
}

/**
 * Deep-clone a render config — used by both `defaultFbxBakeConfig`
 * and the IDB restore path so config objects own their own state.
 * Spread isn't enough because `background` is a discriminated union.
 */
export function cloneRenderConfig(r: FbxRenderConfig): FbxRenderConfig {
  return {
    ambient: r.ambient,
    keyIntensity: r.keyIntensity,
    keyDirection: r.keyDirection,
    fillIntensity: r.fillIntensity,
    background:
      r.background.kind === "solid"
        ? { kind: "solid", color: r.background.color }
        : { kind: "transparent" },
    tone: r.tone,
    shadow: r.shadow,
  };
}

/**
 * Strip DCC-tool prefixes / suffixes from an FBX clip name to produce
 * a manifest-friendly key. e.g. `"mixamo.com:Idle_01"` → `"idle_01"`.
 *
 * Heuristic: trim everything up to and including the last `:` or `|`,
 * lowercase, replace non-word chars with `_`.
 */
export function sanitizeClipName(raw: string): string {
  let name = raw;
  const colon = Math.max(name.lastIndexOf(":"), name.lastIndexOf("|"));
  if (colon !== -1) name = name.slice(colon + 1);
  name = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  name = name.replace(/^_+|_+$/g, "");
  return name || "anim";
}

/**
 * Round-trip: rebuild an `FbxBakeConfig` from a persisted
 * `SpriteSourceMeta.fbx` block + the captured per-anim metadata. The
 * importer calls this when the user re-opens an FBX-sourced sprite so
 * every knob is restored.
 *
 * Note: `clipDurationSec` isn't persisted (the FBX is the source of
 * truth). The caller supplies it after loading the FBX clips fresh.
 */
export function restoreFbxBakeConfig(
  spriteId: string,
  fbxMeta: NonNullable<
    import("./EditorProjectStore").SpriteSourceMeta["fbx"]
  >,
  animationsMeta: AnimationEditorState["animationsMeta"],
  animationOrder: string[],
  defaultAngleCount: SpriteAngleCount,
  clipDurations: Record<string, number>,
): FbxBakeConfig {
  const animations: FbxAnimConfig[] = [];
  // Invert clipMapping (clip → output) to iterate output-first.
  const outputToClip = new Map<string, string>();
  for (const [clip, output] of Object.entries(fbxMeta.clipMapping)) {
    outputToClip.set(output, clip);
  }
  for (const outputName of animationOrder) {
    const meta = animationsMeta[outputName];
    if (!meta) continue;
    const fbxClipName = outputToClip.get(outputName) ?? outputName;
    if (!fbxMeta.enabledClips.includes(fbxClipName)) continue;
    animations.push({
      fbxClipName,
      outputName,
      frameCount: fbxMeta.framesPerAnimation[outputName] ?? 8,
      frameDuration: meta.frameDuration,
      loop: meta.loop,
      next: meta.next,
      anglesOverride: meta.anglesOverride,
      clipDurationSec: clipDurations[fbxClipName] ?? 0,
    });
  }
  return {
    spriteId,
    angleCount: defaultAngleCount,
    cellSize: fbxMeta.cellSize,
    forwardRotation: { ...fbxMeta.forwardRotation },
    cameraElevation: fbxMeta.cameraElevation,
    animations,
    // Fall back to the documented defaults so legacy bakes (predating
    // the render-meta block) still produce sensibly-lit output on
    // re-edit.
    render: cloneRenderConfig(fbxMeta.render ?? DEFAULT_FBX_RENDER_CONFIG),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Three.js render layer — DOM/WebGL-bound. Dynamic-imported so the
//  editor's main bundle never pulls in Three.js for users who never
//  enter the FBX importer.
// ─────────────────────────────────────────────────────────────────────

/**
 * Progress callback signature. Called once per cell captured.
 */
export type BakeProgress = (done: number, total: number) => void;

/**
 * Loaded FBX shape needed by the bake loop. The caller (FbxImporter)
 * loads the FBX via `FBXLoader` and passes the resulting `THREE.Group`
 * + extracted clip list. We don't import Three.js at the type level
 * here so this module stays tree-shake-able from the main bundle.
 */
export interface LoadedFbx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  group: any;
  clips: Array<{
    name: string;
    duration: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clip: any;
  }>;
}

/**
 * Run the bake offscreen and return the canonical PNG blob.
 *
 * Dynamic-imports `three` so a caller that never invokes this never
 * pays the bundle cost. The returned Promise resolves with the PNG
 * Blob ready for `EditorProjectStore.saveAsset(...)`.
 *
 * The render loop:
 *   1. Build a scene with the FBX, ambient + key lights, orthographic
 *      camera matching the cell aspect ratio.
 *   2. For each capture op:
 *      a. Position the camera at this op's azimuth + the config's
 *         elevation, at radius from origin = fit-bounding-sphere.
 *      b. Sample the AnimationMixer at `sampleTime`.
 *      c. Render to the offscreen WebGLRenderTarget.
 *      d. Read pixels, flip Y, blit into the master canvas at
 *         `(dstCol * cellSize, dstRow * cellSize)`.
 *   3. Encode the master canvas to PNG via `toBlob`.
 *
 * Headless caveat: Three.js needs a WebGL context, which means Bun's
 * smoke environment can't run this. The smoke test exercises the pure
 * helpers above (planFbxBake / buildFbxSpriteDef) and asserts on plan
 * shape + manifest writer round-trip; browser-only manual verification
 * covers the live three.js render path.
 */
export async function bakeFbxOffscreen(
  fbx: LoadedFbx,
  config: FbxBakeConfig,
  progress?: BakeProgress,
): Promise<{ png: Blob; plan: FbxBakePlan }> {
  // Lazy-import — splits Three.js into its own chunk under Bun's
  // bundler. Resolved at first FBX-bake invocation only.
  const THREE = await import("three");
  const plan = planFbxBake(config);
  const total = plan.captures.length;
  const render = config.render ?? DEFAULT_FBX_RENDER_CONFIG;

  // ── Scene setup (shared shape with the live preview) ──────────
  const root = fbx.group as InstanceType<typeof THREE.Group>;
  root.rotation.set(
    config.forwardRotation.x,
    config.forwardRotation.y,
    config.forwardRotation.z,
  );
  // `buildFbxScene` owns the ambient/key/fill/background/tone/shadow
  // wiring so the bake matches the viewport pixel-for-pixel.
  const { scene } = buildFbxScene(THREE, root, render);

  // ── Fit camera to model bounds ────────────────────────────────
  // Compute bounding-box at rest pose so the orthographic frustum
  // spans the whole rig regardless of pose. Mixer-driven motion
  // during the bake CAN exit this box (e.g. arms swinging wide);
  // we add a 20% padding factor to cover that without per-frame
  // re-fit.
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
  const frustum = maxDim * 1.2;
  const radius = maxDim * 2.5; // far enough that ortho clip planes never intersect the mesh

  const camera = new THREE.OrthographicCamera(
    -frustum / 2,
    frustum / 2,
    frustum / 2,
    -frustum / 2,
    0.1,
    radius * 4,
  );

  // ── Render target + readback buffer ───────────────────────────
  //
  // CRITICAL: Three.js writes LINEAR pixel values into a render
  // target by default — `renderer.outputColorSpace = SRGBColorSpace`
  // only applies when rendering to the default framebuffer (the
  // canvas). When we `readRenderTargetPixels` and treat the bytes as
  // sRGB inside the master canvas, the result looks unlit/flat
  // because the linear values are darker than their sRGB-encoded
  // counterparts. Setting `texture.colorSpace = SRGBColorSpace` on
  // the render target tells Three to encode sRGB on write, so the
  // pixel readback matches the live preview byte-for-byte.
  const cellSize = config.cellSize;
  const renderTarget = new THREE.WebGLRenderTarget(cellSize, cellSize, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
  });
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const readBuffer = new Uint8Array(cellSize * cellSize * 4);

  // ── Master canvas — composited output ─────────────────────────
  const masterCanvas = document.createElement("canvas");
  masterCanvas.width = plan.outWidth;
  masterCanvas.height = plan.outHeight;
  const masterCtx = masterCanvas.getContext("2d");
  if (!masterCtx) throw new Error("bakeFbxOffscreen: 2D context unavailable");
  masterCtx.imageSmoothingEnabled = false;
  // Start transparent — the per-cell putImageData blits opaque
  // pixels over the transparent background.
  masterCtx.clearRect(0, 0, masterCanvas.width, masterCanvas.height);

  // ── WebGL renderer (offscreen — invisible canvas) ─────────────
  const glCanvas = document.createElement("canvas");
  glCanvas.width = cellSize;
  glCanvas.height = cellSize;
  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    alpha: render.background.kind === "transparent",
    preserveDrawingBuffer: false,
    antialias: true,
  });
  if (render.background.kind === "transparent") {
    renderer.setClearColor(0x000000, 0);
  } else {
    renderer.setClearColor(new THREE.Color(render.background.color), 1);
  }
  renderer.setSize(cellSize, cellSize, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (render.shadow) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  // ── Animation mixers, one per clip ────────────────────────────
  const mixersByClip = new Map<string, InstanceType<typeof THREE.AnimationMixer>>();
  const actionsByClip = new Map<string, InstanceType<typeof THREE.AnimationAction>>();
  for (const clipDesc of fbx.clips) {
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clipDesc.clip);
    action.play();
    mixersByClip.set(clipDesc.name, mixer);
    actionsByClip.set(clipDesc.name, action);
  }

  // ── Render loop ───────────────────────────────────────────────
  try {
    let done = 0;
    for (const cap of plan.captures) {
      const mixer = mixersByClip.get(cap.fbxClipName);
      if (!mixer) {
        // Skip captures for unknown clips (defensive — the importer
        // should filter these out before calling us).
        done += 1;
        progress?.(done, total);
        continue;
      }
      // Reset mixer time absolutely (relative time deltas would drift
      // across angles within the same animation).
      mixer.setTime(cap.sampleTime);
      root.updateMatrixWorld(true);

      // Position camera at azimuth + elevation around origin.
      const cosEl = Math.cos(config.cameraElevation);
      const sinEl = Math.sin(config.cameraElevation);
      const camRadius = radius;
      const px = Math.sin(cap.azimuth) * cosEl * camRadius;
      const pz = Math.cos(cap.azimuth) * cosEl * camRadius;
      const py = sinEl * camRadius;
      camera.position.set(center.x + px, center.y + py, center.z + pz);
      camera.lookAt(center.x, center.y, center.z);
      camera.updateProjectionMatrix();

      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(
        renderTarget,
        0,
        0,
        cellSize,
        cellSize,
        readBuffer,
      );
      renderer.setRenderTarget(null);

      // Flip Y + premultiply alpha into an ImageData and blit to
      // the master canvas.
      const flipped = new Uint8ClampedArray(readBuffer.length);
      for (let y = 0; y < cellSize; y++) {
        const srcOff = y * cellSize * 4;
        const dstOff = (cellSize - 1 - y) * cellSize * 4;
        for (let x = 0; x < cellSize * 4; x += 4) {
          // Straight-alpha output (canvas2D handles premultiply on draw).
          flipped[dstOff + x] = readBuffer[srcOff + x]!;
          flipped[dstOff + x + 1] = readBuffer[srcOff + x + 1]!;
          flipped[dstOff + x + 2] = readBuffer[srcOff + x + 2]!;
          flipped[dstOff + x + 3] = readBuffer[srcOff + x + 3]!;
        }
      }
      const imageData = new ImageData(flipped, cellSize, cellSize);
      masterCtx.putImageData(
        imageData,
        cap.dstCol * cellSize,
        cap.dstRow * cellSize,
      );

      done += 1;
      progress?.(done, total);
      // Yield to the event loop every 8 captures so the UI stays
      // responsive during a 256-capture bake.
      if (done % 8 === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
  } finally {
    renderTarget.dispose();
    renderer.dispose();
    for (const mixer of mixersByClip.values()) {
      mixer.stopAllAction();
    }
  }

  // Encode to PNG.
  const blob = await new Promise<Blob | null>((resolve) =>
    masterCanvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("bakeFbxOffscreen: toBlob produced null");
  return { png: blob, plan };
}

/**
 * Shared scene-builder — used by both `bakeFbxOffscreen` and the live
 * preview in `FbxImporter.tsx`. Centralises light placement,
 * background, and tone (lit/flat) so the two render paths produce
 * byte-identical output (given the same camera).
 *
 * Returns the constructed `Scene` plus refs to the light objects so
 * the preview can mutate intensities on slider drag without
 * rebuilding the scene.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFbxScene(THREE: any, root: any, render: FbxRenderConfig) {
  const scene = new THREE.Scene();
  if (render.background.kind === "solid") {
    scene.background = new THREE.Color(render.background.color);
  } else {
    // null background = canvas alpha shows through; the renderer's
    // clear color is what actually wins for the offscreen target.
    scene.background = null;
  }
  scene.add(root);

  const ambient = new THREE.AmbientLight(0xffffff, render.ambient);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, render.keyIntensity);
  positionKeyLight(key, render.keyDirection);
  if (render.shadow) {
    key.castShadow = true;
  }
  scene.add(key);

  // Fill from the opposite side of the key, cooler tone for subtle
  // depth on the shaded side.
  const fill = new THREE.DirectionalLight(0xc8d8ff, render.fillIntensity);
  positionFillLight(fill, render.keyDirection);
  scene.add(fill);

  // Apply tone (lit vs flat). Tone toggles use the FBX's existing
  // materials for "lit" and swap to MeshBasicMaterial for "flat" so
  // the user gets a retro unlit look without losing the original
  // material set on switch-back.
  applyTone(THREE, root, render.tone);

  if (render.shadow) {
    enableShadows(root);
  }

  return { scene, ambient, key, fill };
}

/**
 * Re-apply render config to an existing scene without rebuilding —
 * the preview's slider changes call this so the viewport updates in
 * real time without a full `buildFbxScene` rebuild.
 */
export function applyFbxRenderConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any,
  scene: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scene: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ambient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    key: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fill: any;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
  render: FbxRenderConfig,
) {
  scene.ambient.intensity = render.ambient;
  scene.key.intensity = render.keyIntensity;
  scene.fill.intensity = render.fillIntensity;
  positionKeyLight(scene.key, render.keyDirection);
  positionFillLight(scene.fill, render.keyDirection);
  if (render.background.kind === "solid") {
    scene.scene.background = new THREE.Color(render.background.color);
  } else {
    scene.scene.background = null;
  }
  applyTone(THREE, root, render.tone);
  if (render.shadow) {
    enableShadows(root);
    scene.key.castShadow = true;
  } else {
    disableShadows(root);
    scene.key.castShadow = false;
  }
}

/** Place the key light at a canonical preset position. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function positionKeyLight(light: any, dir: FbxRenderConfig["keyDirection"]) {
  switch (dir) {
    case "front":
      light.position.set(3, 5, 5);
      break;
    case "side":
      light.position.set(6, 4, 0);
      break;
    case "back":
      light.position.set(-3, 5, -5);
      break;
    case "overhead":
      light.position.set(0, 8, 0.5);
      break;
  }
}

/** Place the fill light roughly opposite the key for soft balance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function positionFillLight(light: any, dir: FbxRenderConfig["keyDirection"]) {
  switch (dir) {
    case "front":
      light.position.set(-3, 2, -3);
      break;
    case "side":
      light.position.set(-6, 2, 0);
      break;
    case "back":
      light.position.set(3, 2, 3);
      break;
    case "overhead":
      light.position.set(0, -2, -3);
      break;
  }
}

/**
 * Apply tone (lit/flat) to the FBX root. "Flat" replaces materials
 * with MeshBasicMaterial in-place so the unlit retro look ships;
 * "lit" restores the original material set if it was saved.
 *
 * We stash the original material on a private `__litMaterial` slot
 * on each Mesh so the swap is reversible without re-parsing the FBX.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTone(THREE: any, root: any, tone: FbxRenderConfig["tone"]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (!obj.isMesh) return;
    if (tone === "flat") {
      if (!obj.__litMaterial) obj.__litMaterial = obj.material;
      // Pull the diffuse map (if any) off the original material so
      // textures still show; just bypass shading.
      const src = obj.__litMaterial;
      const map =
        Array.isArray(src) ? (src[0]?.map ?? null) : (src?.map ?? null);
      const color =
        Array.isArray(src)
          ? (src[0]?.color ?? new THREE.Color(0xffffff))
          : (src?.color ?? new THREE.Color(0xffffff));
      obj.material = new THREE.MeshBasicMaterial({
        map,
        color,
        transparent: !!(Array.isArray(src) ? src[0]?.transparent : src?.transparent),
      });
    } else {
      if (obj.__litMaterial) {
        obj.material = obj.__litMaterial;
      }
    }
  });
}

/** Flip on shadow casting + receiving across every mesh in the tree. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enableShadows(root: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function disableShadows(root: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
}

/**
 * Shared scene-builder — used by both `bakeFbxOffscreen` and the live
 * preview in `FbxImporter.tsx`. Centralises light placement,
 * background, and tone (lit/flat) so the two render paths produce
 * byte-identical output (given the same camera).
 *
 * Returns the constructed `Scene` plus refs to the light objects so
 * the preview can mutate intensities on slider drag without
 * rebuilding the scene.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFbxScene(THREE: any, root: any, render: FbxRenderConfig) {
  const scene = new THREE.Scene();
  if (render.background.kind === "solid") {
    scene.background = new THREE.Color(render.background.color);
  } else {
    // null background = canvas alpha shows through; the renderer's
    // clear color is what actually wins for the offscreen target.
    scene.background = null;
  }
  scene.add(root);

  const ambient = new THREE.AmbientLight(0xffffff, render.ambient);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, render.keyIntensity);
  positionKeyLight(key, render.keyDirection);
  if (render.shadow) {
    key.castShadow = true;
  }
  scene.add(key);

  // Fill from the opposite side of the key, cooler tone for subtle
  // depth on the shaded side.
  const fill = new THREE.DirectionalLight(0xc8d8ff, render.fillIntensity);
  positionFillLight(fill, render.keyDirection);
  scene.add(fill);

  // Apply tone (lit vs flat). Tone toggles use the FBX's existing
  // materials for "lit" and swap to MeshBasicMaterial for "flat" so
  // the user gets a retro unlit look without losing the original
  // material set on switch-back.
  applyTone(THREE, root, render.tone);

  if (render.shadow) {
    enableShadows(root);
  }

  return { scene, ambient, key, fill };
}

/**
 * Re-apply render config to an existing scene without rebuilding —
 * the preview's slider changes call this so the viewport updates in
 * real time without a full `buildFbxScene` rebuild.
 */
export function applyFbxRenderConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any,
  scene: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scene: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ambient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    key: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fill: any;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
  render: FbxRenderConfig,
) {
  scene.ambient.intensity = render.ambient;
  scene.key.intensity = render.keyIntensity;
  scene.fill.intensity = render.fillIntensity;
  positionKeyLight(scene.key, render.keyDirection);
  positionFillLight(scene.fill, render.keyDirection);
  if (render.background.kind === "solid") {
    scene.scene.background = new THREE.Color(render.background.color);
  } else {
    scene.scene.background = null;
  }
  applyTone(THREE, root, render.tone);
  if (render.shadow) {
    enableShadows(root);
    scene.key.castShadow = true;
  } else {
    disableShadows(root);
    scene.key.castShadow = false;
  }
}

/** Place the key light at a canonical preset position. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function positionKeyLight(light: any, dir: FbxRenderConfig["keyDirection"]) {
  switch (dir) {
    case "front":
      light.position.set(3, 5, 5);
      break;
    case "side":
      light.position.set(6, 4, 0);
      break;
    case "back":
      light.position.set(-3, 5, -5);
      break;
    case "overhead":
      light.position.set(0, 8, 0.5);
      break;
  }
}

/** Place the fill light roughly opposite the key for soft balance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function positionFillLight(light: any, dir: FbxRenderConfig["keyDirection"]) {
  switch (dir) {
    case "front":
      light.position.set(-3, 2, -3);
      break;
    case "side":
      light.position.set(-6, 2, 0);
      break;
    case "back":
      light.position.set(3, 2, 3);
      break;
    case "overhead":
      light.position.set(0, -2, -3);
      break;
  }
}

/**
 * Apply tone (lit/flat) to the FBX root. "Flat" replaces materials
 * with MeshBasicMaterial in-place so the unlit retro look ships;
 * "lit" restores the original material set if it was saved.
 *
 * We stash the original material on a private `__litMaterial` slot
 * on each Mesh so the swap is reversible without re-parsing the FBX.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTone(THREE: any, root: any, tone: FbxRenderConfig["tone"]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (!obj.isMesh) return;
    if (tone === "flat") {
      if (!obj.__litMaterial) obj.__litMaterial = obj.material;
      // Pull the diffuse map (if any) off the original material so
      // textures still show; just bypass shading.
      const src = obj.__litMaterial;
      const map =
        Array.isArray(src) ? (src[0]?.map ?? null) : (src?.map ?? null);
      const color =
        Array.isArray(src)
          ? (src[0]?.color ?? new THREE.Color(0xffffff))
          : (src?.color ?? new THREE.Color(0xffffff));
      obj.material = new THREE.MeshBasicMaterial({
        map,
        color,
        transparent: !!(Array.isArray(src) ? src[0]?.transparent : src?.transparent),
      });
    } else {
      if (obj.__litMaterial) {
        obj.material = obj.__litMaterial;
      }
    }
  });
}

/** Flip on shadow casting + receiving across every mesh in the tree. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enableShadows(root: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function disableShadows(root: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
}

/**
 * Convert an `FbxBakeConfig` to the persisted FBX meta block. Stored
 * inside `SpriteSourceMeta.fbx` on save.
 */
export function fbxConfigToMeta(
  config: FbxBakeConfig,
): NonNullable<import("./EditorProjectStore").SpriteSourceMeta["fbx"]> {
  const framesPerAnimation: Record<string, number> = {};
  const clipMapping: Record<string, string> = {};
  const enabledClips: string[] = [];
  for (const anim of config.animations) {
    framesPerAnimation[anim.outputName] = anim.frameCount;
    clipMapping[anim.fbxClipName] = anim.outputName;
    if (!enabledClips.includes(anim.fbxClipName)) {
      enabledClips.push(anim.fbxClipName);
    }
  }
  return {
    forwardRotation: { ...config.forwardRotation },
    cameraElevation: config.cameraElevation,
    cellSize: config.cellSize,
    framesPerAnimation,
    clipMapping,
    enabledClips,
    render: cloneRenderConfig(config.render ?? DEFAULT_FBX_RENDER_CONFIG),
  };
}
