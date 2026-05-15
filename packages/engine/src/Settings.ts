import type { GameConfig } from "GameConfig";
import { deepMerge } from "Libs/DeepMerge";

/**
 * User-tunable runtime settings — a partial overlay on top of the
 * baseline `game.config.json` and any pack-supplied `config.json`.
 *
 * Layering (last wins):
 *   1. baseline `game.config.json`           ← engine defaults
 *   2. pack's `config.json`                  ← per-pack tweaks
 *   3. localStorage (user settings)          ← what this module owns
 *   4. `?settings=<url>` URL parameter       ← shared / hosted profile
 *
 * This module produces a `PartialGameConfig` for `applyConfigOverride`
 * to consume. It doesn't know anything about the game running — the
 * settings UI mutates a settings object and asks this module to
 * persist + (where possible) hot-apply.
 */

/** Deep-partial helper — every field optional, recursively. */
export type DeepPartial<T> = T extends object
  ? T extends ReadonlyArray<unknown>
    ? T
    : { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export type PartialGameConfig = DeepPartial<GameConfig>;

const STORAGE_KEY = "two_5_d.settings.v1";

/** Read whatever the user has saved locally. Returns `{}` on first run. */
export function loadLocalSettings(): PartialGameConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PartialGameConfig;
  } catch (err) {
    console.warn("Settings: failed to parse localStorage —", err);
    return {};
  }
}

/** Write the full settings object back to localStorage. */
export function saveLocalSettings(settings: PartialGameConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Settings: failed to save localStorage —", err);
  }
}

/** Forget every saved setting. */
export function clearLocalSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * If the page URL has `?settings=<URL>`, fetch JSON from that URL and
 * deep-merge it on top of `local`. The URL points to a hosted JSON
 * file someone built and shared — once accounts land we can switch
 * the param to a profile id and resolve via our own service.
 *
 * Failures fall through silently with a console warning — the user
 * still gets their local settings.
 */
export async function loadUrlSettings(local: PartialGameConfig): Promise<PartialGameConfig> {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("settings");
  if (!url) return local;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const remote = (await res.json()) as PartialGameConfig;
    console.log(`Settings: applied URL profile from ${url}`);
    return deepMerge<PartialGameConfig>(local, remote);
  } catch (err) {
    console.warn(`Settings: failed to load ?settings=${url} —`, err);
    return local;
  }
}

/**
 * Serialize the current settings to a string and offer it to the user
 * as a downloaded JSON file. Browser-only — uses an in-memory blob URL.
 */
export function exportSettings(settings: PartialGameConfig, filename = "two_5_d-settings.json"): void {
  const json = JSON.stringify(settings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // The browser keeps the URL alive long enough for the download to
  // start before our revoke runs (microtask tick).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Prompt the user to pick a JSON file, parse it, and return the
 * resulting partial settings. Rejects on parse or read error.
 */
export function importSettings(): Promise<PartialGameConfig> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file picked"));
        return;
      }
      try {
        const text = await file.text();
        resolve(JSON.parse(text) as PartialGameConfig);
      } catch (err) {
        reject(err as Error);
      }
    };
    input.click();
  });
}
