/* @jsxImportSource preact */
import { h, render } from "preact";
import type { World } from "ECS";
import KeyboardController from "Controllers/KeyboardController";
import { CONFIG, applyConfigOverride, type GameConfig } from "GameConfig";
import { PlayerInput, type KeyBindings } from "Components";
import {
  loadLocalSettings,
  saveLocalSettings,
  type PartialGameConfig,
} from "Settings";
import { SettingsScreen } from "UI/SettingsScreen";
import type ModalRegistry from "ModalRegistry";
import { deepMerge } from "Libs/DeepMerge";

/**
 * Owns the DOM mount for the Settings modal and the in-memory
 * settings overlay. Toggle key is **Escape** (suppressed while
 * another modal is open).
 *
 * Apply flow:
 *   1. UI mutates `this.overlay` via `onChange`.
 *   2. `saveLocalSettings` writes the new overlay to localStorage.
 *   3. `applyConfigOverride(merged overlay)` rebinds the live CONFIG
 *      pointer. Modules that read CONFIG fields each frame (like
 *      `PlayerInputSystem`'s `CONFIG.reticle.sensitivity`) see the
 *      new values immediately; modules that captured constants at
 *      load (`TwoDRenderer`'s `BILINEAR`, …) need a reload.
 *   4. Bindings: we also patch every existing `PlayerInput` entity's
 *      `bindings` so the change takes effect mid-game.
 */
export default class SettingsScreenSystem {
  private readonly mount: HTMLDivElement;
  private open = false;
  private overlay: PartialGameConfig;
  /** Combined pack-config + user overlay; what we hand to applyConfigOverride. */
  private packConfig: PartialGameConfig = {};
  private wasToggleHeld = false;

  constructor(
    private readonly keyboard: KeyboardController,
    private readonly modals: ModalRegistry,
  ) {
    const ATTR = "data-engine-settings-mount";
    document.querySelectorAll(`[${ATTR}]`).forEach((stale) => stale.remove());
    const mount = document.createElement("div");
    mount.setAttribute(ATTR, "true");
    document.body.appendChild(mount);
    this.mount = mount;
    this.overlay = loadLocalSettings();
  }

  /**
   * The pack's own config.json contents (already applied at boot).
   * Stored so that re-applying the user overlay layers cleanly on top
   * — otherwise the pack tweaks would be lost when the user changes
   * a single setting.
   */
  setPackConfig(packConfig: PartialGameConfig): void {
    this.packConfig = packConfig;
  }

  /** Current overlay (the persisted user delta). Read-only externally. */
  getOverlay(): PartialGameConfig {
    return this.overlay;
  }

  isOpen(): boolean {
    return this.open;
  }

  update(world: World, _deltaTime: number): void {
    // Don't grab Esc if another modal already owns it.
    const otherModalOpen = this.modals.anyOther("settings");
    const escHeld = this.keyboard.isKeyPressed("Escape") && !otherModalOpen;
    if (escHeld && !this.wasToggleHeld) {
      this.toggle(world);
    }
    this.wasToggleHeld = escHeld;
  }

  private toggle(world: World): void {
    if (this.open) this.close();
    else this.openFor(world);
  }

  /** Public entry to open the modal — used by Game's pointerlockchange hook. */
  openModal(world: World): void {
    if (!this.open) this.openFor(world);
  }

  private openFor(world: World): void {
    this.open = true;
    this.modals.setOpen("settings", true);
    document.exitPointerLock();
    this.rerender(world);
  }

  private close = (): void => {
    this.open = false;
    this.modals.setOpen("settings", false);
    render(null, this.mount);
  };

  private rerender(world: World): void {
    render(
      h(SettingsScreen, {
        live: CONFIG,
        overlay: this.overlay,
        onChange: (mut) => this.applyMutation(mut, world),
        onClose: this.close,
      }),
      this.mount,
    );
  }

  /**
   * Run `mut` against the in-memory overlay, persist, rebuild CONFIG,
   * and propagate live changes (bindings → entities). Re-renders the
   * modal so the UI reflects the new state.
   */
  private applyMutation(
    mut: (s: PartialGameConfig) => void,
    world: World,
  ): void {
    mut(this.overlay);
    saveLocalSettings(this.overlay);

    // Layer pack config under user overlay; the engine baseline lives
    // inside applyConfigOverride.
    applyConfigOverride(mergeOverlay(this.packConfig, this.overlay));

    // Propagate bindings to every live player entity so the rebind is
    // active *this frame*, not after reload.
    if (this.overlay.bindings) {
      world.each(PlayerInput, (_e, input) => {
        const merged: KeyBindings = { ...input.bindings };
        for (const k of Object.keys(this.overlay.bindings ?? {}) as (keyof KeyBindings)[]) {
          const v = (this.overlay.bindings as Partial<KeyBindings>)[k];
          if (v) (merged as Record<keyof KeyBindings, readonly KeyBindings[keyof KeyBindings][0][]>)[k] = v;
        }
        input.bindings = merged;
      });
    }

    this.rerender(world);
  }
}

/** Compose pack + user overlays into a single override for CONFIG. */
function mergeOverlay(
  pack: PartialGameConfig,
  user: PartialGameConfig,
): PartialGameConfig {
  return deepMerge<PartialGameConfig>(
    pack as Partial<GameConfig>,
    user as Partial<GameConfig>,
  );
}
