/**
 * Sound Lab recipe → Web Audio node graph compiler.
 *
 * SOUND_LAB.md §6.1. Pure function: walks the recipe's node array,
 * topologically sorts it, instantiates each node via its op factory,
 * wires audio inputs + modulation routes, and returns a
 * `CompiledRecipe` whose `output` is the terminal `output` node.
 *
 * The compiler is mode-agnostic: callers pass an OfflineAudioContext
 * for static + loop bakes, an AudioContext for instrument voices.
 * The caller is responsible for connecting `output` downstream (to
 * `offline.destination` for bakes, to a group gain node for live
 * voices).
 *
 * Errors are thrown as plain `Error` with a `[procedural-audio]`
 * prefix. The editor will eventually wrap these with structured
 * error rows; for SL2 the engine just logs + skips.
 */

import type { AudioNodeJson, SoundRecipeJson } from "./types";
import type { BuiltNode, OpFactory, VoiceContext } from "./Ops";
import { OP_FACTORIES } from "./Ops";

export interface CompiledRecipe {
  /** Node id → built node, in instantiation order. */
  readonly nodes: ReadonlyMap<string, BuiltNode>;
  /** The terminal `output` node — connect this downstream. */
  readonly output: AudioNode;
  /** Tear down all nodes. Calls each op's `dispose()` and disconnects. */
  dispose(): void;
}

interface NormalisedInputs {
  /** Positional inputs (mixer, gain, etc. — most ops). */
  positional: string[];
  /** Named-port inputs (envelope `trigger`, etc.). */
  named: Record<string, string>;
}

function normaliseInputs(inputs: AudioNodeJson["inputs"]): NormalisedInputs {
  if (!inputs) return { positional: [], named: {} };
  if (Array.isArray(inputs)) return { positional: inputs, named: {} };
  return { positional: [], named: { ...inputs } };
}

/**
 * Topological sort over the audio-graph DAG. Modulation routes are
 * NOT part of the audio DAG (SL §6.2) — they're allowed to be cyclic
 * because they connect through `AudioParam`s, which Web Audio handles
 * separately from audio paths.
 */
function topoSort(nodes: AudioNodeJson[]): AudioNodeJson[] {
  const byId = new Map<string, AudioNodeJson>();
  for (const n of nodes) {
    if (byId.has(n.id)) {
      throw new Error(`[procedural-audio] duplicate node id: "${n.id}"`);
    }
    byId.set(n.id, n);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: AudioNodeJson[] = [];
  const visit = (n: AudioNodeJson): void => {
    if (visited.has(n.id)) return;
    if (visiting.has(n.id)) {
      throw new Error(`[procedural-audio] cycle detected at node "${n.id}"`);
    }
    visiting.add(n.id);
    const { positional, named } = normaliseInputs(n.inputs);
    for (const dep of [...positional, ...Object.values(named)]) {
      const upstream = byId.get(dep);
      if (!upstream) {
        throw new Error(
          `[procedural-audio] node "${n.id}" references unknown input "${dep}"`,
        );
      }
      visit(upstream);
    }
    visiting.delete(n.id);
    visited.add(n.id);
    order.push(n);
  };
  for (const n of nodes) visit(n);
  return order;
}

/**
 * Compile a recipe against `ctx`. The optional `voice` carries
 * per-voice context for instrument mode — `null` for static + loop
 * bakes against an OfflineAudioContext.
 */
export function compileRecipe(
  recipe: SoundRecipeJson,
  ctx: BaseAudioContext,
  voice: VoiceContext | null = null,
): CompiledRecipe {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("[procedural-audio] recipe is not an object");
  }
  if (!Array.isArray(recipe.nodes) || recipe.nodes.length === 0) {
    throw new Error(`[procedural-audio] recipe "${recipe.id}" has no nodes`);
  }

  const outputNodes = recipe.nodes.filter((n) => n.op === "output");
  if (outputNodes.length === 0) {
    throw new Error(`[procedural-audio] recipe "${recipe.id}" has no "output" node`);
  }
  if (outputNodes.length > 1) {
    throw new Error(
      `[procedural-audio] recipe "${recipe.id}" has multiple "output" nodes`,
    );
  }

  const order = topoSort(recipe.nodes);

  const built = new Map<string, BuiltNode>();
  const disposers: (() => void)[] = [];

  for (const node of order) {
    const factory: OpFactory | undefined = OP_FACTORIES[node.op];
    if (!factory) {
      // Unknown op — log + skip, but synthesise an empty GainNode so
      // downstream consumers still resolve.
      console.warn(`[procedural-audio] unknown op "${node.op}" on node "${node.id}"; using passthrough`);
      const fallback = ctx.createGain();
      const builtNode: BuiltNode = {
        output: fallback,
        inputAt: () => fallback,
        paramAt: (name) => (name === "gain" ? fallback.gain : undefined),
        dispose: () => fallback.disconnect(),
      };
      built.set(node.id, builtNode);
      disposers.push(() => builtNode.dispose?.());
      continue;
    }
    const result = factory(ctx, node, recipe, voice);
    built.set(node.id, result);
    if (result.dispose) disposers.push(result.dispose);
  }

  // ── Wire audio inputs ─────────────────────────────────────────────
  // For each node, connect upstream sources' outputs into its input
  // port. Positional inputs all land on the default port (or the op's
  // single input GainNode). Named inputs land on the matching port.
  for (const node of order) {
    const consumer = built.get(node.id)!;
    const { positional, named } = normaliseInputs(node.inputs);

    // Positional → default port. Many ops sum positional inputs into
    // a single GainNode; ops without an explicit `inputAt` fall back
    // to connecting upstream sources directly to `output` (no-op
    // since pure generators have no input).
    for (const upstreamId of positional) {
      const upstream = built.get(upstreamId);
      if (!upstream) continue;
      const port = consumer.inputAt?.("input") ?? consumer.inputAt?.("default");
      if (port) {
        upstream.output.connect(port);
      }
    }

    for (const [portName, upstreamId] of Object.entries(named)) {
      const upstream = built.get(upstreamId);
      if (!upstream) continue;
      const port = consumer.inputAt?.(portName);
      if (port) {
        upstream.output.connect(port);
      }
    }
  }

  // ── Wire modulation routes ────────────────────────────────────────
  for (const node of order) {
    const consumer = built.get(node.id)!;
    if (!node.modulation) continue;
    for (const route of node.modulation) {
      const source = built.get(route.source);
      const param = consumer.paramAt?.(route.param);
      if (!source) {
        console.warn(
          `[procedural-audio] modulation source "${route.source}" missing on node "${node.id}"`,
        );
        continue;
      }
      if (!param) {
        console.warn(
          `[procedural-audio] modulation target param "${route.param}" missing on node "${node.id}"`,
        );
        continue;
      }
      // Insert an amount-scaling GainNode between source and param so
      // authors can tune route depth without retuning the source op.
      const amount = typeof route.amount === "number" ? route.amount : 1;
      if (amount === 1) {
        source.output.connect(param);
      } else {
        const g = ctx.createGain();
        g.gain.value = amount;
        source.output.connect(g);
        g.connect(param);
        disposers.push(() => g.disconnect());
      }
    }
  }

  const outputNode = built.get(outputNodes[0]!.id)!.output;

  return {
    nodes: built,
    output: outputNode,
    dispose() {
      for (const fn of disposers) {
        try { fn(); } catch { /* best-effort teardown */ }
      }
    },
  };
}
