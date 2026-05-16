/**
 * The physical key codes the rest of the codebase asks about.
 *
 * These values match `KeyboardEvent.code` exactly, which is layout-independent
 * — `KeyW` is the physical W slot whether the user is on QWERTY, AZERTY or
 * Dvorak. That matters for shooters: WASD has to be the same four keys
 * regardless of locale.
 */
/**
 * Binding code — covers both keyboard codes (matching
 * `KeyboardEvent.code`) and mouse button codes. Mouse codes follow the
 * pattern `MouseN` where N is the `MouseEvent.button` index:
 *
 *   - `Mouse0` — primary (typically left)
 *   - `Mouse1` — middle
 *   - `Mouse2` — secondary (typically right)
 *   - `Mouse3` — back (typically the side button)
 *   - `Mouse4` — forward (typically the other side button)
 *
 * The bindings layer treats them uniformly; helpers in `Bindings.ts`
 * dispatch keyboard vs mouse based on the prefix.
 */
export type KeyCode =
  | "KeyW"
  | "KeyA"
  | "KeyS"
  | "KeyD"
  | "KeyE"
  | "KeyC"
  | "KeyQ"
  | "KeyR"
  | "KeyF"
  | "Space"
  | "ShiftLeft"
  | "ShiftRight"
  | "ControlLeft"
  | "ControlRight"
  | "AltLeft"
  | "AltRight"
  | "Tab"
  | "Escape"
  | "Backquote"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Digit1"
  | "Digit2"
  | "Digit3"
  | "Digit4"
  | "Digit5"
  | "Digit6"
  | "Digit7"
  | "Digit8"
  | "Digit9"
  | "Mouse0"
  | "Mouse1"
  | "Mouse2"
  | "Mouse3"
  | "Mouse4";

/**
 * Native-event modifier set, normalised so `EventsAPI` payloads
 * (`input:keyDown` / `input:keyUp` / mouse) all carry the same shape.
 * Pulled to a helper so KeyboardController + MouseController stay in
 * sync without duplicating the per-event extraction.
 */
export interface InputModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Hook the engine wires onto the controller to surface DOM events on
 * `api.events` (Ev1 of EVENTS.md §4.5). Native `keydown` reaches the
 * controller first, the controller updates `pressedKeys`, THEN this
 * fires — so a pack handler querying `isKeyPressed` inside the hook
 * sees the new state (the spec calls this out under §4.5).
 *
 * Engine internals that build a controller without a ModAPI leave the
 * field unset; the controller stays byte-identical to pre-Ev1.
 */
export type InputEventEmit = (
  topic: "input:keyDown" | "input:keyUp",
  payload: { key: KeyCode; modifiers: InputModifiers },
) => void;

/**
 * Tracks the set of physical keys currently held down.
 *
 * Listens at `document` so the canvas doesn't need focus for input to work.
 * Call `destroy()` to detach.
 */
export default class KeyboardController {
  private readonly pressedKeys: Set<string> = new Set();

  /**
   * Optional event-bus bridge — `ModAPIImpl` sets this so DOM key
   * events fan out on `api.events` after pressedKeys is updated. Left
   * null in tests / non-ModAPI callers.
   */
  emitEvent: InputEventEmit | null = null;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);
    if (this.emitEvent !== null) {
      this.emitEvent("input:keyDown", {
        key: event.code as KeyCode,
        modifiers: {
          shift: event.shiftKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          meta: event.metaKey,
        },
      });
    }
  };
  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
    if (this.emitEvent !== null) {
      this.emitEvent("input:keyUp", {
        key: event.code as KeyCode,
        modifiers: {
          shift: event.shiftKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          meta: event.metaKey,
        },
      });
    }
  };

  constructor() {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
  }

  /** Detach window listeners. Call when tearing down the game. */
  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    this.pressedKeys.clear();
  }

  /** `true` while `code` is held. */
  isKeyPressed(code: KeyCode): boolean {
    return this.pressedKeys.has(code);
  }

  /** `true` if any of `codes` are held. Handy for "either shift", etc. */
  isAnyKeyPressed(codes: readonly KeyCode[]): boolean {
    for (const code of codes) {
      if (this.pressedKeys.has(code)) return true;
    }
    return false;
  }
}
