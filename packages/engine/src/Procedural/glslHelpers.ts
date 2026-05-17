/**
 * Shared GLSL helpers injected into every compiled recipe.
 *
 * Determinism is the engineering contract (IMAGE_LAB.md §4.7): the
 * same recipe + seed must produce byte-identical pixels in every
 * environment. To get there we hand-roll noise + hash functions
 * against the **integer-hash** family rather than the canonical
 * `sin()`-based one — `sin()`'s last-bit varies across drivers.
 *
 * The prelude declares:
 *
 *   - `hash11`, `hash21`, `hash22` — integer-bit-twiddle hash chain.
 *   - `valueNoise2D` — deterministic 2D value noise (smooth gradient,
 *     no `sin`).
 *   - `perlin2D` — Perlin-style noise built on integer hashes.
 *   - `simplex2D` — Ashima/McEwan 2D simplex noise (deterministic on
 *     conformant WebGL2 highp).
 *   - `worley2D` — F1 / F2 cellular noise.
 *   - `luminance` — Rec.709 brightness helper.
 *
 * Every op's emit() consumes these helpers freely; they're prepended
 * once at compile time so there's no per-node copy bloat.
 */

export const GLSL_HELPERS = /* glsl */ `
// ── Numeric helpers ────────────────────────────────────────────────
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float saturate1(float v) { return clamp(v, 0.0, 1.0); }
vec3  saturate3(vec3  v) { return clamp(v, 0.0, 1.0); }
vec4  saturate4(vec4  v) { return clamp(v, 0.0, 1.0); }

// ── Deterministic integer-hash chain (no sin) ─────────────────────
// Based on the "hash without sin" family commonly attributed to
// David Hoskins / Inigo Quilez. Pure float arithmetic on bounded
// inputs is bit-identical across WebGL2 'highp' drivers.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// ── 2D value noise — smooth bilinear interp of hashed cells ───────
float valueNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ── 2D Perlin-style noise — gradient noise via hashed unit vectors ─
float perlin2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic
  // Random unit gradients per corner.
  vec2 g00 = normalize(hash22(i + vec2(0.0, 0.0)) * 2.0 - 1.0);
  vec2 g10 = normalize(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0);
  vec2 g01 = normalize(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0);
  vec2 g11 = normalize(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0);
  float n00 = dot(g00, f - vec2(0.0, 0.0));
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));
  // Map roughly to [0, 1] (perlin range is ~[-sqrt(0.5), sqrt(0.5)]).
  float n = mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
  return n * 0.7071 + 0.5;
}

// ── Fractal Brownian motion sum-of-octaves over perlin2D ──────────
float fbm2D(vec2 p, int octaves, float persistence) {
  float total = 0.0;
  float amplitude = 1.0;
  float maxAmp = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    total += perlin2D(p) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    p *= 2.0;
  }
  return total / max(maxAmp, 0.0001);
}

// ── Simplex 2D (Ashima/McEwan) — deterministic, no sin ────────────
vec3 simplexPermute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float simplex2D(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 perm = simplexPermute(simplexPermute(i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                          dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(perm * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  // simplex range is ~[-1, 1]; remap to [0, 1].
  return 0.5 + 0.5 * 70.0 * dot(m, g);
}

// ── Worley / cellular noise — F1 / F2 distances ───────────────────
vec2 worley2D(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 1.0;
  float f2 = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y));
      vec2 jitter = hash22(ip + off);
      vec2 pos = off + jitter - fp;
      float d = dot(pos, pos);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}

// ── SDF helpers ───────────────────────────────────────────────────
float sdfCircle(vec2 uv, vec2 center, float radius) {
  return length(uv - center) - radius;
}

float sdfRect(vec2 uv, vec2 center, vec2 halfSize) {
  vec2 d = abs(uv - center) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
`;
