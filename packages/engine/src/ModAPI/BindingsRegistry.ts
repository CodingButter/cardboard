import { bindingLabel } from "Controllers/Bindings";
import type { KeyCode } from "Controllers/KeyboardController";
import type { BindingsAPI } from "./types";

/**
 * Thin wrapper around `Controllers/Bindings#bindingLabel`. Exists so
 * pack-side settings UIs can format binding codes ("Mouse0" → "Mouse L")
 * without importing engine internals directly.
 */
export class BindingsRegistry implements BindingsAPI {
  label(code: KeyCode): string {
    return bindingLabel(code);
  }
}
