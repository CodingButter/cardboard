/**
 * Image Lab — runtime engine types.
 *
 * Procedural image recipes are tiny JSON node-graphs (~200 B – 2 KB)
 * that compile to a single WebGL fragment-shader program at pack-load
 * time. The shader renders into an offscreen render target; the
 * resulting RGBA bytes upload into the engine's sprite atlas like any
 * other texture. See `docs/plans/IMAGE_LAB.md` §§3, 4, 6 for the
 * canonical spec.
 *
 * IL2 scope: static recipes only — no `$keyframes` evaluation, no
 * spritesheet packing. Animated recipes are recognised by the
 * `animation` block but baked as their first frame only (animation
 * proper is IL4).
 */

/**
 * A single node in a recipe graph.
 *
 * `op` names an entry in the op registry (`./Ops/index.ts`).
 * `params` are the op's static parameters (colors, scales, modes).
 * `inputs` is a map of input-port name → upstream node id. The
 * canonical primary input is named `"input"`; multi-input ops use
 * `"base"`, `"top"`, `"mask"`, etc. depending on the op.
 */
export interface NodeJson {
  /** Stable id, unique within the recipe. */
  id: string;
  /** Op id — matches `OpDescriptor.id`. */
  op: string;
  /** Op-defined scalar / vec / enum params. */
  params?: Record<string, unknown>;
  /**
   * Input-port name → upstream node id. Most ops have one input
   * named `"input"` or `"base"`; compositors use `"top"` / `"bottom"`
   * / `"mask"`. See each op's `inputs` array for the accepted names.
   */
  inputs?: Record<string, string>;
}

/**
 * The full recipe document — what `recipes/<id>.recipe.json` contains.
 *
 * The user-prompt schema (array of nodes, terminal node has
 * `op: "output"`) is the canonical IL2 wire-format. IMAGE_LAB.md §3.1
 * uses an equivalent `{graph: {output, nodes: Record<id, ...>}}`
 * shape; the compiler accepts the array form and locates the sink by
 * scanning for `op === "output"`.
 */
export interface RecipeJson {
  /** Slug — matches the pack-relative filename + manifest key. */
  id: string;
  /** Output texture dimensions. Power-of-two preferred. */
  size: { width: number; height: number };
  /** Default seed for noise ops. May be overridden per-bake. */
  seed?: number;
  /** Recipe nodes. Exactly one must have `op === "output"`. */
  nodes: NodeJson[];
  /** Static (`undefined`) or animated (`{frames, duration}`). IL2 bakes frame 0 only. */
  animation?: {
    /** Number of baked frames in the output spritesheet. */
    frames: number;
    /** Seconds per loop. */
    duration: number;
  };
}

/**
 * Type tag for an op's input / output port. RGBA flows as vec4
 * texels; scalar / greyscale signals are also packed as vec4 (with
 * the meaningful channel in `.r`), kept tag-distinct so the editor
 * can render type-mismatched wires red without coercing at the GLSL
 * level. The runtime compiler treats every port as a `vec4` chunk —
 * coercion happens inside the consuming op's GLSL chunk where
 * needed.
 */
export type PortKind = "rgba" | "greyscale" | "scalar" | "mask";

/**
 * An op's descriptor — a static record loaded from `./Ops/<name>.ts`.
 *
 * The compiler asks each op for its GLSL chunk via `emit()`. Each
 * chunk is a function body that consumes the input samplers / scalar
 * uniforms named by `inputs[]` and returns a `vec4` for the current
 * fragment's `v_uv`. The compiler stitches every chunk into one
 * fragment-shader program by emitting one helper function per node
 * (named `node_<id>`) and walking the graph in topological order
 * from `output` upward.
 */
export interface OpDescriptor {
  /** Op id — what `NodeJson.op` references. */
  readonly id: string;
  /**
   * Accepted input ports. The compiler resolves each entry against
   * `NodeJson.inputs[name]`; missing-but-required inputs default to
   * a transparent black `vec4(0)` chunk.
   */
  readonly inputs: ReadonlyArray<{
    readonly name: string;
    readonly kind: PortKind;
    readonly required?: boolean;
  }>;
  /** Output port kind. IL2 ops all expose a single output. */
  readonly output: PortKind;
  /**
   * Emit the op's GLSL function body. The compiler injects the
   * surrounding declaration (`vec4 node_<id>(vec2 uv) { ... }`) and
   * calls upstream node functions for each input. The op returns
   * GLSL text that references:
   *
   *  - `uv` — the fragment's UV in `[0, 1]²`.
   *  - `<inputName>` — the `vec4` value returned by the upstream
   *    node's helper (already a local).
   *  - `u_recipeSeed` / `u_instanceSeed` / `u_time` — runtime
   *    uniforms.
   *  - `u_resolution` — the recipe's `size` as a vec2.
   *
   * Return only the body text — no `vec4 node_X(...)` declaration,
   * no closing brace.
   */
  emit(ctx: OpEmitContext): string;
}

/**
 * Context handed to each op's `emit()` call.
 *
 * `inputs` maps the op's declared input-port names to the local
 * variable name the compiler emitted for that input's value
 * (already a `vec4`). Op code references the local variable
 * directly:
 *
 *     // a `blend` op chunk:
 *     return mix(${ctx.inputs.bottom}, ${ctx.inputs.top},
 *                ${ctx.inputs.top}.a);
 *
 * `params` is the node's static params with type-coerced helpers.
 * The compiler folds them inline as GLSL constants — there are no
 * per-recipe uniforms for params today (every recipe compiles to a
 * specialised program). Changes to params trigger recompile +
 * re-bake; the IDB cache absorbs the cost.
 */
export interface OpEmitContext {
  /** The node's id (used to disambiguate GLSL identifiers if needed). */
  readonly nodeId: string;
  /** Resolved input-port name → upstream local-variable name (a `vec4`). */
  readonly inputs: Record<string, string>;
  /** Node params, typed-and-defaulted. */
  readonly params: Record<string, unknown>;
  /** Recipe-level seed (compile-time constant). */
  readonly recipeSeed: number;
}

/**
 * A baked recipe — what `api.procedural.load(id)` returns once the
 * shader has rendered into a texture. Carries the raw bytes so the
 * caller can re-upload, hash for cache lookups, or persist via the
 * IDB sidecar.
 */
export interface BakedRecipe {
  /** Recipe id. */
  readonly id: string;
  /** Texture dimensions. */
  readonly width: number;
  /** Texture dimensions. */
  readonly height: number;
  /** RGBA8 pixel bytes, row-major, top-down. */
  readonly pixels: Uint8Array;
  /** WebGL texture handle uploaded from the bytes. */
  readonly texture: WebGLTexture;
  /** Stable hash of the recipe + seed (used as IDB cache key). */
  readonly hash: string;
}

/**
 * A baked animated recipe — IL4 will produce a real spritesheet. IL2
 * surfaces the frame-0 bake under this shape for API stability so
 * call sites that opt into `loadAnimated` already get the right
 * structure.
 */
export interface Spritesheet {
  /** Recipe id. */
  readonly id: string;
  /** Per-frame dimensions. */
  readonly frameWidth: number;
  /** Per-frame dimensions. */
  readonly frameHeight: number;
  /** Columns in the packed spritesheet. */
  readonly cols: number;
  /** Rows in the packed spritesheet. */
  readonly rows: number;
  /** Number of valid frames. */
  readonly frameCount: number;
  /** Loop duration in seconds. */
  readonly duration: number;
  /** Full spritesheet RGBA bytes. */
  readonly pixels: Uint8Array;
  /** WebGL texture handle uploaded from the bytes. */
  readonly texture: WebGLTexture;
  /** Stable hash. */
  readonly hash: string;
}

/**
 * Manifest entry — `manifest.recipes[<id>]` points at a recipe JSON
 * file inside the pack. Kept minimal in IL2; future fields (rebake
 * triggers, per-instance variation flags) bolt on additively.
 */
export interface RecipeDef {
  /** Path inside the pack to the `.recipe.json`. */
  file: string;
}
