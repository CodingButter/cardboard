import React from "react";
import { Button, Modal } from "../components/ui";
import { ToggleSwitch, Slider } from "../components/ui/controls";
import { Select } from "../components/ui/Select";
import { PropertyRow } from "../components/ui/PropertyRow";

/**
 * EditorSettingsModal — opened by the TopBar cog.
 *
 * Per EDITOR_REDESIGN.md §12 Q2 this is **editor-scoped** config (lives
 * in localStorage, applies across every project the user opens).
 * Project-scoped config (manifest metadata, dependencies, export modes,
 * advanced flags) lives in the Project *tab* — wired in R4f, not here.
 *
 * R3 ships a small surface; R4 and later phases may add more keys
 * (telemetry opt-in, theme variants, store credentials). The point of
 * shipping it now is so the cog has somewhere to land.
 */

const STORAGE_PREFIX = "editor.preferences.";

const KEYS = {
  theme: `${STORAGE_PREFIX}theme`,
  accent: `${STORAGE_PREFIX}accent`,
  keybindings: `${STORAGE_PREFIX}keybindings`,
  autoSaveSec: `${STORAGE_PREFIX}autoSaveSec`,
  recentCap: `${STORAGE_PREFIX}recentCap`,
  reduceMotion: `${STORAGE_PREFIX}reduceMotion`,
} as const;

type ThemeId = "dark" | "system";
type AccentId = "amber" | "emerald" | "sky" | "violet";
type KeybindingId = "cardboard" | "vscode";

interface Prefs {
  theme: ThemeId;
  accent: AccentId;
  keybindings: KeybindingId;
  autoSaveSec: number;
  recentCap: number;
  reduceMotion: boolean;
}

const DEFAULTS: Prefs = {
  theme: "dark",
  accent: "amber",
  keybindings: "cardboard",
  autoSaveSec: 1,
  recentCap: 12,
  reduceMotion: false,
};

function readPrefs(): Prefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  const next: Prefs = { ...DEFAULTS };
  try {
    const t = localStorage.getItem(KEYS.theme);
    if (t === "dark" || t === "system") next.theme = t;
    const a = localStorage.getItem(KEYS.accent);
    if (a === "amber" || a === "emerald" || a === "sky" || a === "violet")
      next.accent = a;
    const k = localStorage.getItem(KEYS.keybindings);
    if (k === "cardboard" || k === "vscode") next.keybindings = k;
    const as = Number(localStorage.getItem(KEYS.autoSaveSec));
    if (Number.isFinite(as) && as >= 0 && as <= 30) next.autoSaveSec = as;
    const rc = Number(localStorage.getItem(KEYS.recentCap));
    if (Number.isFinite(rc) && rc >= 1 && rc <= 50) next.recentCap = rc;
    const rm = localStorage.getItem(KEYS.reduceMotion);
    if (rm === "true") next.reduceMotion = true;
  } catch {
    // sandboxed contexts — defaults win, no surfacing needed
  }
  return next;
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort persistence
  }
}

export interface EditorSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function EditorSettingsModal({
  open,
  onClose,
}: EditorSettingsModalProps) {
  // Read prefs once when the modal opens. We don't subscribe to
  // localStorage changes — settings are user-edited only.
  const [prefs, setPrefs] = React.useState<Prefs>(() => readPrefs());

  React.useEffect(() => {
    if (open) setPrefs(readPrefs());
  }, [open]);

  const update = React.useCallback(
    <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
      setPrefs((p) => ({ ...p, [key]: value }));
      writePref(KEYS[key], String(value));
    },
    [],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editor settings"
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 leading-relaxed mb-2">
          Editor preferences live in your browser and apply across every
          project you open. For project-scoped configuration (manifest,
          dependencies, export, advanced) open the{" "}
          <span className="text-zinc-300 font-medium">Project</span> tab.
        </p>

        <PropertyRow
          label="Theme"
          hint="Dark is the only finished look in R3."
        >
          <Select
            value={prefs.theme}
            onChange={(e) => update("theme", e.target.value as ThemeId)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "system", label: "Follow system (coming soon)" },
            ]}
          />
        </PropertyRow>

        <PropertyRow
          label="Accent"
          hint="Active-state highlight color across the editor."
        >
          <Select
            value={prefs.accent}
            onChange={(e) => update("accent", e.target.value as AccentId)}
            options={[
              { value: "amber", label: "Amber (default)" },
              { value: "emerald", label: "Emerald" },
              { value: "sky", label: "Sky" },
              { value: "violet", label: "Violet" },
            ]}
          />
        </PropertyRow>

        <PropertyRow
          label="Keybindings"
          hint="VS Code-style is on the roadmap."
        >
          <Select
            value={prefs.keybindings}
            onChange={(e) =>
              update("keybindings", e.target.value as KeybindingId)
            }
            options={[
              { value: "cardboard", label: "Cardboard (default)" },
              { value: "vscode", label: "VS Code (coming soon)" },
            ]}
          />
        </PropertyRow>

        <PropertyRow
          label="Auto-save"
          hint="Seconds of idle before changes flush to IndexedDB."
        >
          <Slider
            value={prefs.autoSaveSec}
            min={0}
            max={10}
            step={0.5}
            onChange={(v) => update("autoSaveSec", v)}
            valueLabel={`${prefs.autoSaveSec.toFixed(1)}s`}
          />
        </PropertyRow>

        <PropertyRow
          label="Recent projects"
          hint="How many entries Home keeps in the recent list."
        >
          <Slider
            value={prefs.recentCap}
            min={4}
            max={32}
            step={1}
            onChange={(v) => update("recentCap", Math.round(v))}
            valueLabel={`${prefs.recentCap}`}
          />
        </PropertyRow>

        <PropertyRow
          label="Reduce motion"
          hint="Disable non-essential animations and transitions."
        >
          <ToggleSwitch
            checked={prefs.reduceMotion}
            onChange={(v) => update("reduceMotion", v)}
            aria-label="Reduce motion"
          />
        </PropertyRow>
      </div>
    </Modal>
  );
}
