/**
 * Plain-data geometry primitives shared between renderers and helpers.
 *
 * These intentionally use POJO shapes (not `Vec2`) so they interop cleanly with
 * the canvas/ImageData APIs that work in raw numbers.
 */

/** A point in 2D pixel/world space. */
export interface IPoint {
  x: number;
  y: number;
}

/** Width/height in pixels. */
export interface ISize {
  width: number;
  height: number;
}

/** Axis-aligned rectangle: top-left corner plus size. */
export interface IRect extends IPoint, ISize {}

/** Straight-RGBA pixel with channels in `[0, 255]`. */
export interface IPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Line segment between two points, optionally thickened. */
export interface ILine {
  start: IPoint;
  end: IPoint;
  /** Stroke width in pixels (defaults to 1). */
  width?: number;
}

/** Options accepted by text-drawing helpers. */
export interface ITextOptions {
  /** CSS-style font shorthand, e.g. `"16px Arial"`. */
  font?: string;
}

/** Construct a pixel literal. `a` defaults to fully opaque. */
export function createPixel(r: number, g: number, b: number, a: number = 255): IPixel {
  return { r, g, b, a };
}

/**
 * Parse a 3- or 6-digit hex color (`#rgb` or `#rrggbb`) into an `IPixel`.
 * Throws if the format is unrecognized.
 */
export function parseHexColor(color: string): IPixel {
  if (!color.startsWith("#")) {
    throw new Error(`Unsupported color format: ${color}`);
  }

  const hex = color.slice(1);

  if (hex.length === 3) {
    const r = hex.charAt(0);
    const g = hex.charAt(1);
    const b = hex.charAt(2);
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
      a: 255,
    };
  }

  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255,
    };
  }

  throw new Error(`Invalid hex color: ${color}`);
}

/** Convert an `IPixel` to a CSS `rgba(...)` string suitable for ctx.fillStyle. */
export function pixelToCss(pixel: IPixel): string {
  return `rgba(${pixel.r}, ${pixel.g}, ${pixel.b}, ${pixel.a / 255})`;
}
