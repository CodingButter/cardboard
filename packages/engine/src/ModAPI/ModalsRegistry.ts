import type ModalRegistry from "ModalRegistry";
import type { EventsAPI, ModalsAPI } from "./types";

/**
 * Thin ModAPI wrapper around the engine's `ModalRegistry`.
 *
 * Pack-side modal systems (inventory screen, settings screen) toggle
 * themselves through this so that multiple modals don't fight over
 * Escape / clicks. The wrapper exposes only the four methods on
 * `ModalsAPI`; the underlying registry stays an engine-internal type.
 *
 * Ev1 hook: every OFF→ON / ON→OFF transition routes through this
 * wrapper, so `setOpen` is the canonical edge-detection site for
 * `modal:opened` / `modal:closed`. The underlying `ModalRegistry`
 * dedupes (calling `setOpen(x, true)` twice is a no-op), so events
 * only fire on true edges.
 */
export class ModalsRegistry implements ModalsAPI {
  constructor(
    private readonly registry: ModalRegistry,
    private readonly events: EventsAPI,
  ) {}

  setOpen(modalId: string, isOpen: boolean): void {
    const was = this.registry.isOpen(modalId);
    this.registry.setOpen(modalId, isOpen);
    if (was === isOpen) return; // no edge
    this.events.emit(
      isOpen ? "modal:opened" : "modal:closed",
      { name: modalId },
    );
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
