/* @jsxImportSource preact */
import type {
  KeyBindings,
  ModAPI,
  PartialGameConfig,
} from "@two_5_d/engine";
import { SettingsScreen } from "../ui/SettingsScreen";

/**
 * Default pack — SettingsScreenSystem.
 *
 * Pack-side after R4. Holds the in-memory user overlay across opens
 * (so changes carry between frames), forwards each mutation to
 * `api.settings.save` (persistence + CONFIG re-merge), and propagates
 * binding changes to every live `PlayerInput` entity so rebinds take
 * effect this frame.
 *
 * Toggle = Escape. Close path runs inside the `SettingsScreen`
 * component (it listens for window Escape and calls `onClose`).
 *
 * Note on open-from-pointerlock-loss: the engine's `Game.ts`
 * pointerlockchange hook directly flips `api.modals.setOpen("settings",
 * true)`. The pack-side reconciler picks that up on the next frame and
 * mounts the modal — no extra coupling needed.
 */
export default (api: ModAPI) => {
  // In-memory overlay — initialised from localStorage, mutated as the
  // user changes settings.
  let overlay: PartialGameConfig = api.settings.load();
  let wasToggleHeld = false;

  const liveProps = () => ({
    live: api.config,
    overlay,
    onChange: (mut: (s: PartialGameConfig) => void) => applyMutation(mut),
    onClose: () => {
      api.modals.setOpen("settings", false);
    },
    bindings: api.bindings,
    settings: api.settings,
  });

  api.ui.registerModal("settings", SettingsScreen, liveProps);

  const applyMutation = (mut: (s: PartialGameConfig) => void): void => {
    mut(overlay);
    // Persist + re-apply (pack + user merge happens inside the engine's
    // SettingsRegistry). After this returns, `api.config` reads the new
    // values immediately because `applyConfigOverride` rebinds CONFIG.
    api.settings.save(overlay);

    // Propagate bindings to every live player so the rebind is active
    // *this frame* rather than after reload.
    const overlayBindings = overlay.bindings;
    if (overlayBindings) {
      api.world.each(api.components.PlayerInput, (_e, input) => {
        const merged: KeyBindings = { ...input.bindings };
        for (const k of Object.keys(overlayBindings) as (keyof KeyBindings)[]) {
          const v = (overlayBindings as Partial<KeyBindings>)[k];
          if (v) {
            (merged as Record<keyof KeyBindings, readonly KeyBindings[keyof KeyBindings][0][]>)[k] =
              v as readonly KeyBindings[keyof KeyBindings][0][];
          }
        }
        input.bindings = merged;
      });
    }
  };

  api.registerSystem((_world, _dt) => {
    // Suppress while another modal owns the screen — Escape there is
    // their close-key.
    const otherModalOpen = api.modals.anyOther("settings");
    const escHeld = api.input.keyboard.isKeyPressed("Escape") && !otherModalOpen;
    if (escHeld && !wasToggleHeld) {
      const isOpen = api.modals.isOpen("settings");
      if (isOpen) {
        api.modals.setOpen("settings", false);
      } else {
        api.modals.setOpen("settings", true);
        document.exitPointerLock();
      }
    }
    wasToggleHeld = escHeld;
  });
};
