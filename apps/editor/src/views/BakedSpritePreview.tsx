import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SpriteDef } from "@two_5_d/engine/AssetPack";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";
import type { SpriteSourceMeta } from "../lib/EditorProjectStore";

/**
 * Baked-sprite preview pane.
 *
 * Renders the canonical PNG produced by AE1/AE2 with a grid overlay,
 * lets the user pick an animation and angle, and plays it back at the
 * animation's `frameDuration`. Pure component — the parent owns the
 * sprite metadata + the PNG blob; we only render and drive playback.
 *
 * Layout:
 *   ┌─ Sprite: <id> ──────────────────────────────────────────────┐
 *   │ [PNG + grid + amber cell outline]                           │
 *   │                                                             │
 *   │ ▼ Animations                                                │
 *   │  ◉ idle    [4f @ 0.20s, 1 angle, loop]                      │
 *   │      ▶ [scrubber 0/3]   [angle: 0 (front) ▾]                │
 *   │  ◯ walk    [4f @ 0.10s, 4 angles, loop]                     │
 *   │                                                             │
 *   │ Source: FBX (zombie.fbx) — [Re-bake] [Open source]          │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Bake / re-bake actions live in the parent (AnimationEditor) — this
 * component only fires callbacks when the user clicks the buttons.
 */

export interface BakedSpritePreviewProps {
  /** Sprite id — manifest key for the SpriteDef. */
  spriteId: string;
  /** SpriteDef from `manifest.sprites[id]`. */
  sprite: SpriteDef;
  /** Baked canonical PNG bytes (loaded from IDB by the parent). */
  pngBlob: Blob;
  /** Optional sidecar — drives the source row + Re-bake button. */
  sourceMeta?: SpriteSourceMeta;
  /**
   * Called when the user clicks "Re-bake" on the source footer.
   * The parent runs the same bake pipeline (FBX importer for `kind:
   * "fbx"`, the spritesheet baker for `kind: "spritesheet"`). When
   * absent the button is omitted.
   */
  onRebake?: () => void;
  /**
   * Called when the user clicks "Open source" — typically jumps back
   * to the FBX importer / spritesheet editor for that sprite. When
   * absent the button is omitted.
   */
  onOpenSource?: () => void;
}

/**
 * Friendly per-angle names for the standard angle counts. The engine's
 * runtime renderer indexes angles 0..N-1 by row in the canonical
 * sheet; this map lets the UI surface the cardinal direction labels
 * the modder actually thinks in.
 *
 * 8 angles = `front, FR, right, BR, back, BL, left, FL` (clockwise
 * from "facing the camera" at index 0). 4 angles drops the diagonals;
 * 5 keeps the front + the four cardinals. 2 = front/back. 1 = front.
 */
const ANGLE_LABELS: Record<number, ReadonlyArray<string>> = {
  1: ["front"],
  2: ["front", "back"],
  4: ["front", "right", "back", "left"],
  5: ["front", "front-right", "right", "back-right", "back"],
  8: [
    "front",
    "front-right",
    "right",
    "back-right",
    "back",
    "back-left",
    "left",
    "front-left",
  ],
  16: [
    "front",
    "fr-1",
    "front-right",
    "fr-2",
    "right",
    "br-1",
    "back-right",
    "br-2",
    "back",
    "bl-2",
    "back-left",
    "bl-1",
    "left",
    "fl-2",
    "front-left",
    "fl-1",
  ],
};

function labelForAngle(angles: number, index: number): string {
  const arr = ANGLE_LABELS[angles];
  if (!arr) return `angle ${index}`;
  return arr[index] ?? `angle ${index}`;
}

/**
 * Compute the row inside the canonical sheet that a given animation
 * occupies for a given angle. Mirrors the engine's
 * `rowBase + angleIndex` math from `docs/plans/ANIMATIONS.md` §5.1.
 */
function rowBaseFor(sprite: SpriteDef, animName: string): number {
  let acc = 0;
  const animations = sprite.animations ?? {};
  for (const k of Object.keys(animations)) {
    if (k === animName) return acc;
    acc += animations[k]?.angles ?? sprite.angles ?? 1;
  }
  return acc;
}

/** Max displayed edge of the atlas (debug) thumbnail in CSS pixels. */
const ATLAS_MAX_DISPLAY = 240;

export function BakedSpritePreview({
  spriteId,
  sprite,
  pngBlob,
  sourceMeta,
  onRebake,
  onOpenSource,
}: BakedSpritePreviewProps) {
  // Hold the blob as an object URL so the `<img>` can render. Revoke
  // on unmount / blob swap to avoid leaking GPU resources. Cleanup
  // must run AFTER React swaps the URL into the DOM, otherwise we get
  // a flash of revoked-URL where the live preview goes blank — we use
  // a microtask deferral via `queueMicrotask` to be safe.
  const [objectUrl, setObjectUrl] = useState<string>("");
  useEffect(() => {
    const url = URL.createObjectURL(pngBlob);
    setObjectUrl(url);
    return () => {
      // Defer the revoke — by the time this runs, React has already
      // committed the new URL into any background-image / <img> via
      // the next effect, so the old one is safe to release without
      // racing the still-mounted DOM nodes.
      const toRevoke = url;
      queueMicrotask(() => URL.revokeObjectURL(toRevoke));
    };
  }, [pngBlob]);

  // Decoded <img> for canvas-based live preview. Loading the image
  // ourselves (instead of relying on CSS background-image) gives us an
  // explicit `load` event so the canvas never paints an empty frame
  // after a re-bake. The browser's image decoder is async — without
  // this we'd see a flash of blank pixels because the div was sized
  // and positioned before the new PNG had been decoded.
  //
  // BUG 1 (re-bake blanks the live preview) — root cause: the
  // previous implementation drove the cell with CSS
  // `backgroundImage: url(objectUrl)`. When pngBlob changes, the
  // previous effect's cleanup revokes the old URL on a microtask,
  // racing the browser's async fetch+decode of the new URL. The
  // background-image div doesn't expose a `load` event, so React's
  // render commits the new URL before the bytes are actually
  // available, and the div paints empty. The atlas SVG/img view
  // worked because `<img>` has its own loading lifecycle.
  //
  // Fix: drive the live preview from this decoded `<img>` via a
  // `<canvas>` + `drawImage` (see live-preview canvas effect below).
  // The canvas only paints once `decodedImage` is non-null, so we
  // can never display a torn/blank frame post-bake.
  const [decodedImage, setDecodedImage] = useState<HTMLImageElement | null>(
    null,
  );
  useEffect(() => {
    if (!objectUrl) {
      setDecodedImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDecodedImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setDecodedImage(null);
    };
    img.src = objectUrl;
    return () => {
      cancelled = true;
    };
  }, [objectUrl]);

  const animationNames = useMemo(
    () => Object.keys(sprite.animations ?? {}),
    [sprite],
  );
  const [activeAnim, setActiveAnim] = useState<string | null>(
    animationNames[0] ?? null,
  );
  useEffect(() => {
    // If the sprite changes and the active anim disappears, snap back
    // to the first one. Keeps the playhead from referencing a stale
    // animation.
    if (!activeAnim || !animationNames.includes(activeAnim)) {
      setActiveAnim(animationNames[0] ?? null);
    }
  }, [animationNames, activeAnim]);

  // Effective angles for the active animation. Defaults to the
  // sprite-level angles, overridden by the per-animation `angles` key
  // when set. Matches `AnimationSystem`'s row-resolution logic.
  const effectiveAngles = useMemo(() => {
    if (!activeAnim) return sprite.angles ?? 1;
    return (
      sprite.animations?.[activeAnim]?.angles ?? sprite.angles ?? 1
    );
  }, [activeAnim, sprite]);

  const [angleIndex, setAngleIndex] = useState(0);
  useEffect(() => {
    // Clamp angle when switching to an animation with fewer angles.
    if (angleIndex >= effectiveAngles) setAngleIndex(0);
  }, [effectiveAngles, angleIndex]);

  // Memoize `animDef` so the timer effect's dep array sees a stable
  // reference. Without this, `sprite.animations?.[activeAnim]` is
  // re-evaluated every render — and even though the *property access*
  // returns the same object as long as `sprite`/`activeAnim` are
  // stable, in practice the parent occasionally rebuilds `sprite` (e.g.
  // after a re-bake's `setManifest`), and the previous implementation
  // would silently re-arm the playback `setInterval` on every render.
  // The interval was being cleared before its first tick, leaving the
  // preview pinned to frame 0. See suspect #2 in the bug write-up.
  const animDef = useMemo(
    () => (activeAnim ? sprite.animations?.[activeAnim] : undefined),
    [sprite, activeAnim],
  );
  const totalFrames = animDef?.frames.length ?? 0;
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Reset frame + auto-play when switching animations — the modder
  // almost always wants to see the animation playing immediately on
  // click, not to have to manually press ▶ every time.
  useEffect(() => {
    setFrameIdx(0);
    if (activeAnim) setPlaying(true);
  }, [activeAnim]);

  // Playback timer — drives `frameIdx` forward at `frameDuration`.
  // `loop: false` stops on the last frame; `loop: true` wraps to 0.
  // We reach for `setInterval` rather than rAF — the per-frame
  // cadence is tens-to-hundreds of ms, and an interval keeps the
  // logic readable.
  //
  // BUG 2 (preview pinned to frame 0) — root cause: this effect's
  // dep array used `animDef`, an OBJECT reference derived from the
  // sprite prop. Even though `animDef` is `useMemo`'d above, the
  // parent (`AnimationEditor`) holds the sprite via state and can
  // re-render this component whenever ANY parent state changes
  // (active-rail clicks, save-status toasts, modal toggles, etc.).
  // Each of those parent re-renders flows down the same `manifest`
  // object, but the live editor reload paths replace `manifest` with
  // a fresh deserialised object — even when the contents are
  // identical — which churns `sprite` → churns `animDef` → React's
  // `Object.is` dep check sees a new reference → cleanup + new
  // `setInterval` → the interval is cleared before its first tick
  // fires → frame never advances. The single-frame highlight on the
  // atlas grid and the live canvas both stayed pinned to frame 0.
  //
  // Fix: depend on the *primitive* fields the effect actually reads
  // (`activeAnim` identifier + `frameDuration` + `loop` flag +
  // `totalFrames`) instead of the whole `animDef` object. Primitives
  // compare by value, so re-renders with referentially-fresh-but-
  // value-identical `animDef`s no longer thrash the interval. The
  // interval callback still closes over the latest `animDef` via the
  // render-scope binding, which is correct because the effect DOES
  // re-arm when any of the value-fields change.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameDuration = animDef?.frameDuration ?? 0;
  const animLoop = animDef?.loop !== false;
  useEffect(() => {
    // `totalFrames === 0` covers both "no animation" and "animation
    // with zero frames" — no need to also null-check animDef here.
    if (!playing || totalFrames === 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      setFrameIdx((f) => {
        const next = f + 1;
        if (next >= totalFrames) {
          if (animLoop) return 0;
          // Non-looping — stop and pin to the last frame.
          setPlaying(false);
          return totalFrames - 1;
        }
        return next;
      });
    }, Math.max(0.01, frameDuration) * 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, totalFrames, frameDuration, animLoop]);

  // Grid params for the overlay. `frameWidth`/`frameHeight` are
  // optional on SpriteDef (single-image sprites omit them); when
  // absent we fall back to "treat the whole image as one cell" so the
  // preview still renders.
  const frameWidth = sprite.frameWidth ?? 0;
  const frameHeight = sprite.frameHeight ?? 0;
  const cols = sprite.cols ?? 1;
  const rows = sprite.rows ?? 1;
  const sheetWidth = frameWidth * cols || 0;
  const sheetHeight = frameHeight * rows || 0;

  // Active-cell highlight position (top-left in source-image pixels).
  const activeCell = useMemo(() => {
    if (!animDef || !activeAnim || frameWidth === 0) return null;
    const rowBase = rowBaseFor(sprite, activeAnim);
    const row = rowBase + angleIndex;
    const col = animDef.frames[frameIdx] ?? 0;
    return {
      x: col * frameWidth,
      y: row * frameHeight,
      w: frameWidth,
      h: frameHeight,
    };
  }, [animDef, activeAnim, frameIdx, angleIndex, frameWidth, frameHeight, sprite]);

  // Live-preview canvas — paints the active cell from the *decoded*
  // image. We don't paint until `decodedImage` is non-null, which
  // means we never show a torn/blank frame after a re-bake (the
  // canvas keeps its prior pixels until the new image is ready).
  // 4× scale + `imageSmoothingEnabled = false` matches the engine's
  // nearest-neighbor sampling, so the modder sees crisp pixels.
  const LIVE_SCALE = 4;
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    if (!decodedImage || !activeCell || frameWidth === 0 || frameHeight === 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Reset transforms + disable smoothing every paint — the canvas
    // may have been resized between renders if frameWidth changed.
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      decodedImage,
      activeCell.x,
      activeCell.y,
      activeCell.w,
      activeCell.h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [decodedImage, activeCell, frameWidth, frameHeight]);

  // Displayed (CSS-pixel) size of the atlas thumbnail on the right.
  // We scale the natural sheet dimensions down to fit a square of
  // ATLAS_MAX_DISPLAY while preserving aspect ratio. The SVG grid +
  // amber highlight read these values so they line up with what the
  // user actually sees, not the source PNG's native size.
  const atlasDisplay = useMemo(() => {
    if (sheetWidth === 0 || sheetHeight === 0) {
      return { w: 0, h: 0, scale: 1 };
    }
    const scale = Math.min(
      ATLAS_MAX_DISPLAY / sheetWidth,
      ATLAS_MAX_DISPLAY / sheetHeight,
      1,
    );
    return {
      w: Math.round(sheetWidth * scale),
      h: Math.round(sheetHeight * scale),
      scale,
    };
  }, [sheetWidth, sheetHeight]);

  const sourceFooter = sourceMeta
    ? sourceMeta.kind === "fbx"
      ? `FBX (${sourceMeta.sourcePath.split("/").pop()})`
      : sourceMeta.kind === "spritesheet"
        ? `spritesheet (${sourceMeta.sourcePath.split("/").pop()})`
        : `${sourceMeta.kind} (${sourceMeta.sourcePath.split("/").pop()})`
    : null;

  return (
    <div
      className="flex-1 flex flex-col bg-zinc-950/20 overflow-hidden"
      data-testid="baked-sprite-preview"
    >
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-3 text-xs text-zinc-400">
        <span>
          Sprite:{" "}
          <strong className="text-zinc-200">{spriteId}</strong>
        </span>
        <span>·</span>
        <span>
          {frameWidth}×{frameHeight} px · Grid {cols}×{rows}
        </span>
        <span>·</span>
        <span>
          {animationNames.length} anim
          {animationNames.length === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span>{sprite.angles ?? 1} default angle{(sprite.angles ?? 1) === 1 ? "" : "s"}</span>
        {sourceMeta?.kind === "fbx" ? (
          <span className="ml-2 rounded bg-amber-700/40 text-amber-100 px-2 py-0.5 text-[10px]">
            FBX
          </span>
        ) : sourceMeta?.kind === "spritesheet" ? (
          <span className="ml-2 rounded bg-zinc-700/40 text-zinc-200 px-2 py-0.5 text-[10px]">
            sheet
          </span>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {/* TWO-COLUMN: live preview (primary) on the left, atlas
            thumbnail (debug) on the right. The atlas auto-scales to
            ATLAS_MAX_DISPLAY so a 1024×1024 FBX bake doesn't blow the
            layout. The animation list lives below in a full-width row
            so the scrubber gets real estate. */}
        <div className="flex flex-row flex-wrap gap-6 items-start">
          {/* LEFT — live preview (canvas) + angle buttons. The canvas
              repaints from the decoded image via the effect above; it
              never shows a torn frame after a re-bake. */}
          {activeCell && frameWidth > 0 && frameHeight > 0 ? (
            <section className="flex-shrink-0">
              <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                Live preview
                {activeAnim ? (
                  <span className="text-zinc-500 normal-case ml-2 lowercase">
                    · {activeAnim} · angle {angleIndex} ({labelForAngle(effectiveAngles, angleIndex)}) · frame {frameIdx + 1}/{totalFrames}
                  </span>
                ) : null}
              </h3>
              <canvas
                ref={liveCanvasRef}
                width={frameWidth * LIVE_SCALE}
                height={frameHeight * LIVE_SCALE}
                className="border border-zinc-700 rounded bg-zinc-950 block"
                style={{
                  width: frameWidth * LIVE_SCALE,
                  height: frameHeight * LIVE_SCALE,
                  imageRendering: "pixelated",
                }}
                data-testid="baked-preview-live-cell"
              />
              {/* Angle buttons — quick visual swap, more direct than a dropdown. */}
              {effectiveAngles > 1 ? (
                <div
                  className="mt-2 flex flex-wrap gap-1"
                  style={{ maxWidth: frameWidth * LIVE_SCALE }}
                  data-testid="baked-preview-angle-buttons"
                >
                  {Array.from({ length: effectiveAngles }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setAngleIndex(i)}
                      className={cn(
                        "px-2 py-1 text-[11px] rounded border transition-colors",
                        i === angleIndex
                          ? "border-amber-500 bg-amber-700/30 text-amber-100"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
                      )}
                    >
                      {labelForAngle(effectiveAngles, i)}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* RIGHT — atlas thumbnail (debug). PNG + grid overlay,
              scaled down to fit ATLAS_MAX_DISPLAY. The SVG and
              highlight read the displayed dimensions, not the source
              PNG's, so they always line up. */}
          <section className="flex-shrink-0">
            <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
              Atlas
              {sheetWidth > 0 ? (
                <span className="text-zinc-500 normal-case ml-2 lowercase">
                  · {sheetWidth}×{sheetHeight} px
                  {atlasDisplay.scale < 1
                    ? ` · ${Math.round(atlasDisplay.scale * 100)}%`
                    : ""}
                </span>
              ) : null}
            </h3>
            <div
              className="relative inline-block border border-zinc-800 rounded bg-zinc-950/40"
              style={{
                width: atlasDisplay.w || sheetWidth || undefined,
                height: atlasDisplay.h || sheetHeight || undefined,
                minWidth: 1,
                minHeight: 1,
              }}
            >
              {objectUrl && atlasDisplay.w > 0 ? (
                <img
                  src={objectUrl}
                  alt={spriteId}
                  draggable={false}
                  style={{
                    width: atlasDisplay.w,
                    height: atlasDisplay.h,
                    imageRendering: "pixelated",
                    display: "block",
                  }}
                />
              ) : null}
              {/* Grid lines — drawn against the DISPLAYED size, so they
                  remain pixel-aligned with the visible thumbnail. */}
              {atlasDisplay.w > 0 && atlasDisplay.h > 0 ? (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={atlasDisplay.w}
                  height={atlasDisplay.h}
                >
                  {Array.from({ length: cols + 1 }, (_, c) => {
                    const x = c * frameWidth * atlasDisplay.scale;
                    return (
                      <line
                        key={`v${c}`}
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={atlasDisplay.h}
                        stroke="rgba(74, 222, 128, 0.4)"
                        strokeWidth={1}
                      />
                    );
                  })}
                  {Array.from({ length: rows + 1 }, (_, r) => {
                    const y = r * frameHeight * atlasDisplay.scale;
                    return (
                      <line
                        key={`h${r}`}
                        x1={0}
                        x2={atlasDisplay.w}
                        y1={y}
                        y2={y}
                        stroke="rgba(74, 222, 128, 0.4)"
                        strokeWidth={1}
                      />
                    );
                  })}
                </svg>
              ) : null}
              {/* Active cell highlight — same scale as the thumbnail. */}
              {activeCell && atlasDisplay.scale > 0 ? (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: activeCell.x * atlasDisplay.scale,
                    top: activeCell.y * atlasDisplay.scale,
                    width: activeCell.w * atlasDisplay.scale,
                    height: activeCell.h * atlasDisplay.scale,
                    outline: "2px solid #f59e0b",
                    outlineOffset: -1,
                    background: "rgba(245, 158, 11, 0.18)",
                  }}
                />
              ) : null}
            </div>
          </section>
        </div>

        {/* Animation list */}
        <section className="w-full">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-wide text-zinc-400">
              Animations
            </h3>
            {animationNames.length > 0 ? (
              <label className="text-[11px] text-zinc-500 flex items-center gap-2">
                <span>angle</span>
                <select
                  value={angleIndex}
                  onChange={(e) => setAngleIndex(Number(e.target.value))}
                  className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2"
                  data-testid="baked-preview-angle-select"
                >
                  {Array.from({ length: effectiveAngles }, (_, i) => (
                    <option key={i} value={i}>
                      {i} ({labelForAngle(effectiveAngles, i)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {animationNames.length === 0 ? (
            <div className="text-xs text-zinc-500 border border-dashed border-zinc-800 rounded p-3">
              This sprite has no animations defined.
            </div>
          ) : (
            <ul className="space-y-1">
              {animationNames.map((name) => {
                const def = sprite.animations?.[name];
                if (!def) return null;
                const isActive = activeAnim === name;
                const animAngles = def.angles ?? sprite.angles ?? 1;
                return (
                  <li
                    key={name}
                    className={cn(
                      "rounded border border-zinc-800 bg-zinc-900/40 p-2 cursor-pointer",
                      isActive && "border-amber-500/60 bg-zinc-900/80",
                    )}
                    onClick={() => setActiveAnim(name)}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        checked={isActive}
                        onChange={() => setActiveAnim(name)}
                        className="accent-amber-500"
                      />
                      <span className="text-zinc-200 font-medium">
                        {name}
                      </span>
                      <span className="text-zinc-500">
                        {def.frames.length}f @ {def.frameDuration.toFixed(2)}s ·{" "}
                        {animAngles} angle{animAngles === 1 ? "" : "s"} ·{" "}
                        {def.loop === false ? "no-loop" : "loop"}
                        {def.next ? ` → ${def.next}` : ""}
                      </span>
                    </div>
                    {isActive ? (
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlaying((p) => !p);
                          }}
                        >
                          {playing ? "⏸" : "▶"}
                        </Button>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, totalFrames - 1)}
                          value={frameIdx}
                          onChange={(e) => {
                            setPlaying(false);
                            setFrameIdx(Number(e.target.value));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 accent-amber-500"
                        />
                        <span className="text-[11px] text-zinc-400 tabular-nums w-12 text-right">
                          {frameIdx + 1}/{totalFrames}
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Source footer */}
        {sourceFooter ? (
          <section className="border-t border-zinc-800 pt-3 flex items-center justify-between text-xs text-zinc-400">
            <span>
              Source:{" "}
              <span className="font-mono text-zinc-300">{sourceFooter}</span>
            </span>
            <div className="flex items-center gap-2">
              {onRebake ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRebake}
                  title="Re-run the bake pipeline against the saved source"
                >
                  🔄 Re-bake
                </Button>
              ) : null}
              {onOpenSource ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenSource}
                  title="Open the source in its native editor"
                >
                  Open source
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="border-t border-zinc-800 pt-3 text-xs text-zinc-500">
            No editor-side source recorded — this sprite was imported
            externally.
          </section>
        )}
      </div>
    </div>
  );
}
