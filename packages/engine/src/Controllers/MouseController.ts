import { Vec2 } from "Libs/Vector";
import type { InputModifiers } from "./KeyboardController";

/**
 * Event-bus bridge for mouse DOM events (Ev1 of EVENTS.md §4.5).
 * `ModAPIImpl` sets this so `mousedown` / `mouseup` / `wheel` fan out
 * on `api.events` after the controller updates its internal state.
 * Engine internals that build a MouseController without a ModAPI
 * leave it unset; the controller stays byte-identical to pre-Ev1.
 */
export type MouseEventEmit = (
  topic: "input:mouseDown" | "input:mouseUp" | "input:wheel",
  payload:
    | { button: number; position: Vec2; modifiers: InputModifiers }
    | { deltaY: number; modifiers: InputModifiers },
) => void;

/**
 * Tracks mouse position, button state, and per-frame motion delta.
 *
 * Motion is reported as a *delta* (`getMovementDelta`) and must be consumed
 * once per frame via `consumeMovement`. That model fits pointer-locked
 * first-person controls, where what matters is "how much did the mouse move
 * this frame", not where the cursor is.
 */
export default class MouseController {
  /** Cursor position in target-element coordinates (`offsetX/Y`). */
  position: Vec2 = Vec2.zero();

  /** Buttons currently held. `0` = left, `1` = middle, `2` = right. */
  readonly buttons: Set<number> = new Set();

  /** Event-bus bridge — set by `ModAPIImpl`. See `MouseEventEmit`. */
  emitEvent: MouseEventEmit | null = null;

  private movement: Vec2 = Vec2.zero();
  /** Signed notch count since last `consumeWheel`. +1 per scroll-down notch. */
  private wheelNotches: number = 0;
  private readonly target: HTMLElement;

  private readonly handleMouseMove = (event: MouseEvent): void => {
    this.position = new Vec2(event.offsetX, event.offsetY);
    // Accumulate within a frame in case multiple `mousemove` events fire
    // between updates — typical at high polling rates.
    this.movement = this.movement.add(new Vec2(event.movementX, event.movementY));
  };
  private readonly handleMouseDown = (event: MouseEvent): void => {
    this.buttons.add(event.button);
    if (this.emitEvent !== null) {
      this.emitEvent("input:mouseDown", {
        button: event.button,
        position: new Vec2(event.offsetX, event.offsetY),
        modifiers: this.modifiers(event),
      });
    }
  };
  private readonly handleMouseUp = (event: MouseEvent): void => {
    this.buttons.delete(event.button);
    if (this.emitEvent !== null) {
      this.emitEvent("input:mouseUp", {
        button: event.button,
        position: new Vec2(event.offsetX, event.offsetY),
        modifiers: this.modifiers(event),
      });
    }
  };
  private readonly handleWheel = (event: WheelEvent): void => {
    // One notch per wheel event — most OSes fire one per click of the
    // wheel regardless of `deltaMode`. Using `Math.sign` collapses pixel
    // vs line vs page modes to a uniform "one switch per notch".
    if (event.deltaY === 0) return;
    // Suppress the default page-scroll behaviour. Pack scripts use the
    // wheel to cycle the hotbar (etc.) — they don't want the browser
    // to ALSO scroll the document underneath. Requires the listener
    // to be registered with `passive: false`.
    event.preventDefault();
    this.wheelNotches += Math.sign(event.deltaY);
    if (this.emitEvent !== null) {
      this.emitEvent("input:wheel", {
        deltaY: event.deltaY,
        modifiers: this.modifiers(event),
      });
    }
  };

  /** Build a normalised modifier struct from a mouse/wheel event. */
  private modifiers(event: MouseEvent | WheelEvent): InputModifiers {
    return {
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
    };
  }

  constructor(target: HTMLElement) {
    this.target = target;
    this.target.addEventListener("mousemove", this.handleMouseMove);
    this.target.addEventListener("mousedown", this.handleMouseDown);
    this.target.addEventListener("mouseup", this.handleMouseUp);
    // passive: false so `handleWheel` can call preventDefault() — pack
    // scripts cycle the hotbar via the wheel and don't want the browser
    // to ALSO scroll the document underneath.
    this.target.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  /** Detach listeners. Call when tearing down the game. */
  destroy(): void {
    this.target.removeEventListener("mousemove", this.handleMouseMove);
    this.target.removeEventListener("mousedown", this.handleMouseDown);
    this.target.removeEventListener("mouseup", this.handleMouseUp);
    this.target.removeEventListener("wheel", this.handleWheel);
    this.buttons.clear();
  }

  /** `true` while the given button is held. */
  isButtonPressed(button: number): boolean {
    return this.buttons.has(button);
  }

  /** `true` while any button is held. */
  isDragging(): boolean {
    return this.buttons.size > 0;
  }

  /** Cumulative mouse motion since the last `consumeMovement()` call. */
  getMovementDelta(): Vec2 {
    return this.movement;
  }

  /**
   * Return the accumulated motion and reset to zero. Call once per frame from
   * the controller that uses it (e.g. `PlayerController.update`).
   */
  consumeMovement(): Vec2 {
    const delta = this.movement;
    this.movement = Vec2.zero();
    return delta;
  }

  /**
   * Signed notch count since the last call: positive = wheel rolled down
   * (toward the user), negative = up. Resets to 0 after read. Use to
   * advance weapon slots, scrollable HUDs, etc.
   */
  consumeWheel(): number {
    const n = this.wheelNotches;
    this.wheelNotches = 0;
    return n;
  }
}
