import type KeyboardController from "Controllers/KeyboardController";
import type MouseController from "Controllers/MouseController";
import type { KeyCode } from "Controllers/KeyboardController";
import { isBindingPressed } from "Controllers/Bindings";
import { Vec2 } from "Libs/Vector";
import type { InputAPI, KeyboardInputAPI, MouseInputAPI } from "./types";

/**
 * Read-only ModAPI wrapper around the engine's keyboard + mouse
 * controllers. Pack-side systems read input through this instead of
 * importing `KeyboardController` / `MouseController` directly.
 *
 * The wrapper exposes only the methods listed in the `InputAPI` type;
 * it never hands out the underlying controller objects. That keeps
 * pack scripts from poking at internals (e.g. swapping listener
 * targets) while still letting them poll keys, buttons, and consume
 * the per-frame motion + wheel deltas the engine accumulates.
 */
export class InputRegistry implements InputAPI {
  readonly keyboard: KeyboardInputAPI;
  readonly mouse: MouseInputAPI;

  constructor(
    private readonly keyboardController: KeyboardController,
    private readonly mouseController: MouseController,
  ) {
    const kb = this.keyboardController;
    this.keyboard = {
      isKeyPressed: (code: KeyCode): boolean => kb.isKeyPressed(code),
      isAnyKeyPressed: (codes: readonly KeyCode[]): boolean => kb.isAnyKeyPressed(codes),
    };
    const mouse = this.mouseController;
    this.mouse = {
      isButtonPressed: (button: number): boolean => mouse.isButtonPressed(button),
      consumeMovement: (): Vec2 => mouse.consumeMovement(),
      consumeWheel: (): number => mouse.consumeWheel(),
      get position(): Vec2 {
        return mouse.position;
      },
    };
  }

  isBindingPressed(codes: readonly KeyCode[]): boolean {
    return isBindingPressed(codes, this.keyboardController, this.mouseController);
  }
}
