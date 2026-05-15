/**
 * Immutable 2D vector. Every operation returns a new instance, never mutates
 * the receiver — makes it safe to share `position`/`direction` style fields
 * between systems without aliasing bugs.
 */
export class Vec2 {
  readonly x: number;
  readonly y: number;

  /**
   * Construct a vector. Passing a single argument creates a uniform vector
   * (`new Vec2(3)` → `(3, 3)`), which is convenient for scales and squares.
   */
  constructor(x: number, y?: number) {
    this.x = x;
    this.y = y ?? x;
  }

  /** Component-wise addition. */
  add(that: Vec2): Vec2 {
    return new Vec2(this.x + that.x, this.y + that.y);
  }

  /** Component-wise subtraction (`this - that`). */
  sub(that: Vec2): Vec2 {
    return new Vec2(this.x - that.x, this.y - that.y);
  }

  /** Component-wise multiplication. */
  mul(that: Vec2): Vec2 {
    return new Vec2(this.x * that.x, this.y * that.y);
  }

  /** Component-wise division. */
  div(that: Vec2): Vec2 {
    return new Vec2(this.x / that.x, this.y / that.y);
  }

  /** Multiply both components by a scalar. */
  scale(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
  }

  /** Negate both components (equivalent to `scale(-1)`). */
  neg(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  /** Euclidean length. */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /** Squared length. Use this when comparing distances — avoids the sqrt. */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Unit-length vector, or zero if the input is zero (no NaN). */
  normalize(): Vec2 {
    const len = this.length();
    if (len === 0) return new Vec2(0, 0);
    return new Vec2(this.x / len, this.y / len);
  }

  /** Dot product. */
  dot(that: Vec2): number {
    return this.x * that.x + this.y * that.y;
  }

  /**
   * Z-component of the 3D cross product. Sign tells you whether `that` is on
   * the left (+) or right (-) of `this`.
   */
  cross(that: Vec2): number {
    return this.x * that.y - this.y * that.x;
  }

  /** Perpendicular (90° counter-clockwise) vector. */
  perp(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  /** Rotate around the origin by `radians`. */
  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  /** Linear interpolation between `this` and `that` at parameter `t ∈ [0, 1]`. */
  lerp(that: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (that.x - this.x) * t, this.y + (that.y - this.y) * t);
  }

  /** Euclidean distance to `that`. */
  distanceTo(that: Vec2): number {
    return this.sub(that).length();
  }

  /** Squared distance to `that`. Cheap to compare against squared radii. */
  distanceToSquared(that: Vec2): number {
    return this.sub(that).lengthSquared();
  }

  /** Exact equality (use sparingly — floats). */
  equals(that: Vec2): boolean {
    return this.x === that.x && this.y === that.y;
  }

  /** Tuple form, handy for spreading into Canvas APIs: `ctx.moveTo(...v.array())`. */
  array(): [number, number] {
    return [this.x, this.y];
  }

  /** Shallow copy (rarely needed since instances are immutable, but kept for ergonomics). */
  copy(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  /** The zero vector. */
  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  /** Construct a vector from a tuple. */
  static fromArray(arr: [number, number]): Vec2 {
    return new Vec2(arr[0], arr[1]);
  }

  /** Unit vector pointing at the given angle in radians (CCW from +x). */
  static fromAngle(radians: number): Vec2 {
    return new Vec2(Math.cos(radians), Math.sin(radians));
  }
}
