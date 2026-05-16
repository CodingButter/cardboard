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

export function BakedSpritePreview({
  spriteId,
  sprite,
  pngBlob,
  sourceMeta,
  onRebake,
  onOpenSource,
}: BakedSpritePreviewProps) {
  // Hold the blob as an object URL so the `<img>` can render. Revoke
  // on unmount / blob swap to avoid leaking GPU resources.
  const [objectUrl, setObjectUrl] = useState<string>("");
  useEffect(() => {
    const url = URL.createObjectURL(pngBlob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pngBlob]);

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

  const animDef = activeAnim
    ? sprite.animations?.[activeAnim]
    : undefined;
  const totalFrames = animDef?.frames.length ?? 0;
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Reset frame when switching animations.
  useEffect(() => {
    setFrameIdx(0);
  }, [activeAnim]);

  // Playback timer — drives `frameIdx` forward at `frameDuration`.
  // `loop: false` stops on the last frame; `loop: true` wraps to 0.
  // We reach for `setInterval` rather than rAF — the per-frame
  // cadence is tens-to-hundreds of ms, and an interval keeps the
  // logic readable. Re-arms whenever any input changes.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing || !animDef || totalFrames === 0) {
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
          if (animDef.loop !== false) return 0;
          // Non-looping — stop and pin to the last frame.
          setPlaying(false);
          return totalFrames - 1;
        }
        return next;
      });
    }, Math.max(0.01, animDef.frameDuration) * 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, animDef, totalFrames]);

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
        {/* PNG + grid overlay */}
        <div
          className="relative inline-block self-start border border-zinc-800 rounded bg-zinc-950/40"
          style={{ minWidth: sheetWidth, minHeight: sheetHeight }}
        >
          {objectUrl ? (
            <img
              src={objectUrl}
              alt={spriteId}
              draggable={false}
              style={{
                width: sheetWidth || undefined,
                height: sheetHeight || undefined,
                imageRendering: "pixelated",
                display: "block",
              }}
            />
          ) : null}
          {/* Grid lines */}
          {sheetWidth > 0 && sheetHeight > 0 ? (
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              width={sheetWidth}
              height={sheetHeight}
            >
              {Array.from({ length: cols + 1 }, (_, c) => {
                const x = c * frameWidth;
                return (
                  <line
                    key={`v${c}`}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={sheetHeight}
                    stroke="rgba(74, 222, 128, 0.4)"
                    strokeWidth={1}
                  />
                );
              })}
              {Array.from({ length: rows + 1 }, (_, r) => {
                const y = r * frameHeight;
                return (
                  <line
                    key={`h${r}`}
                    x1={0}
                    x2={sheetWidth}
                    y1={y}
                    y2={y}
                    stroke="rgba(74, 222, 128, 0.4)"
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          ) : null}
          {/* Active cell highlight */}
          {activeCell ? (
            <div
              className="absolute pointer-events-none"
              style={{
                left: activeCell.x,
                top: activeCell.y,
                width: activeCell.w,
                height: activeCell.h,
                outline: "2px solid #f59e0b",
                outlineOffset: -1,
                background: "rgba(245, 158, 11, 0.18)",
              }}
            />
          ) : null}
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
