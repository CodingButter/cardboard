#!/usr/bin/env bun
/**
 * One-shot icon generator for the editor PWA.
 *
 * Reads `src/assets/logo.png` and writes three PNGs into `public/icons/`:
 *   - icon-192.png         192x192, purpose: any
 *   - icon-512.png         512x512, purpose: any
 *   - icon-512-maskable.png 512x512, purpose: maskable (10% safe-area
 *                          padding so the icon survives circular masks)
 *
 * Run:  bun run apps/editor/scripts/build-icons.ts
 */
// `sharp` isn't a direct editor dep — borrow the one already vendored
// for `apps/pack-builder` to avoid bloating the editor's install.
import sharp from "../../pack-builder/node_modules/sharp";
import { resolve } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const EDITOR_DIR = resolve(HERE, "..");
const SRC = resolve(EDITOR_DIR, "src/assets/logo.png");
const OUT_DIR = resolve(EDITOR_DIR, "public/icons");

const BG = { r: 8, g: 9, b: 11, alpha: 1 }; // matches theme_color #08090b

async function makeIcon(size: number, outName: string, padPct = 0) {
  const inner = Math.round(size * (1 - padPct * 2));
  const resized = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(resolve(OUT_DIR, outName));
  console.log(`[build-icons] wrote ${outName} (${size}x${size}, pad=${padPct})`);
}

await makeIcon(192, "icon-192.png", 0);
await makeIcon(512, "icon-512.png", 0);
// Maskable: ~10% safe-area padding so the inner art survives a
// circular mask without being cropped at the edges.
await makeIcon(512, "icon-512-maskable.png", 0.1);
