import type { KeyCode } from "Controllers/KeyboardController";
import type KeyboardController from "Controllers/KeyboardController";
import type MouseController from "Controllers/MouseController";

/**
 * Unified "any of these codes pressed" check that dispatches keyboard
 * vs mouse based on the code's prefix. Bindings declared as `"Mouse2"`
 * route through the `MouseController`; everything else routes through
 * the `KeyboardController`. Lets the same `KeyBindings` shape carry
 * both kinds of triggers without forcing every reader to know the
 * difference.
 */
export function isBindingPressed(
  codes: readonly KeyCode[],
  keyboard: KeyboardController,
  mouse: MouseController,
): boolean {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (isMouseCode(code)) {
      const button = mouseButtonOf(code);
      if (button >= 0 && mouse.isButtonPressed(button)) return true;
    } else {
      if (keyboard.isKeyPressed(code)) return true;
    }
  }
  return false;
}

/** `true` when `code` represents a mouse button (`MouseN`). */
export function isMouseCode(code: KeyCode): boolean {
  return code.length >= 6 && code.startsWith("Mouse");
}

/**
 * Extract the `MouseEvent.button` index from a `MouseN` code, or `-1`
 * when the code isn't a mouse code or has an unparseable suffix.
 */
export function mouseButtonOf(code: KeyCode): number {
  if (!isMouseCode(code)) return -1;
  const n = Number(code.slice(5));
  return Number.isFinite(n) ? n : -1;
}

/** Build a `MouseN` code from a `MouseEvent.button` index. */
export function mouseCodeOf(button: number): KeyCode {
  return `Mouse${button}` as KeyCode;
}

/**
 * Human-readable label for a binding code. Used by the settings UI
 * since `Mouse2` / `KeyW` aren't friendly to read.
 */
export function bindingLabel(code: KeyCode): string {
  if (isMouseCode(code)) {
    const b = mouseButtonOf(code);
    switch (b) {
      case 0: return "Mouse L";
      case 1: return "Mouse M";
      case 2: return "Mouse R";
      case 3: return "Mouse 4 (back)";
      case 4: return "Mouse 5 (forward)";
      default: return code;
    }
  }
  return code;
}
