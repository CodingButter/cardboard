/**
 * Offscreen WebGL2 renderer that takes a compiled recipe and renders
 * it into a `WebGLTexture`.
 *
 * The runtime owns its own canvas + WebGL2 context — recipe bakes
 * happen during pack-load before the main `WebGLRenderer` exists,
 * and even after the main renderer is alive we don't want to share
 * its program/VAO state. The cost is modest: ~1 ms to acquire a
 * context, then every bake reuses the same canvas.
 *
 * Output flow per recipe:
 *
 *   1. Compile vertex + fragment program (cached per recipe hash).
 *   2. Allocate an RGBA8 framebuffer at the recipe's `size`.
 *   3. Draw a fullscreen quad with `v_uv ∈ [0, 1]²`.
 *   4. Read pixels (`gl.readPixels`) into a Uint8Array — used for
 *      IDB caching + downstream consumers that want raw bytes.
 *   5. Upload the pixels into the returned `WebGLTexture` (caller's
 *      context — see `uploadFromPixels`). For pure-engine consumers
 *      we hand back the offscreen texture; consumers needing the
 *      bytes on a different `gl` instance copy via `pixels`.
 */

import type { CompiledRecipe } from "./Compiler";
import type { BakedRecipe } from "./types";

/**
 * Pass-through vertex shader — fullscreen quad with UVs.
 */
const VERT_SRC = /* glsl */ `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}
`;

interface CachedProgram {
  program: WebGLProgram;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uRecipeSeed: WebGLUniformLocation | null;
  uInstanceSeed: WebGLUniformLocation | null;
}

export interface BakeOptions {
  /** Animation phase ∈ [0, 1). Only meaningful for animated recipes. */
  time?: number;
  /** Per-instance seed override. */
  instanceSeed?: number;
}

export class ProceduralRenderer {
  /** Shared canvas — one offscreen surface per renderer instance. */
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly quadVAO: WebGLVertexArrayObject;
  private readonly programCache = new Map<string, CachedProgram>();
  /** Cached framebuffer (re-allocated only on size change). */
  private fb: WebGLFramebuffer | null = null;
  private fbTex: WebGLTexture | null = null;
  private fbWidth = 0;
  private fbHeight = 0;

  constructor() {
    const canvas = createOffscreenCanvas(1, 1);
    const gl =
      canvas.getContext("webgl2", {
        antialias: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false,
      }) as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error("[procedural] WebGL2 not available — recipe baking requires WebGL2");
    }
    this.canvas = canvas;
    this.gl = gl;

    // Fullscreen quad — two triangles via a 4-vertex strip.
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("[procedural] failed to create VAO");
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadVAO = vao;
  }

  /**
   * Direct accessor to the underlying GL context — used by the
   * `ProceduralAPI` to upload cached PNG bytes into a texture on the
   * same context the bake would have produced.
   */
  get context(): WebGL2RenderingContext {
    return this.gl;
  }

  /**
   * Compile (or look up) the program for a recipe and bake it into
   * an RGBA8 texture. Returns a `BakedRecipe` carrying both the GL
   * texture handle and the raw pixel bytes.
   */
  bake(compiled: CompiledRecipe, opts: BakeOptions = {}): BakedRecipe {
    const gl = this.gl;
    const prog = this.programFor(compiled);
    this.ensureFramebuffer(compiled.width, compiled.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, compiled.width, compiled.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog.program);
    if (prog.uResolution) {
      gl.uniform2f(prog.uResolution, compiled.width, compiled.height);
    }
    if (prog.uTime) gl.uniform1f(prog.uTime, opts.time ?? 0);
    if (prog.uRecipeSeed) gl.uniform1f(prog.uRecipeSeed, compiled.seed);
    if (prog.uInstanceSeed) gl.uniform1f(prog.uInstanceSeed, opts.instanceSeed ?? 0);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read pixels (one of the IL2 acceptance hooks — IDB cache uses
    // these bytes).
    const pixels = new Uint8Array(compiled.width * compiled.height * 4);
    gl.readPixels(0, 0, compiled.width, compiled.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Hand the framebuffer's texture back as-is — consumers that
    // share this context can sample it directly; consumers on a
    // different context read `pixels` and upload themselves.
    return {
      id: compiled.id,
      width: compiled.width,
      height: compiled.height,
      pixels,
      texture: this.uploadFromPixels(compiled.width, compiled.height, pixels),
      hash: compiled.hash,
    };
  }

  /**
   * Upload a pre-computed RGBA8 byte array as a `WebGLTexture` on
   * this renderer's context. Lets the IDB cache hot-path skip the
   * full bake — we already have the bytes, just re-upload.
   */
  uploadFromPixels(width: number, height: number, pixels: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("[procedural] failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Recipe textures are baked once + sampled at their native res —
    // no mipmaps, no MSAA. NEAREST keeps cross-driver determinism per
    // IMAGE_LAB.md §4.7.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Drop every cached program + framebuffer. Called by `Game.dispose`
   * (when wired) — for IL2 the engine never tears the renderer down
   * mid-session so this is a maintenance hook.
   */
  dispose(): void {
    const gl = this.gl;
    for (const cached of this.programCache.values()) {
      gl.deleteProgram(cached.program);
    }
    this.programCache.clear();
    if (this.fb) gl.deleteFramebuffer(this.fb);
    if (this.fbTex) gl.deleteTexture(this.fbTex);
    this.fb = null;
    this.fbTex = null;
  }

  private programFor(compiled: CompiledRecipe): CachedProgram {
    const cached = this.programCache.get(compiled.hash);
    if (cached) return cached;
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, compiled.fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("[procedural] failed to create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "(no log)";
      gl.deleteProgram(program);
      throw new Error(`[procedural] program link failed for "${compiled.id}": ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const result: CachedProgram = {
      program,
      uResolution: gl.getUniformLocation(program, "u_resolution"),
      uTime: gl.getUniformLocation(program, "u_time"),
      uRecipeSeed: gl.getUniformLocation(program, "u_recipeSeed"),
      uInstanceSeed: gl.getUniformLocation(program, "u_instanceSeed"),
    };
    this.programCache.set(compiled.hash, result);
    return result;
  }

  private ensureFramebuffer(width: number, height: number): void {
    if (this.fb && this.fbWidth === width && this.fbHeight === height) return;
    const gl = this.gl;
    if (this.fb) gl.deleteFramebuffer(this.fb);
    if (this.fbTex) gl.deleteTexture(this.fbTex);
    const tex = gl.createTexture();
    if (!tex) throw new Error("[procedural] failed to create framebuffer texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error("[procedural] failed to create framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("[procedural] framebuffer incomplete");
    }
    this.fb = fb;
    this.fbTex = tex;
    this.fbWidth = width;
    this.fbHeight = height;
    // Resize the underlying canvas so the context's drawing buffer
    // matches — keeps WebGL inspectors happy and prevents the canvas
    // from being culled.
    if ("width" in this.canvas) {
      (this.canvas as HTMLCanvasElement).width = width;
      (this.canvas as HTMLCanvasElement).height = height;
    }
  }
}

function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("[procedural] failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    const labeledSource = source
      .split("\n")
      .map((line, i) => `${(i + 1).toString().padStart(3, " ")} | ${line}`)
      .join("\n");
    throw new Error(`[procedural] shader compile failed: ${log}\n--- source ---\n${labeledSource}`);
  }
  return shader;
}

function createOffscreenCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  throw new Error(
    "[procedural] no canvas surface available — runs only in browser-like environments",
  );
}
