/**
 * Tiny global tracker for "is any UI modal up right now?". The Game's
 * update loop reads `any()` to decide whether to pause world-affecting
 * systems; modal systems read each other's state to suppress their
 * toggle keys while a different modal owns the screen.
 *
 * One instance lives on Game; each modal system gets a reference and
 * calls `setOpen(name, true|false)` on its own transitions.
 */
export default class ModalRegistry {
  private readonly openNames: Set<string> = new Set();

  setOpen(name: string, open: boolean): void {
    if (open) this.openNames.add(name);
    else this.openNames.delete(name);
  }

  isOpen(name: string): boolean {
    return this.openNames.has(name);
  }

  /** `true` if any modal is currently on screen. */
  any(): boolean {
    return this.openNames.size > 0;
  }

  /** `true` if a modal other than `name` is open. */
  anyOther(name: string): boolean {
    for (const n of this.openNames) if (n !== name) return true;
    return false;
  }
}
