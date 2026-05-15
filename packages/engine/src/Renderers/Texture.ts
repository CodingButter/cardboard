import { Vec2 } from "Libs/Vector";
import type { IPixel } from "Libs/Geometry";

/**
 * Decoded image pixels in software-renderable form.
 *
 * A `Texture` is a flat `Uint8ClampedArray` of RGBA bytes plus dimensions —
 * the same shape an `ImageData` has, but owned by us so we can read it
 * cheaply. The browser's `HTMLImageElement` is opaque to JS at the pixel
 * level; we decode it once (via `OffscreenCanvas.getImageData`) and keep
 * the bytes around for fast sampling.
 *
 * Construct asynchronously with `Texture.load(url)` or synchronously from an
 * already-loaded `HTMLImageElement` with `Texture.fromImage(img)`.
 */
export class Texture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, data: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  /** Texture dimensions as a `Vec2`. */
  get size(): Vec2 {
    return new Vec2(this.width, this.height);
  }

  /**
   * Read one pixel. Coordinates are clamped to the texture bounds, so it's
   * safe to sample with rounding error around the edges.
   */
  sample(x: number, y: number): IPixel {
    const ix = x < 0 ? 0 : x >= this.width ? this.width - 1 : x | 0;
    const iy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y | 0;
    const i = (iy * this.width + ix) * 4;
    return {
      r: this.data[i]!,
      g: this.data[i + 1]!,
      b: this.data[i + 2]!,
      a: this.data[i + 3]!,
    };
  }

  /** Byte offset of pixel `(x, y)` in `data`. Lets inner loops skip a `* 4`. */
  byteIndex(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  /**
   * Copy a sub-rectangle into a new standalone `Texture`. Useful for
   * slicing tiles out of a sprite sheet at load time so each tile becomes
   * a regular `Texture` the renderer samples normally.
   *
   * Coordinates are clamped to the source texture bounds.
   */
  crop(srcX: number, srcY: number, w: number, h: number): Texture {
    const data = new Uint8ClampedArray(w * h * 4);
    const srcStride = this.width * 4;
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const srcOffset = (srcY + y) * srcStride + srcX * 4;
      const dstOffset = y * rowBytes;
      data.set(this.data.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }
    return new Texture(w, h, data);
  }

  /**
   * Load an image URL and decode it into a `Texture`. Resolves once the
   * pixel data is available; rejects on a network or decode error.
   */
  static async load(url: string): Promise<Texture> {
    const image = new Image();
    image.src = url;
    await image.decode();
    return Texture.fromImage(image);
  }

  /**
   * Load a texture via an `AssetPack`-style accessor. The pack hands back
   * a `Blob`; we wrap it in an object URL just long enough to decode,
   * then revoke. Used by the renderers so tile assets flow through
   * whatever pack is currently loaded.
   */
  static async loadFromBlob(blob: Blob): Promise<Texture> {
    const url = URL.createObjectURL(blob);
    try {
      return await Texture.load(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Decode an already-loaded `HTMLImageElement` into a `Texture`. The image
   * must have finished loading (`naturalWidth > 0`).
   */
  static fromImage(image: HTMLImageElement): Texture {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get OffscreenCanvas 2D context");
    ctx.drawImage(image, 0, 0);
    return new Texture(width, height, ctx.getImageData(0, 0, width, height).data);
  }
}
