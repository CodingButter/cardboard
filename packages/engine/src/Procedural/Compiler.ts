/**
 * Recipe compiler — turns a `RecipeJson` into a WebGL2 fragment-shader
 * source string. The output is a fully self-contained program ready
 * to feed `WebGLRenderingContext.createShader(FRAGMENT_SHADER)`.
 *
 * Algorithm (IMAGE_LAB.md §6.1, §6.2):
 *
 *   1. Validate the recipe: locate the single `output` node, check
 *      every `inputs[*]` reference resolves to a known node, detect
 *      cycles.
 *   2. Topologically sort upstream nodes from the output. Walk the
 *      sorted list emitting one helper function per node (named
 *      `node_<safeId>(vec2 uv)`).
 *   3. Inside `main()`, call the output node and write to `fragColor`.
 *
 * The shared prelude (`glslHelpers.ts`) prepends deterministic
 * hash + noise functions. Each op's `emit()` returns the body of its
 * helper function; the compiler wraps it in the surrounding
 * declaration.
 *
 * Param folding: every node param is inlined as a GLSL literal. No
 * per-recipe uniforms today — when params change, the recipe re-
 * compiles (the IDB cache absorbs the cost).
 */

import type { NodeJson, RecipeJson } from "./types";
import { resolveOp } from "./Ops";
import { GLSL_HELPERS } from "./glslHelpers";

export interface CompiledRecipe {
  /** Recipe id. */
  readonly id: string;
  /** Final fragment-shader source. */
  readonly fragmentSource: string;
  /** Output dimensions echoed from the recipe. */
  readonly width: number;
  readonly height: number;
  /** Hash of the recipe content + seed — used as the IDB cache key. */
  readonly hash: string;
  /** Effective seed (recipe.seed or override). */
  readonly seed: number;
}

export interface CompileOptions {
  /** Override `recipe.seed`. Used by per-instance bakes. */
  seed?: number;
}

const ID_SAFE_RE = /[^a-zA-Z0-9_]/g;

function safeId(id: string): string {
  return id.replace(ID_SAFE_RE, "_");
}

/**
 * Walk the graph from `outputId` upward, returning every reachable
 * node id in reverse-topological order (leaves first, output last).
 * Throws on cycles or dangling input refs.
 */
function topoSort(nodes: Map<string, NodeJson>, outputId: string): string[] {
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();

  function visit(id: string, stack: string[]): void {
    const status = state.get(id) ?? 0;
    if (status === 2) return;
    if (status === 1) {
      throw new Error(
        `[procedural] recipe cycle through nodes: ${[...stack, id].join(" → ")}`,
      );
    }
    const node = nodes.get(id);
    if (!node) {
      throw new Error(`[procedural] unknown node "${id}" referenced as input`);
    }
    state.set(id, 1);
    stack.push(id);
    if (node.inputs) {
      for (const ref of Object.values(node.inputs)) {
        visit(ref, stack);
      }
    }
    stack.pop();
    state.set(id, 2);
    order.push(id);
  }

  visit(outputId, []);
  return order;
}

/** Cheap 32-bit content hash — Cyrb53 truncated, hex-encoded. */
export function hashRecipe(recipe: RecipeJson, seed: number): string {
  const text = JSON.stringify(recipe) + "|seed=" + seed;
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(16).padStart(8, "0");
  const b = (h1 >>> 0).toString(16).padStart(8, "0");
  return a + b;
}

export function compileRecipe(recipe: RecipeJson, opts: CompileOptions = {}): CompiledRecipe {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("[procedural] recipe must be an object");
  }
  if (!Array.isArray(recipe.nodes) || recipe.nodes.length === 0) {
    throw new Error(`[procedural] recipe "${recipe.id}" has no nodes`);
  }
  const width = Math.max(1, Math.round(recipe.size?.width ?? 64));
  const height = Math.max(1, Math.round(recipe.size?.height ?? 64));
  const seed = opts.seed ?? recipe.seed ?? 0;

  // Index nodes + locate the (single) output sink.
  const nodes = new Map<string, NodeJson>();
  const outputs: string[] = [];
  for (const node of recipe.nodes) {
    if (!node || typeof node.id !== "string" || typeof node.op !== "string") {
      throw new Error(`[procedural] recipe "${recipe.id}" has a malformed node`);
    }
    if (nodes.has(node.id)) {
      throw new Error(`[procedural] recipe "${recipe.id}" has duplicate node id "${node.id}"`);
    }
    nodes.set(node.id, node);
    if (node.op === "output") outputs.push(node.id);
  }
  if (outputs.length === 0) {
    throw new Error(`[procedural] recipe "${recipe.id}" has no output node`);
  }
  if (outputs.length > 1) {
    throw new Error(
      `[procedural] recipe "${recipe.id}" has ${outputs.length} output nodes (must be exactly 1)`,
    );
  }
  const outputId = outputs[0]!;

  // Topo sort.
  const sortedIds = topoSort(nodes, outputId);

  // Emit each node's helper function.
  const helperDecls: string[] = [];
  for (const id of sortedIds) {
    const node = nodes.get(id)!;
    const op = resolveOp(node.op);
    if (!op) {
      throw new Error(
        `[procedural] recipe "${recipe.id}" uses unknown op "${node.op}" on node "${id}"`,
      );
    }
    const inputLocals: Record<string, string> = {};
    if (node.inputs) {
      for (const [portName, upstreamId] of Object.entries(node.inputs)) {
        if (!nodes.has(upstreamId)) {
          throw new Error(
            `[procedural] node "${id}" input "${portName}" references unknown node "${upstreamId}"`,
          );
        }
        // Each helper is called fresh at the current uv to keep the
        // generated GLSL simple — the driver's inliner CSEs repeated
        // calls. This costs us nothing observable for IL2 recipes
        // (every example is < 10 nodes).
        inputLocals[portName] = `node_${safeId(upstreamId)}(uv)`;
      }
    }
    const body = op.emit({
      nodeId: id,
      inputs: inputLocals,
      params: node.params ?? {},
      recipeSeed: seed,
    });
    helperDecls.push(`vec4 node_${safeId(id)}(vec2 uv) {\n${body}\n}`);
  }

  const fragmentSource = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_recipeSeed;
uniform float u_instanceSeed;

in vec2 v_uv;
out vec4 fragColor;

${GLSL_HELPERS}

${helperDecls.join("\n\n")}

void main() {
  vec2 uv = v_uv;
  fragColor = node_${safeId(outputId)}(uv);
}
`;

  return {
    id: recipe.id,
    fragmentSource,
    width,
    height,
    hash: hashRecipe(recipe, seed),
    seed,
  };
}
