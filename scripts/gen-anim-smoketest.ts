#!/usr/bin/env bun
/**
 * Generate the A1 ANIMATIONS smoke-test sprite sheet.
 *
 * Produces a 4-column × 2-row PNG at
 * `packages/default-pack/images/sprites/anim_marker.png`:
 *
 *   col 0 col 1 col 2 col 3
 *  ┌──────┬──────┬──────┬──────┐
 *  │ idle ang 0│  idle ang 1│  idle ang 2│  idle ang 3│  row 0 — idle (1 frame in `frames`, but the 4 columns
 *  ├──────┼──────┼──────┼──────┤          let us still demonstrate the multi-angle UV math)
 *  │ spin frame 0 (1-angle)                          │  row 1 — actually used as the "spin" animation row
 *
 * The sheet design used at runtime is simpler — we use a 4×4 grid:
 *
 *   row 0..3 = idle animation, one row per angle (4 angles)
 *   col 0..3 = frames 0..3 of the spin
 *
 * Each cell is 32×32 px. Angle 0 (front) renders a red arrow pointing
 * UP, angle 1 (right) a green arrow pointing UP (rotated marker means
 * "as the camera moves around you see different colours"), etc. The
 * "spin" cycles by hue across the 4 frames per row.
 *
 * Output: PNG via `Bun.write` + a hand-written PNG encoder. We avoid
 * heavy deps (sharp, canvas) — this is one-off generation.
 *
 * Re-run: `bun run scripts/gen-anim-smoketest.ts`. Commit the PNG.
 */

import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const CELL = 32;
const COLS = 4;
const ROWS = 4; // 4 angles, 1 animation ("idle"), 4 frames-per-row
const W = CELL * COLS;
const H = CELL * ROWS;

/** RGBA byte buffer, row-major. */
const px = new Uint8Array(W * H * 4);

function setPx(x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

/** HSL → RGB (h,s,l in [0..1]). */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Each cell shows a different appearance per (col=frame, row=angle):
 *
 *  - background colour = hue rotated by angle (so walking around the
 *    sprite you see a clear hue shift between cardinal directions).
 *  - foreground arrow = brightness pulses with `col` so the animation
 *    plays back as a visible 4-frame loop.
 *  - top-left corner shows a black tick the size of `col + 1` (also
 *    helps confirm the frame is advancing).
 */
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const cellX = col * CELL;
    const cellY = row * CELL;
    // Background hue: per angle.
    const [bgR, bgG, bgB] = hsl(row / ROWS, 0.55, 0.4);
    // Foreground brightness pulses per frame.
    const fgL = 0.55 + 0.25 * Math.sin((col / COLS) * Math.PI * 2);
    const [fgR, fgG, fgB] = hsl(row / ROWS, 1.0, fgL);

    // Cell fill.
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        setPx(cellX + x, cellY + y, bgR, bgG, bgB, 255);
      }
    }
    // 1-px border (white) so cells are visually separated when
    // mis-renderered as a single layer.
    for (let i = 0; i < CELL; i++) {
      setPx(cellX + i, cellY, 255, 255, 255);
      setPx(cellX + i, cellY + CELL - 1, 255, 255, 255);
      setPx(cellX, cellY + i, 255, 255, 255);
      setPx(cellX + CELL - 1, cellY + i, 255, 255, 255);
    }
    // Frame tick marks: top-left, (col+1) black pixels in a row.
    for (let i = 0; i < col + 1; i++) {
      setPx(cellX + 2 + i, cellY + 2, 0, 0, 0);
    }
    // Angle tick marks: bottom-left, (row+1) black pixels in a column.
    for (let i = 0; i < row + 1; i++) {
      setPx(cellX + 2, cellY + CELL - 3 - i, 0, 0, 0);
    }
    // Centered foreground arrow (small triangle pointing up).
    for (let y = 8; y < 24; y++) {
      const w = 12 - (y - 8) * 0;
      const halfW = Math.max(0, 12 - Math.abs(y - 16));
      for (let dx = -halfW; dx <= halfW; dx++) {
        setPx(cellX + CELL / 2 + dx, cellY + y, fgR, fgG, fgB, 255);
      }
    }
  }
}

/** PNG encoder — minimal (no filter, single IDAT chunk). */
function pngEncode(width: number, height: number, rgba: Uint8Array): Uint8Array {
  // Row-by-row with filter byte 0 (None) prefixed.
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter type
    filtered.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(filtered);

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const len = data.length;
    const buf = new Uint8Array(8 + len + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, len);
    buf[4] = type.charCodeAt(0);
    buf[5] = type.charCodeAt(1);
    buf[6] = type.charCodeAt(2);
    buf[7] = type.charCodeAt(3);
    buf.set(data, 8);
    // CRC over type + data.
    const crcInput = buf.subarray(4, 8 + len);
    const crc = crc32(crcInput);
    dv.setUint32(8 + len, crc);
    return buf;
  }

  const ihdr = new Uint8Array(13);
  const ihdrDv = new DataView(ihdr.buffer);
  ihdrDv.setUint32(0, width);
  ihdrDv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const png = pngEncode(W, H, px);
const outPath = new URL(
  "../packages/default-pack/images/sprites/anim_marker.png",
  import.meta.url,
).pathname;
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${W}×${H}, ${png.length} bytes)`);
