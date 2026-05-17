import { applyConfigOverride } from "GameConfig";
import {
  exportSettings,
  importSettings,
  loadLocalSettings,
  saveLocalSettings,
  type PartialGameConfig,
} from "Settings";
import { deepMerge } from "Libs/DeepMerge";
import type { SettingsAPI } from "./types";

/**
 * Thin ModAPI wrapper around `Settings.ts`. The pack-config layer is
 * threaded in at construction so `save()` can produce the same
 * `pack ⨁ user` merged overlay the engine used to assemble at boot —
 * otherwise changing a single field through the settings UI would
 * wipe the pack's overlay alongside whatever the user actually
 * intended to keep.
 *
 * Why settings live in the ModAPI surface even though they're an
 * engine concern: the engine's own `DefaultSettingsScreen` reads them
 * through `api.settings` (so it shares one code path with pack-side
 * overrides), and any pack that ships its own custom settings modal
 * does too — pack scripts run from a Blob URL and can't import
 * `Settings.ts` directly, they only see `api`. Re-exposing the four
 * functions on `api.settings` is the cheapest crossing for both.
 */
export class SettingsRegistry implements SettingsAPI {
  constructor(private readonly packConfig: PartialGameConfig) {}

  load(): PartialGameConfig {
    return loadLocalSettings();
  }

  save(overlay: PartialGameConfig): void {
    saveLocalSettings(overlay);
    // Layer pack config under user overlay; baseline lives inside
    // applyConfigOverride. Matches the pre-R3 system's compose order.
    applyConfigOverride(
      deepMerge<PartialGameConfig>(
        this.packConfig as PartialGameConfig,
        overlay,
      ),
    );
  }

  export(overlay: PartialGameConfig): void {
    exportSettings(overlay);
  }

  import(): Promise<PartialGameConfig> {
    return importSettings();
  }
}
