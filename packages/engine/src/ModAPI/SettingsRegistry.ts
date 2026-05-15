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
 * engine concern: the pack-side `SettingsScreenSystem` (post-R3 split)
 * is the only consumer. The system runs from a pack script and can't
 * import `Settings.ts` directly — it only sees `api`. Re-exposing
 * the four functions on `api.settings` is the cheapest crossing.
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
