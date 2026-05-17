/**
 * Post-process pass chain manager (Mode 2 / Phase S4 of
 * `docs/plans/ENGINE_PACK_SHADERS.md`).
 *
 * Manifest declares `shaders.postPasses: [{ name, frag }, ...]`. The
 * engine compiles each fragment shader against the auto-injected
 * post-pass header (§5.5), then runs them in array order after the
 * world + sprite passes and before HUD compositing (§4.4).
 *
 * Pipeline:
 *
 *   [world + sprites] → FBO ping
 *                       ↓
 *                     [pass 0] → FBO pong
 *                       ↓
 *                     [pass 1] → FBO ping
 *                       ↓
 *                       …
 *                       ↓
 *                     [pass N-1] → default framebuffer (screen)
 *
 * Two FBOs (ping + pong) are allocated at canvas resolution, RGBA8.
 * Even-indexed reads are from `ping`, writes to `pong`; odd-indexed
 * the other way. The renderer asks the chain which FBO to bind for the
 * world + sprite pass (always `ping`) when at least one pass is active;
 * when the chain is empty the renderer binds the default framebuffer
 * directly — byte-identical to pre-S4 rendering.
 *
 * Lifecycle:
 *
 *  - `create(gl, pack, width, height)` — async; reads + compiles every
 *    pass via `pack.textBody(frag)`. Returns `null` when the manifest
 *    has no `postPasses`. Logs + skips passes whose name collides or
 *    whose body fails to compile (one pass dropping doesn't fail the
 *    chain — the others still run; the renderer logs once per error).
 *
 *  - `bindSource(time, frameCount)` — call BEFORE `drawWorld` /
 *    `drawSprites`. Binds the first FBO so the world + sprite passes
 *    write into the chain's source buffer. No-ops when the chain is
 *    empty (caller falls through to default framebuffer).
 *
 *  - `apply(time, frameCount)` — call AFTER `drawSprites`, BEFORE HUD.
 *    Walks every pass; the final pass writes to the default
 *    framebuffer. No-ops when the chain is empty.
 *
 *  - `resize(w, h)` — re-allocates ping + pong color attachments. The
 *    `WebGLRenderer.resize` hook calls this.
 *
 *  - `dispose()` — frees programs + FBOs + textures. Currently
 *    unused; the renderer lives for the whole session and shaders
 *    can't be hot-swapped at runtime today.
 *
 * Canvas2D backend has no PostPassChain — see §2 of the plan doc.
 */

import type { AssetPack, PostPassDef } from "AssetPack";
import { headerForPostPass } from "./shaderHeaders";
import { cascadePostPasses } from "./ShaderChainCascade";

/**
 * Vertex shader for every post-pass — a pass-through fullscreen quad.
 * The fragment shader does all the work. Output `v_uv` matches the
 * post-pass header's `in vec2 v_uv;` contract.
 */
const POST_PASS_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}
`;

/**
 * One compiled pass — a program + the uniform locations the chain
 * writes per frame.
 *
 * `name` is the manifest-supplied label (used for diagnostic logs and
 * future conflict reporting per §10.4).
 */
interface CompiledPass {
  name: string;
  program: WebGLProgram;
  uColor: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uFrame: WebGLUniformLocation | null;
}

/**
 * One ping-pong slot — an FBO + its color attachment. Color attachment
 * uses RGBA8 (matches the default framebuffer's format). RGBA16F would
 * be needed for HDR tonemapping, but the world + sprite passes both
 * output LDR today, so RGBA8 keeps memory + bandwidth low.
 */
interface FboSlot {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class PostPassChain {
  private readonly gl: WebGL2RenderingContext;
  private readonly passes: CompiledPass[];
  private readonly quadVAO: WebGLVertexArrayObject;
  private ping: FboSlot;
  private pong: FboSlot;
  private width: number;
  private height: number;

  /**
   * Build a chain from a pack manifest. Returns `null` when:
   *   - The manifest has no `shaders.postPasses` field.
   *   - The field is an empty array.
   *   - Every pass failed to compile (the chain has zero passes left).
   *
   * Caller treats `null` as "no chain" — render straight to the
   * default framebuffer, byte-identical to pre-S4.
   *
   * The first pass with a duplicate `name` within the manifest is
   * skipped with a warning; conflict reporting across packs lives in
   * S6 (§10.4), not here.
   */
  static async create(
    gl: WebGL2RenderingContext,
    pack: AssetPack,
    width: number,
    height: number,
  ): Promise<PostPassChain | null> {
    const defs = pack.manifest.shaders?.postPasses;
    if (!defs || defs.length === 0) return null;

    const seenNames = new Set<string>();
    const compiled: CompiledPass[] = [];
    for (const def of defs) {
      if (seenNames.has(def.name)) {
        console.warn(
          `[two_5_d] post-pass name '${def.name}' is duplicated within pack '${pack.manifest.name}'. Skipping the duplicate.`,
        );
        continue;
      }
      seenNames.add(def.name);
      const pass = await PostPassChain.compilePass(gl, pack, def);
      if (pass) compiled.push(pass);
    }
    if (compiled.length === 0) {
      console.warn(
        `[two_5_d] pack '${pack.manifest.name}' declares postPasses but none compiled — falling back to direct rendering.`,
      );
      return null;
    }
    return new PostPassChain(gl, compiled, width, height);
  }

  /**
   * Chain-aware variant — M4 of `docs/plans/MATERIALS.md` §10 (cross-
   * ref ENGINE_PACK_SHADERS.md §10.3). Concatenates every pack's
   * `shaders.postPasses` in chain order (deps-first → root-last);
   * cross-pack name collisions log a soft warning but BOTH passes
   * run — two CRT passes is a valid stylistic choice.
   *
   * Length-1 chains delegate to `create(pack, …)` to keep pre-M4
   * diagnostics byte-identical for single-pack flows.
   */
  static async createFromChain(
    gl: WebGL2RenderingContext,
    chain: ReadonlyArray<AssetPack>,
    width: number,
    height: number,
  ): Promise<PostPassChain | null> {
    if (chain.length === 0) return null;
    if (chain.length === 1) return PostPassChain.create(gl, chain[0]!, width, height);

    const cascaded = cascadePostPasses(chain);
    if (cascaded.length === 0) return null;

    const compiled: CompiledPass[] = [];
    for (const entry of cascaded) {
      const pass = await PostPassChain.compilePass(gl, entry.pack, entry.def);
      if (pass) compiled.push(pass);
    }
    if (compiled.length === 0) {
      console.warn(
        `[two_5_d] pack-chain declares postPasses across ${cascaded.length} entries but none compiled — falling back to direct rendering.`,
      );
      return null;
    }
    return new PostPassChain(gl, compiled, width, height);
  }

  private constructor(
    gl: WebGL2RenderingContext,
    passes: CompiledPass[],
    width: number,
    height: number,
  ) {
    this.gl = gl;
    this.passes = passes;
    this.width = width;
    this.height = height;

    // Fullscreen quad VAO — same shape as `WebGLRenderer`'s. We can't
    // share the renderer's VAO because the post-pass programs may
    // bind their own attribute-0 location. Each pass uses the same
    // VAO, so we allocate one here and reuse it.
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("PostPassChain: failed to create quad VAO");
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error("PostPassChain: failed to create quad VBO");
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadVAO = vao;

    this.ping = PostPassChain.makeFboSlot(gl, width, height);
    this.pong = PostPassChain.makeFboSlot(gl, width, height);
  }

  /**
   * Number of compiled passes in the chain. The renderer uses this
   * only for diagnostics; the public `bindSource` / `apply` are
   * no-ops on an empty chain (which `create` returns as `null`, so
   * this is always ≥ 1 when a chain object exists).
   */
  get passCount(): number {
    return this.passes.length;
  }

  /**
   * Bind the chain's input FBO. Call BEFORE `drawSky` / `drawWorld`
   * / `drawSprites` so all three write into the chain's first
   * color attachment. The renderer should run its existing
   * `gl.viewport(0, 0, w, h)` after this — viewport is preserved
   * by the framebuffer binding switch, but we re-set it defensively
   * in case the caller resized while a different FBO was bound.
   */
  bindSource(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ping.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /**
   * Run every pass. Source-of-truth ping/pong index alternates each
   * pass: pass 0 reads `ping`, writes `pong`; pass 1 reads `pong`,
   * writes `ping`; … the LAST pass writes to the DEFAULT
   * framebuffer (= the on-screen canvas).
   *
   * `time` is seconds since renderer start; `frameCount` is a
   * monotonic frame counter. The renderer tracks them and supplies
   * them per call so `apply` stays stateless.
   */
  apply(time: number, frameCount: number): void {
    const gl = this.gl;
    let read = this.ping;
    let write = this.pong;
    for (let i = 0; i < this.passes.length; i++) {
      const isLast = i === this.passes.length - 1;
      const pass = this.passes[i]!;
      if (isLast) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      }
      gl.viewport(0, 0, this.width, this.height);
      // No depth, no blend — every pass overwrites the full screen.
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(pass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      if (pass.uColor) gl.uniform1i(pass.uColor, 0);
      if (pass.uResolution) gl.uniform2f(pass.uResolution, this.width, this.height);
      if (pass.uTime) gl.uniform1f(pass.uTime, time);
      if (pass.uFrame) gl.uniform1f(pass.uFrame, frameCount);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      // Swap for the next iteration. The last pass already wrote to
      // the screen, so the swap is harmless (we don't read it again).
      const tmp = read;
      read = write;
      write = tmp;
    }
    // Belt-and-braces: leave the default framebuffer bound so any
    // subsequent canvas operation (HUD canvas composite) lands on
    // screen. `apply()` already ended with the screen bound on the
    // final pass; this is just defensive.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Re-allocate ping + pong color attachments to a new size. Called
   * from `WebGLRenderer.resize`.
   */
  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    // Re-allocate color attachments in place — the FBOs still point
    // at the same texture objects, so we don't need to re-attach.
    for (const slot of [this.ping, this.pong]) {
      gl.bindTexture(gl.TEXTURE_2D, slot.tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
  }

  /* --- Internal helpers ----------------------------------------------- */

  private static async compilePass(
    gl: WebGL2RenderingContext,
    pack: AssetPack,
    def: PostPassDef,
  ): Promise<CompiledPass | null> {
    let body = "";
    try {
      body = await pack.textBody(def.frag);
    } catch (err) {
      console.warn(
        `[two_5_d] post-pass '${def.name}' (${def.frag}) failed to load — skipped. ${(err as Error).message}`,
      );
      return null;
    }
    const source = headerForPostPass() + body;
    const program = PostPassChain.buildProgram(gl, POST_PASS_VERT, source, def.name);
    if (!program) return null;
    return {
      name: def.name,
      program,
      uColor: gl.getUniformLocation(program, "u_color"),
      uResolution: gl.getUniformLocation(program, "u_resolution"),
      uTime: gl.getUniformLocation(program, "u_time"),
      uFrame: gl.getUniformLocation(program, "u_frame"),
    };
  }

  /**
   * Build + link a single pass program. Returns `null` and logs on
   * any compile / link failure — the chain skips the bad pass and
   * continues. We don't share `buildProgram` from `WebGLRenderer.ts`
   * because that helper hard-throws; for post-passes we'd rather
   * drop the offending pass than refuse to render.
   */
  private static buildProgram(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
    name: string,
  ): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
      if (!ok) {
        const log = gl.getShaderInfoLog(sh) ?? "(no info log)";
        console.warn(
          `[two_5_d] post-pass '${name}' ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} compile failed:\n${log}`,
        );
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    if (!vs) return null;
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!fs) {
      gl.deleteShader(vs);
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // Lock attribute-0 to a_position so the same VAO works for every
    // pass program. (Otherwise GLSL might bind a_position to a
    // different attrib index per program.)
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!ok) {
      const log = gl.getProgramInfoLog(program) ?? "(no info log)";
      console.warn(`[two_5_d] post-pass '${name}' link failed:\n${log}`);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    // Detach + delete shaders — the program holds its own copy.
    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  /**
   * Allocate one FBO + color attachment at the given resolution.
   * Color format = RGBA8 (LDR). No depth attachment — post-passes
   * never need depth testing.
   */
  private static makeFboSlot(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
  ): FboSlot {
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("PostPassChain: failed to create FBO");
    const tex = gl.createTexture();
    if (!tex) throw new Error("PostPassChain: failed to create FBO color attachment");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `PostPassChain: FBO not complete (status 0x${status.toString(16)})`,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }
}
