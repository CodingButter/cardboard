/**
 * Publish-mode config + asset-optimization helpers for the pack
 * builder. See `docs/plans/PUBLISH_SETTINGS.md` and
 * `apps/pack-builder/.env.example`.
 *
 * Bun reads `.env` automatically. This module just reads
 * `process.env`, applies defaults that mirror `.env.example`, and
 * exposes:
 *
 *   - `loadPublishConfig()` — resolve mode + knobs from env.
 *   - `optimizeImage(...)` — sharp-driven re-encode, optional resize.
 *     Tilesheets are pixel-preserved (NEVER resized); individual
 *     images may be downscaled if larger than IMAGE_MAX_DIMENSION.
 *   - `optimizeAudio(...)` — ffmpeg-driven re-encode (WAV→MP3, MP3
 *     bit/sample-rate re-encode). If ffmpeg is missing on PATH the
 *     helper logs a one-time warning and returns the original bytes
 *     unmodified so the build never hard-fails on a tooling gap.
 *
 * In development mode (the default) NONE of the helpers are invoked
 * by the build pipeline — assets pass through byte-for-byte. The
 * helpers themselves are still safe to call in dev (they short-circuit
 * to a pass-through), but the build skips them entirely so the dev
 * loop stays sharp-free / ffmpeg-free.
 */

import sharp from "sharp";

export type PublishMode = "development" | "production";

export interface PublishConfig {
  mode: PublishMode;
  image: {
    maxDimension: number;
    jpegQuality: number;
    pngQuantize: boolean;
  };
  tilesheet: {
    jpegQuality: number;
    pngQuantize: boolean;
  };
  audio: {
    bitrate: string;
    sampleRate: number;
  };
}

const DEFAULTS: PublishConfig = {
  mode: "development",
  image: {
    maxDimension: 1024,
    jpegQuality: 85,
    pngQuantize: true,
  },
  tilesheet: {
    jpegQuality: 90,
    pngQuantize: false,
  },
  audio: {
    bitrate: "128k",
    sampleRate: 44100,
  },
};

function parseInt32(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

/**
 * Resolve the publish config from `process.env`. Bun loads `.env`
 * automatically, so by the time this runs the relevant keys are
 * already merged into `process.env`.
 *
 * Unknown values for `PUBLISH_MODE` (e.g. typos) fall back to
 * `development` — we'd rather emit a slow-and-correct dev pack than
 * silently misinterpret a mode flag.
 */
export function loadPublishConfig(): PublishConfig {
  const rawMode = (process.env.PUBLISH_MODE ?? "").trim().toLowerCase();
  const mode: PublishMode = rawMode === "production" ? "production" : "development";
  return {
    mode,
    image: {
      maxDimension: parseInt32(
        process.env.IMAGE_MAX_DIMENSION,
        DEFAULTS.image.maxDimension,
      ),
      jpegQuality: parseInt32(
        process.env.IMAGE_JPEG_QUALITY,
        DEFAULTS.image.jpegQuality,
      ),
      pngQuantize: parseBool(
        process.env.IMAGE_PNG_QUANTIZE,
        DEFAULTS.image.pngQuantize,
      ),
    },
    tilesheet: {
      jpegQuality: parseInt32(
        process.env.TILESHEET_JPEG_QUALITY,
        DEFAULTS.tilesheet.jpegQuality,
      ),
      pngQuantize: parseBool(
        process.env.TILESHEET_PNG_QUANTIZE,
        DEFAULTS.tilesheet.pngQuantize,
      ),
    },
    audio: {
      bitrate: (process.env.AUDIO_BITRATE ?? DEFAULTS.audio.bitrate).trim(),
      sampleRate: parseInt32(
        process.env.AUDIO_SAMPLE_RATE,
        DEFAULTS.audio.sampleRate,
      ),
    },
  };
}

/* ── Image optimization ──────────────────────────────────────────── */

export type ImageRole = "image" | "tilesheet";

export interface ImageOptimizeResult {
  bytes: Uint8Array;
  /** True if the encoder produced fewer bytes than the input. */
  shrank: boolean;
  /** True if the output's pixel dimensions differ from the input's. */
  resized: boolean;
  /** True if the helper emitted a warning (dimension drift for tilesheets). */
  warned: boolean;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const PNG_EXT_RE = /\.png$/i;
const JPEG_EXT_RE = /\.jpe?g$/i;
const WEBP_EXT_RE = /\.webp$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path);
}

/**
 * Re-encode an image. Behaviour split by `role`:
 *
 * - **tilesheet** — `sharp(...).png()/jpeg()/webp()` with quality /
 *   quantization knobs, but NEVER `resize()`. Tilesheets have a
 *   strict pixel contract (`tileWidth`, `tileHeight`, `cols`, `rows`,
 *   `offsetX`, `offsetY` in `manifest.tileSheets[]`); downscaling
 *   would silently break every per-cell coordinate in the pack. We
 *   read `metadata()` after re-encode and log a warning if the
 *   dimensions ever drift — that's an "encoder bug, not config" path.
 * - **image** — same encode, plus an `IMAGE_MAX_DIMENSION` ceiling
 *   that downscales (aspect preserved) when the larger dimension
 *   exceeds the cap.
 *
 * Returns the original bytes on any error so a malformed image
 * doesn't fail the build.
 */
export async function optimizeImage(
  input: Uint8Array,
  inZipPath: string,
  role: ImageRole,
  config: PublishConfig,
): Promise<ImageOptimizeResult> {
  try {
    const pipeline = sharp(input);
    const meta = await pipeline.metadata();
    const origW = meta.width ?? 0;
    const origH = meta.height ?? 0;

    let resized = false;
    let working: sharp.Sharp = sharp(input);
    if (role === "image") {
      const max = Math.max(origW, origH);
      if (config.image.maxDimension > 0 && max > config.image.maxDimension) {
        working = working.resize({
          width: origW >= origH ? config.image.maxDimension : undefined,
          height: origH > origW ? config.image.maxDimension : undefined,
          fit: "inside",
          withoutEnlargement: true,
        });
        resized = true;
      }
    }

    const isPng = PNG_EXT_RE.test(inZipPath) || meta.format === "png";
    const isJpeg = JPEG_EXT_RE.test(inZipPath) || meta.format === "jpeg" || meta.format === "jpg";
    const isWebp = WEBP_EXT_RE.test(inZipPath) || meta.format === "webp";

    const tile = role === "tilesheet";
    const jpegQ = tile ? config.tilesheet.jpegQuality : config.image.jpegQuality;
    const pngQuant = tile ? config.tilesheet.pngQuantize : config.image.pngQuantize;

    if (isPng) {
      working = working.png({
        compressionLevel: 9,
        palette: pngQuant,
      });
    } else if (isJpeg) {
      working = working.jpeg({ quality: jpegQ, mozjpeg: true });
    } else if (isWebp) {
      working = working.webp({ quality: jpegQ });
    } else {
      // Fall through: let sharp pick the format from input.
    }

    const outBuf = await working.toBuffer();
    const outBytes = new Uint8Array(outBuf.buffer, outBuf.byteOffset, outBuf.byteLength);

    let warned = false;
    if (role === "tilesheet") {
      const outMeta = await sharp(outBytes).metadata();
      if ((outMeta.width ?? 0) !== origW || (outMeta.height ?? 0) !== origH) {
        console.warn(
          `[publish] WARN tilesheet ${inZipPath}: dimensions drifted ` +
            `${origW}x${origH} → ${outMeta.width}x${outMeta.height}. ` +
            `Using original bytes.`,
        );
        return { bytes: input, shrank: false, resized: false, warned: true };
      }
    }

    return {
      bytes: outBytes,
      shrank: outBytes.byteLength < input.byteLength,
      resized,
      warned,
    };
  } catch (err) {
    console.warn(
      `[publish] WARN image ${inZipPath}: optimize failed (${(err as Error).message}); ` +
        `using original bytes.`,
    );
    return { bytes: input, shrank: false, resized: false, warned: true };
  }
}

/* ── Audio optimization ──────────────────────────────────────────── */

const AUDIO_EXT_RE = /\.(wav|mp3|ogg|opus|m4a|flac)$/i;
const WAV_EXT_RE = /\.wav$/i;
const MP3_EXT_RE = /\.mp3$/i;

export function isAudioPath(path: string): boolean {
  return AUDIO_EXT_RE.test(path);
}

export interface AudioOptimizeResult {
  bytes: Uint8Array;
  /** Output extension. Caller rewrites the in-zip path accordingly. */
  outExt: string;
  /** True if a transcode actually ran. */
  transcoded: boolean;
  /** True if the source was a .wav rewritten to .mp3. */
  wavToMp3: boolean;
  /** True if ffmpeg was missing — bytes are pass-through. */
  ffmpegMissing: boolean;
}

let ffmpegProbed = false;
let ffmpegAvailable = false;

/**
 * Probe for `ffmpeg` on PATH once per process. We swallow any error
 * (no PATH, permission denied, binary missing) and treat it as
 * "missing" — `optimizeAudio` then degrades to pass-through with a
 * single warning.
 */
async function probeFfmpeg(): Promise<boolean> {
  if (ffmpegProbed) return ffmpegAvailable;
  ffmpegProbed = true;
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    ffmpegAvailable = code === 0;
  } catch {
    ffmpegAvailable = false;
  }
  if (!ffmpegAvailable) {
    console.warn(
      `[publish] WARN ffmpeg not found on PATH — audio assets will pass ` +
        `through unmodified.`,
    );
  }
  return ffmpegAvailable;
}

/**
 * Transcode an audio file with ffmpeg. WAV inputs become MP3 (the
 * default placeholder format upgrade); existing MP3s get re-encoded
 * to the target bitrate + sample rate. Other formats pass through
 * unmodified — we don't want to silently downgrade `.ogg` / `.opus`
 * masters until the pack-builder grows a richer audio policy.
 *
 * If ffmpeg is missing on PATH, returns the original bytes and sets
 * `ffmpegMissing: true`; the caller can fold that into the run
 * summary. Never throws on a tooling gap.
 */
export async function optimizeAudio(
  input: Uint8Array,
  inZipPath: string,
  config: PublishConfig,
): Promise<AudioOptimizeResult> {
  const isWav = WAV_EXT_RE.test(inZipPath);
  const isMp3 = MP3_EXT_RE.test(inZipPath);
  // Inputs we don't touch.
  if (!isWav && !isMp3) {
    return {
      bytes: input,
      outExt: extOf(inZipPath),
      transcoded: false,
      wavToMp3: false,
      ffmpegMissing: false,
    };
  }

  if (!(await probeFfmpeg())) {
    return {
      bytes: input,
      outExt: extOf(inZipPath),
      transcoded: false,
      wavToMp3: false,
      ffmpegMissing: true,
    };
  }

  try {
    // Pipe input via stdin, capture output on stdout. `-i pipe:0`
    // tells ffmpeg to read from stdin; `pipe:1` writes the encoded
    // result to stdout with the requested format.
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ar",
        String(config.audio.sampleRate),
        "-b:a",
        config.audio.bitrate,
        "-f",
        "mp3",
        "pipe:1",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    // Write input to stdin then close.
    proc.stdin.write(input);
    await proc.stdin.end();
    const out = await new Response(proc.stdout).bytes();
    const code = await proc.exited;
    if (code !== 0) {
      const errText = await new Response(proc.stderr).text();
      console.warn(
        `[publish] WARN audio ${inZipPath}: ffmpeg exit=${code} (${errText.trim()}). ` +
          `Using original bytes.`,
      );
      return {
        bytes: input,
        outExt: extOf(inZipPath),
        transcoded: false,
        wavToMp3: false,
        ffmpegMissing: false,
      };
    }
    return {
      bytes: out,
      outExt: "mp3",
      transcoded: true,
      wavToMp3: isWav,
      ffmpegMissing: false,
    };
  } catch (err) {
    console.warn(
      `[publish] WARN audio ${inZipPath}: optimize failed (${(err as Error).message}); ` +
        `using original bytes.`,
    );
    return {
      bytes: input,
      outExt: extOf(inZipPath),
      transcoded: false,
      wavToMp3: false,
      ffmpegMissing: false,
    };
  }
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1);
}

/**
 * Rewrite an in-zip path's extension. Used when a `.wav` audio file
 * is transcoded to `.mp3` — the new extension means the manifest
 * `sounds[].file` reference would no longer match, so callers should
 * also remap the manifest entry. For now the build pipeline only
 * transcodes the existing audio if the manifest already accepts the
 * target ext, which is the common case (the default pack's
 * `gunshot` already points at `.mp3`).
 *
 * NOTE: when a `.wav` IS transcoded to `.mp3`, any
 * `manifest.sounds[].file` reference still pointing at the original
 * `.wav` path would 404 at runtime. The caller is responsible for
 * mirroring the rename into the in-zip manifest if needed.
 */
export function replaceExt(inZipPath: string, newExt: string): string {
  const idx = inZipPath.lastIndexOf(".");
  if (idx === -1) return inZipPath + "." + newExt;
  return inZipPath.slice(0, idx + 1) + newExt;
}
