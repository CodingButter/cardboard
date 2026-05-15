/// <reference types="bun" />
/**
 * Generates the PWA icon set in `public/icons/`.
 *
 *   - icon-192.png        (any-purpose, 192×192)
 *   - icon-512.png        (any-purpose, 512×512)
 *   - icon-512-maskable.png (maskable, 512×512 with safe inner area)
 *
 * Icons are a dark-slate square with a magenta crosshair so they're
 * recognisable on a home screen.  No image deps — we encode raw PNGs
 * via `Bun.deflateSync` (zlib stream, which is what PNG IDAT chunks
 * expect).
 *
 * Run with: `bun scripts/make-icons.ts`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// `make-icons.ts` lives at `apps/pack-builder/src/`; the icons ship
// from the game app's static directory at `apps/game/public/icons`.
const OUT_DIR = resolve(import.meta.dir, "../../../apps/game/public/icons");

const BG = [0x0f, 0x17, 0x2a, 0xff] as const; // slate-900
const FG = [0xec, 0x4f, 0xc7, 0xff] as const; // magenta-ish crosshair
const RING = [0xf8, 0x72, 0xd1, 0xff] as const;

type Pixel = readonly [number, number, number, number];

/** Build a flat RGBA buffer with a dark background. */
function fill(size: number, bg: Pixel): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = bg[0];
    buf[i + 1] = bg[1];
    buf[i + 2] = bg[2];
    buf[i + 3] = bg[3];
  }
  return buf;
}

function setPx(buf: Uint8Array, size: number, x: number, y: number, c: Pixel): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = c[3];
}

/** Filled disc — used for the central crosshair dot and ring fill. */
function disc(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  c: Pixel,
): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPx(buf, size, x, y, c);
    }
  }
}

/** Annulus (ring) between rIn and rOut. */
function ring(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  c: Pixel,
): void {
  const rIn2 = rIn * rIn;
  const rOut2 = rOut * rOut;
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y++) {
    for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= rOut2 && d2 >= rIn2) setPx(buf, size, x, y, c);
    }
  }
}

/** Axis-aligned rectangle (used for the four crosshair arms). */
function rect(
  buf: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  c: Pixel,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPx(buf, size, x, y, c);
  }
}

/**
 * Draw a "crosshair on slate" icon.
 *
 * `safe` is the radius (in pixels) of the visible content circle — for
 * maskable icons we keep everything inside the 80% safe zone so OS
 * mask-cropping doesn't clip the crosshair.
 */
function drawIcon(size: number, safe: number): Uint8Array {
  const buf = fill(size, BG);
  const cx = size / 2;
  const cy = size / 2;

  const armLen = safe * 0.85;
  const armT = Math.max(2, Math.round(size * 0.04));

  // Crosshair arms
  rect(buf, size, Math.round(cx - armT / 2), Math.round(cy - armLen), armT, armLen * 2, FG);
  rect(buf, size, Math.round(cx - armLen), Math.round(cy - armT / 2), armLen * 2, armT, FG);

  // Outer ring
  const rOut = safe * 0.78;
  const rIn = rOut - Math.max(3, Math.round(size * 0.025));
  ring(buf, size, cx, cy, rIn, rOut, RING);

  // Center dot
  disc(buf, size, cx, cy, Math.max(2, size * 0.035), FG);

  return buf;
}

// ─── PNG encoder ─────────────────────────────────────────────────────────────

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** CRC32 used by PNG chunk trailers. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = u32be(data.length);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const crc = u32be(crc32(body));
  const out = new Uint8Array(len.length + body.length + crc.length);
  out.set(len, 0);
  out.set(body, len.length);
  out.set(crc, len.length + body.length);
  return out;
}

/** Encode an RGBA buffer to a PNG byte stream. */
function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  // PNG IDAT wants each scanline prefixed with a filter byte (0 = None).
  const rowLen = size * 4;
  const filtered = new Uint8Array((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    filtered[y * (rowLen + 1)] = 0;
    filtered.set(rgba.subarray(y * rowLen, (y + 1) * rowLen), y * (rowLen + 1) + 1);
  }
  const compressed = Bun.deflateSync(filtered);

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(size), 0);
  ihdr.set(u32be(size), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", compressed);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let off = 0;
  out.set(sig, off);
  off += sig.length;
  out.set(ihdrChunk, off);
  off += ihdrChunk.length;
  out.set(idatChunk, off);
  off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

function writeIcon(name: string, size: number, safeRatio: number): void {
  const path = resolve(OUT_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  const buf = drawIcon(size, (size / 2) * safeRatio);
  const png = encodePng(buf, size);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${size}×${size}, ${png.length} bytes)`);
}

// Any-purpose icons use the full canvas; maskable keeps content inside 80%.
writeIcon("icon-192.png", 192, 1.0);
writeIcon("icon-512.png", 512, 1.0);
writeIcon("icon-512-maskable.png", 512, 0.8);
