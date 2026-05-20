/**
 * Script-ref invoker — Phase 0.
 *
 * Routes `{ script: "selection.clear", args: [...] }` declarations from
 * JSON-authored panels into the command registry. This is the ONLY
 * way a JSON panel triggers behaviour — there is no escape hatch for
 * raw function refs in the spec, by design (per
 * `feedback_command_registry_required.md`: every interactive action
 * must be registered).
 *
 * Args support a `{ $value: true }` placeholder that's replaced at
 * invoke time with the triggering control's current value (typed-into-
 * an-Input text, etc.). Strings, numbers, and booleans are passed
 * through verbatim — useful for parameterised macros like
 * `{ script: "scene.set-fog", args: [0.5] }`.
 *
 * Command signature mismatch: `EditorCommand.run` is currently
 * `() => void | Promise<void>` — it does NOT accept positional args.
 * Phase 0 treats args as "make available to the command via a
 * convention" rather than passing them positionally. The convention:
 * the args array is stashed on a module-local context that the
 * registered command's `run` can read via `getInvokeContext()`. This
 * is intentionally minimal — Phase 1 should either widen the command
 * signature or replace this with a proper arg-passing channel.
 */

import { useCommandStore } from "../state/useCommandStore";
import { isValuePlaceholder, type ScriptRef } from "./types";

/**
 * Per-invocation context made available to commands that opt into
 * reading args. A command's `run` can call `getInvokeContext()` to
 * pick up the parameterised values from the triggering JSON node.
 *
 * This is a deliberate minimal-surface stopgap. The "right" solution
 * is to widen `EditorCommand.run` to accept an args object — but
 * that's a registry-wide change and out of scope for the renderer
 * spike. Documented limitation; flagged in the deliverable report.
 */
interface InvokeContext {
  args: ReadonlyArray<string | number | boolean>;
}

let activeContext: InvokeContext | null = null;

/**
 * Called from inside a registered command's `run` function to
 * retrieve the args the JSON-authored caller passed. Returns an
 * empty args array when the command was invoked from outside the
 * renderer (e.g. command palette).
 */
export function getInvokeContext(): InvokeContext {
  return activeContext ?? { args: [] };
}

/**
 * Resolve arg placeholders against the current value of the
 * triggering control. Pass `currentValue` as `undefined` when the
 * caller isn't a value-bearing control (e.g. a button click) — any
 * `{ $value: true }` placeholders become `undefined` and are filtered
 * out.
 */
function resolveArgs(
  ref: ScriptRef,
  currentValue: unknown,
): Array<string | number | boolean> {
  const out: Array<string | number | boolean> = [];
  for (const a of ref.args ?? []) {
    if (isValuePlaceholder(a)) {
      if (typeof currentValue === "string" ||
          typeof currentValue === "number" ||
          typeof currentValue === "boolean") {
        out.push(currentValue);
      }
      // currentValue undefined / null / non-primitive → silently drop.
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Invoke a script-ref. Looks up the command by id, sets the
 * per-invocation context, and dispatches through `runById` so the
 * command's pre/post macros + MRU tracking all fire normally.
 *
 * Returns the promise from `runById` so callers can `await` if they
 * need to chain. The renderer doesn't await (button onClick is
 * fire-and-forget) but tests do.
 */
export async function invokeScript(
  ref: ScriptRef,
  currentValue: unknown = undefined,
): Promise<void> {
  const args = resolveArgs(ref, currentValue);
  const command = useCommandStore.getState().commands[ref.script];
  if (!command) {
    // eslint-disable-next-line no-console
    console.warn(
      `[invokeScript] no command registered for "${ref.script}"`,
    );
    return;
  }

  // Push context — commands that opt into reading args via
  // getInvokeContext() will see this. Nested invocations (a command
  // that calls invokeScript again from within its run) save + restore
  // the previous context so the inner call's args don't leak out.
  const prev = activeContext;
  activeContext = { args };
  try {
    await useCommandStore.getState().runById(ref.script);
  } finally {
    activeContext = prev;
  }
}
