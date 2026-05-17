/**
 * Op registry — name → factory.
 *
 * The compiler dispatches `node.op` through this map; missing keys
 * raise a structured compile error. SL4+ will add `sample`,
 * `granular`, `distort`, `bitcrush`, `compressor`, `chorus`/`flanger`,
 * `sequencer`, `random`, `send`, `tape`, `fft`. SL2 ships only the
 * MVP set listed below.
 */

import type { OpFactory } from "./OpFactory";
import { oscillator } from "./oscillator";
import { noise } from "./noise";
import { filter } from "./filter";
import { envelope } from "./envelope";
import { lfo } from "./lfo";
import { gain } from "./gain";
import { mixer } from "./mixer";
import { pan } from "./pan";
import { delay } from "./delay";
import { reverb } from "./reverb";
import { output } from "./output";

export const OP_FACTORIES: Record<string, OpFactory> = {
  oscillator,
  noise,
  filter,
  envelope,
  lfo,
  gain,
  mixer,
  pan,
  delay,
  reverb,
  output,
};

/** Test hook — list the op names this build supports. */
export function listSupportedOps(): readonly string[] {
  return Object.keys(OP_FACTORIES);
}

export type { OpFactory, BuiltNode, VoiceContext } from "./OpFactory";
