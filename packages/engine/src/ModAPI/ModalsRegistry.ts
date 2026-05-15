import type ModalRegistry from "ModalRegistry";
import type { ModalsAPI } from "./types";

/**
 * Thin ModAPI wrapper around the engine's `ModalRegistry`.
 *
 * Pack-side modal systems (inventory screen, settings screen) toggle
 * themselves through this so that multiple modals don't fight over
 * Escape / clicks. The wrapper exposes only the four methods on
 * `ModalsAPI`; the underlying registry stays an engine-internal type.
 */
export class ModalsRegistry implements ModalsAPI {
  constructor(private readonly registry: ModalRegistry) {}

  setOpen(modalId: string, isOpen: boolean): void {
    this.registry.setOpen(modalId, isOpen);
  }

  isOpen(modalId: string): boolean {
    return this.registry.isOpen(modalId);
  }

  any(): boolean {
    return this.registry.any();
  }

  anyOther(modalId: string): boolean {
    return this.registry.anyOther(modalId);
  }
}
