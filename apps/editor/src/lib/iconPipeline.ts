/**
 * Browser-side icon pipeline. Resizes a source icon (any image
 * decodable by the browser's `createImageBitmap`) into the three
 * PWA-standard variants the game runner reads at boot:
 *
 *   192×192 any-purpose
 *   512×512 any-purpose
 *   512×512 maskable (80% safe-zone, theme-color background)
 *
 * The Node-side counterpart (`apps/pack-builder/src/icon-pipeline.ts`)
 * uses `sharp` for fast native resize during `bun run build-packs`.
 * This module mirrors the same outputs without external deps so the
 * editor's future "export pack" flow can produce identical artefacts
 * in-browser via the Canvas API.
 *
 * Not wired into any editor UI yet — the helper is exported in
 * anticipation of the export flow, so the canonical resize logic lives
 * in exactly one place.
 */

/**
 * Canonical in-zip paths for each variant. Mirrors
 * `apps/pack-builder/src/icon-pipeline.ts#ICON_VARIANT_PATHS` — keep
 * the two in sync.
 */
export const ICON_VARIANT_PATHS = {
  "192": "images/icon-192.png",
  "512": "images/icon-512.png",
  "maskable-512": "images/icon-maskable-512.png",
} as const;

export interface IconVariantBlobs {
  bytes192: Blob;
  bytes512: Blob;
  bytesMaskable: Blob;
}

/**
 * Parse a `#RRGGBB` (or `#RGB`) hex string into a CSS-fillStyle
 * compatible value. Returns the editor's zinc-950 fallback when the
 * input is missing/malformed so a typo'd `themeColor` doesn't crash
 * the resize call.
 */
function normaliseHexColor(hex: string | undefined): string {
  if (!hex || typeof hex !== "string") return "#08090b";
  const trimmed = hex.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return "#08090b";
}

/**
 * Resize a source image blob into a square PNG of `size × size`. The
 * source is drawn with `imageSmoothingEnabled` set so downscales
 * stay readable; aspect ratio is preserved by centering the source
 * on a transparent background.
 */
export async function resizeIcon(blob: Blob, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("resizeIcon: OffscreenCanvas 2d context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Aspect-preserving fit: scale to the larger of width/height, centre
  // on the target canvas. Square source art (the common case) fills
  // the canvas; non-square art leaves transparent margin.
  const aspect = bmp.width / bmp.height;
  let drawW = size;
  let drawH = size;
  if (aspect > 1) {
    drawH = size / aspect;
  } else if (aspect < 1) {
    drawW = size * aspect;
  }
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;
  ctx.drawImage(bmp, dx, dy, drawW, drawH);
  bmp.close();

  return await canvas.convertToBlob({ type: "image/png" });
}

/**
 * Composite a source image into a 512×512 PNG with an 80% safe-zone
 * (centered on a solid `themeColor` background). Standard PWA
 * maskable-icon spec — the OS may crop the corners to fit its mask, so
 * the visible content stays inside the centre disc.
 */
export async function buildMaskableIcon(
  blob: Blob,
  themeColor: string | undefined,
): Promise<Blob> {
  const size = 512;
  const inner = Math.round(size * 0.8); // 410 px
  const offset = Math.round((size - inner) / 2);
  const bg = normaliseHexColor(themeColor);

  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("buildMaskableIcon: OffscreenCanvas 2d context unavailable");
  }

  // Fill the full canvas with the theme color so OS-side mask crops
  // bleed into the same colour as the icon background.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Aspect-preserving fit into the inner safe-zone box.
  const aspect = bmp.width / bmp.height;
  let drawW = inner;
  let drawH = inner;
  if (aspect > 1) {
    drawH = inner / aspect;
  } else if (aspect < 1) {
    drawW = inner * aspect;
  }
  const dx = offset + (inner - drawW) / 2;
  const dy = offset + (inner - drawH) / 2;
  ctx.drawImage(bmp, dx, dy, drawW, drawH);
  bmp.close();

  return await canvas.convertToBlob({ type: "image/png" });
}

/**
 * Generate the full three-variant set from a single source blob.
 * Convenience wrapper around `resizeIcon` + `buildMaskableIcon` for the
 * editor's eventual "export pack" flow.
 */
export async function buildIconVariants(
  source: Blob,
  themeColor: string | undefined,
): Promise<IconVariantBlobs> {
  const [bytes192, bytes512, bytesMaskable] = await Promise.all([
    resizeIcon(source, 192),
    resizeIcon(source, 512),
    buildMaskableIcon(source, themeColor),
  ]);
  return { bytes192, bytes512, bytesMaskable };
}
