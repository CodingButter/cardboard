/* @jsxImportSource preact */
import { h, render } from "preact";
import type { World } from "ECS";
import KeyboardController from "Controllers/KeyboardController";
import { Inventory, PlayerInput } from "Components";
import type { AssetPack } from "AssetPack";
import type ItemImages from "ItemImages";
import { InventoryScreen } from "UI/InventoryScreen";
import type ModalRegistry from "ModalRegistry";

/**
 * Owns the DOM mount for the inventory modal and toggles it on `KeyE`.
 * The modal is rendered via Preact into a `<div>` appended to
 * `document.body` once at construction. We only call `render(null, ...)`
 * to unmount; opening/closing happens by swapping the root component
 * in and out (preserves modal state through pure re-render, costs
 * nothing to mount/unmount on each toggle).
 *
 * While open:
 *   - Pointer lock is released so the system cursor reappears.
 *   - The modal's own keydown listener (capture phase) catches `E`/`Esc`
 *     to close, so neither key reaches the game's other input systems.
 *
 * The system also exposes `isOpen()` so the player-input/game-update
 * pipeline can gate world interaction (e.g. don't keep firing the gun
 * while you're rearranging items).
 */
export default class InventoryScreenSystem {
  private readonly mount: HTMLDivElement;
  private open: boolean = false;
  private wasToggleHeld: boolean = false;

  constructor(
    private readonly keyboard: KeyboardController,
    private readonly pack: AssetPack,
    private readonly icons: ItemImages,
    private readonly modals: ModalRegistry,
  ) {
    // Same self-healing-on-HMR pattern as the WebGL HUD canvas.
    const ATTR = "data-engine-inventory-mount";
    document.querySelectorAll(`[${ATTR}]`).forEach((stale) => stale.remove());
    const mount = document.createElement("div");
    mount.setAttribute(ATTR, "true");
    document.body.appendChild(mount);
    this.mount = mount;
  }

  /** `true` while the modal is on screen. */
  isOpen(): boolean {
    return this.open;
  }

  update(world: World, _deltaTime: number): void {
    // Edge-trigger KeyE to toggle. Suppress while another modal owns
    // the screen so KeyE doesn't pop the inventory open behind it.
    const blocked = this.modals.anyOther("inventory");
    const toggleHeld = this.keyboard.isKeyPressed("KeyE") && !blocked;
    if (toggleHeld && !this.wasToggleHeld) {
      this.toggle(world);
    }
    this.wasToggleHeld = toggleHeld;
  }

  private toggle(world: World): void {
    if (this.open) this.close();
    else this.openFor(world);
  }

  private openFor(world: World): void {
    const player = world.first(PlayerInput, Inventory);
    if (player === undefined) return;
    const inventory = Inventory.getOrThrow(player);
    this.open = true;
    this.modals.setOpen("inventory", true);
    document.exitPointerLock();
    this.rerender(inventory);
  }

  private close = (): void => {
    this.open = false;
    this.modals.setOpen("inventory", false);
    render(null, this.mount);
  };

  /** Force a fresh Preact render with the current inventory + state. */
  private rerender(inventory: ReturnType<typeof Inventory.getOrThrow>): void {
    render(
      h(InventoryScreen, {
        inventory,
        manifest: this.pack.manifest,
        icons: this.icons,
        onClose: this.close,
      }),
      this.mount,
    );
  }
}
