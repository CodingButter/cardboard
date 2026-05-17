/**
 * Build-time icon pipeline. Resizes a pack's declared source icon
 * (`manifest.icon`) into the three PWA-standard variants the game
 * runner injects at boot:
 *
 *   images/icon-192.png            (any-purpose, 192×192)
 *   images/icon-512.png            (any-purpose, 512×512)
 *   images/icon-maskable-512.png   (maskable, 512×512 with 80% safe-zone)
 *
 * Uses `sharp` for fast Node-native resize + composite. The maskable
 * variant follows the PWA spec: the source content is scaled to 80% of
 * the canvas and centered on a solid `themeColor` background so the
 * OS mask-crop doesn't clip the icon.
 *
 * The browser-side counterpart (Canvas API, no native deps) lives in
 * `apps/editor/src/lib/iconPipeline.ts` — same shape of three output
 * sizes, used when the editor's "export pack" flow eventually needs to
 * generate the same set without a Node build step.
 */
import sharp from "sharp";

export interface IconVariants {
  /** Output zip path for the 192×192 any-purpose icon. */
  path192: string;
  /** Output zip path for the 512×512 any-purpose icon. */
  path512: string;
  /** Output zip path for the 512×512 maskable icon. */
  pathMaskable: string;
  /** PNG bytes, ready to drop into the zip. */
  bytes192: Uint8Array;
  bytes512: Uint8Array;
  bytesMaskable: Uint8Array;
}

/**
 * Parse a `#RRGGBB` (or `#RGB`) hex string into `{r, g, b}`. Defaults
 * to the editor's zinc-950 (`#08090b`) on parse failure so a typo'd
 * `themeColor` doesn't fail the build — the maskable icon just falls
 * back to the engine's canonical dark background.
 */
function parseHexColor(hex: string | undefined): { r: number; g: number; b: number } {
  const fallback = { r: 0x08, g: 0x09, b: 0x0b };
  if (!hex || typeof hex !== "string") return fallback;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6) return fallback;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return fallback;
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

/**
 * Generate the three PWA icon variants from a source image buffer.
 *
 * @param sourceBytes The raw bytes of the source icon (any sharp-
 *                    decodable format — png/jpg/webp).
 * @param themeColor  Pack-declared theme color (`#RRGGBB`). Used as
 *                    the safe-zone background for the maskable
 *                    variant. Defaults to the editor's zinc-950.
 */
export async function buildIconVariants(
  sourceBytes: Uint8Array | Buffer,
  themeColor: string | undefined,
): Promise<{
  bytes192: Uint8Array;
  bytes512: Uint8Array;
  bytesMaskable: Uint8Array;
}> {
  const input = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes);

  // Standard any-purpose variants: fit the full source into the
  // square canvas, preserving aspect ratio. Use `contain` + a
  // transparent background so non-square source art stays readable.
  const bytes192 = new Uint8Array(
    await sharp(input)
      .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  );
  const bytes512 = new Uint8Array(
    await sharp(input)
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  );

  // Maskable variant: composite the source at 80% scale (410×410 within
  // a 512×512 canvas) on a solid `themeColor` background. The 80% safe-
  // zone is the PWA spec — see https://web.dev/maskable-icon/.
  const { r, g, b } = parseHexColor(themeColor);
  const inner = await sharp(input)
    .resize(410, 410, { fit: "contain", background: { r, g, b, alpha: 1 } })
    .png()
    .toBuffer();
  const bytesMaskable = new Uint8Array(
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r, g, b, alpha: 1 },
      },
    })
      .composite([{ input: inner, left: 51, top: 51 }])
      .png()
      .toBuffer(),
  );

  return { bytes192, bytes512, bytesMaskable };
}

/**
 * Canonical in-zip paths for each variant. Centralised so both the
 * builder and the game runner reference the same strings.
 */
export const ICON_VARIANT_PATHS = {
  "192": "images/icon-192.png",
  "512": "images/icon-512.png",
  "maskable-512": "images/icon-maskable-512.png",
} as const;
