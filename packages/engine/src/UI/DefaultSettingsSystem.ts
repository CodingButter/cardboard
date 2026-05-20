import { CONFIG } from "GameConfig";
import type { PartialGameConfig } from "Settings";
import type { ModAPIImpl } from "ModAPI/ModAPIImpl";
import { DefaultSettingsScreen } from "./DefaultSettingsScreen";

/**
 * Auto-registers the engine's default Settings modal + a frame system
 * that polls the Escape key to toggle it.
 *
 * Called from `Game.runPackScripts()` AFTER pack scripts run so packs
 * that want a custom Settings modal can override by calling
 * `api.ui.registerModal("settings", MyCustomSettings)` at script time.
 * The UI registry's last-write-wins semantic then means the pack's
 * component takes effect.
 *
 * The toggle system itself is registered unconditionally — once Escape
 * is pressed it just flips `api.modals.setOpen("settings", ...)`. If a
 * pack didn't override the modal component, the engine's
 * `DefaultSettingsScreen` mounts. If it did, the pack's mounts. Either
 * way the toggle keybind keeps working.
 *
 * Per `docs/plans/EDITOR_REDESIGN.md` §12 Q4, this is the universal
 * Settings surface every cardboard game gets for free, regardless of
 * which packs are loaded. Pack-specific modals (Inventory, hotbar,
 * minimap, …) live in their packs.
 *
 * Engine-side scope: the modal mounts, persists overlay to local
 * storage, and re-applies it to the live CONFIG. Pack-specific
 * propagation (e.g. pushing the new bindings into each player's
 * `PlayerInput` component the same frame) lives in the pack that
 * defines `PlayerInput` — it subscribes to `settings:changed` /
 * `frame:before` and walks its own entities. See
 * the prefabs-editor-only plan §17 (shipped 2026-05-17, see git log) — engine no longer reads
 * any game-specific component.
 */
export function installDefaultSettings(api: ModAPIImpl): void {
  // In-memory overlay — initialised from localStorage / pack config,
  // mutated as the user changes settings.
  let overlay: PartialGameConfig = api.settings.load();
  let wasToggleHeld = false;

  const applyMutation = (mut: (s: PartialGameConfig) => void): void => {
    mut(overlay);
    // Persist + re-apply (pack + user merge happens inside the engine's
    // SettingsRegistry). After this returns, `api.config` reads the new
    // values immediately because `applyConfigOverride` rebinds CONFIG.
    api.settings.save(overlay);
  };

  const liveProps = () => ({
    live: CONFIG,
    overlay,
    onChange: (mut: (s: PartialGameConfig) => void) => applyMutation(mut),
    onClose: () => {
      api.modals.setOpen("settings", false);
    },
    bindings: api.bindings,
    settings: api.settings,
  });

  // Override-by-re-registering pattern: pack scripts run BEFORE
  // `installDefaultSettings`. If a pack already registered its own
  // `"settings"` modal we leave it alone — packs win. Only the slot-
  // is-empty case lands the engine default, which is the fallback for
  // packs that don't define their own settings UI.
  if (!api.ui.has("settings")) {
    api.ui.registerModal("settings", DefaultSettingsScreen, liveProps);
  }

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
}
