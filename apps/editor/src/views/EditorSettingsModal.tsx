import React from "react";
import { Button, Modal } from "../components/ui";
import { ToggleSwitch, Slider } from "../components/ui/controls";
import { Select } from "../components/ui/Select";
import { PropertyRow } from "../components/ui/PropertyRow";
import { NumberInput } from "../components/ui/NumberInput";
import { TextInput } from "../components/ui/TextInput";
import { TabStrip, type TabDescriptor } from "../components/ui/TabStrip";
import {
  registerSetting,
  useSettingsStore,
  useSettingsList,
  type EditorSetting,
} from "../state/useSettingsStore";
import { ExtensionsTab } from "./settings/ExtensionsTab";

/**
 * EditorSettingsModal — opened by the TopBar cog.
 *
 * REGISTRY-DRIVEN RENDERING
 * -------------------------
 * This modal renders entirely from `useSettingsStore`. Each component
 * that owns a tunable preference registers it with `registerSetting({...})`
 * in a `useEffect(() => registerSetting(...), [])`; this modal iterates
 * `useSettingsStore(s => s.settings)` filtered by scope, picks a control
 * per `type`, and writes back via `setSettingsStore.get/set`.
 *
 * The contract: ANY future `registerSetting` call with `scope: 'global'`
 * (or no scope — defaults to global) automatically appears here, in the
 * order it was registered, grouped by `category`. Adding a new tunable
 * is a one-line change at the registration callsite — no edit to this
 * file required.
 *
 * Registration happens in two ways:
 *   1. Component-local: a view registers its own setting from inside its
 *      `useEffect`. The setting lives only while the view is mounted.
 *   2. Module-level (this file): we bootstrap the editor's GLOBAL prefs
 *      (theme, accent, keybindings, auto-save, recent cap, reduce motion)
 *      from a `useEffect` so they're always present, regardless of which
 *      views are mounted.
 *
 * Per EDITOR_REDESIGN.md §12 Q2 the modal is **editor-scoped** config
 * (lives in localStorage, applies across every project the user opens).
 * Project-scoped config (manifest metadata, dependencies, export modes,
 * advanced flags) lives in the Project *tab* — wired in R4f, not here.
 *
 * BACK-COMPAT WITH LEGACY STORAGE KEYS
 * ------------------------------------
 * The original modal wrote to `editor.preferences.<key>` localStorage
 * entries directly. The registry now owns persistence (via `useSettingsStore`'s
 * `persist` middleware), but we keep mirror-writes to the legacy keys on
 * change so any other code path that reads them keeps working. Reads
 * prefer the legacy key on first mount (one-time hydration into the
 * registry) so existing user state isn't blown away.
 */

const LEGACY_STORAGE_PREFIX = "editor.preferences.";

const LEGACY_KEYS = {
  "editor.theme": `${LEGACY_STORAGE_PREFIX}theme`,
  "editor.accent": `${LEGACY_STORAGE_PREFIX}accent`,
  "editor.keybindings": `${LEGACY_STORAGE_PREFIX}keybindings`,
  "editor.autoSaveSec": `${LEGACY_STORAGE_PREFIX}autoSaveSec`,
  "editor.recentCap": `${LEGACY_STORAGE_PREFIX}recentCap`,
  "editor.reduceMotion": `${LEGACY_STORAGE_PREFIX}reduceMotion`,
} as const;

/**
 * Hydrate the registry's value store from the legacy localStorage keys.
 * Runs once per session — subsequent updates flow through the registry's
 * own persistence layer. Idempotent: if the registry already has a value
 * for a key, we leave it alone.
 */
function hydrateFromLegacyKeys(): void {
  if (typeof window === "undefined") return;
  const store = useSettingsStore.getState();
  const tryRead = (id: keyof typeof LEGACY_KEYS): string | null => {
    try {
      return localStorage.getItem(LEGACY_KEYS[id]);
    } catch {
      return null;
    }
  };
  // Theme
  if (store.values["editor.theme"] === undefined) {
    const v = tryRead("editor.theme");
    if (v === "dark" || v === "system") store.set("editor.theme", v);
  }
  // Accent
  if (store.values["editor.accent"] === undefined) {
    const v = tryRead("editor.accent");
    if (v === "amber" || v === "emerald" || v === "sky" || v === "violet") {
      store.set("editor.accent", v);
    }
  }
  // Keybindings
  if (store.values["editor.keybindings"] === undefined) {
    const v = tryRead("editor.keybindings");
    if (v === "cardboard" || v === "vscode") store.set("editor.keybindings", v);
  }
  // Auto-save — only hydrate when the legacy key actually has a value;
  // a missing key (null) coerces to 0 via Number(null), which would
  // silently clobber the registered default. Same trap for recent cap.
  if (store.values["editor.autoSaveSec"] === undefined) {
    const raw = tryRead("editor.autoSaveSec");
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 30) {
        store.set("editor.autoSaveSec", v);
      }
    }
  }
  // Recent cap
  if (store.values["editor.recentCap"] === undefined) {
    const raw = tryRead("editor.recentCap");
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 1 && v <= 50) {
        store.set("editor.recentCap", v);
      }
    }
  }
  // Reduce motion
  if (store.values["editor.reduceMotion"] === undefined) {
    const v = tryRead("editor.reduceMotion");
    if (v === "true") store.set("editor.reduceMotion", true);
    else if (v === "false") store.set("editor.reduceMotion", false);
  }
}

/**
 * Bootstrap the editor's global settings on mount of the modal owner.
 * Returns a cleanup that unregisters every setting (mirrors VSCode's
 * contributes/configuration disposable pattern).
 */
function registerGlobalEditorSettings(): () => void {
  const unregs: Array<() => void> = [];
  unregs.push(
    registerSetting<"dark" | "system">({
      id: "editor.theme",
      title: "Theme",
      category: "Appearance",
      description: "Dark is the only finished look in R3.",
      type: "select",
      default: "dark",
      options: [
        { label: "Dark", value: "dark" },
        { label: "Follow system (coming soon)", value: "system" },
      ],
      scope: "global",
    }),
    registerSetting<"amber" | "emerald" | "sky" | "violet">({
      id: "editor.accent",
      title: "Accent",
      category: "Appearance",
      description: "Active-state highlight color across the editor.",
      type: "select",
      default: "amber",
      options: [
        { label: "Amber (default)", value: "amber" },
        { label: "Emerald", value: "emerald" },
        { label: "Sky", value: "sky" },
        { label: "Violet", value: "violet" },
      ],
      scope: "global",
    }),
    registerSetting<"cardboard" | "vscode">({
      id: "editor.keybindings",
      title: "Keybindings",
      category: "Input",
      description: "VS Code-style is on the roadmap.",
      type: "select",
      default: "cardboard",
      options: [
        { label: "Cardboard (default)", value: "cardboard" },
        { label: "VS Code (coming soon)", value: "vscode" },
      ],
      scope: "global",
    }),
    registerSetting<number>({
      id: "editor.autoSaveSec",
      title: "Auto-save",
      category: "Files",
      description: "Seconds of idle before changes flush to IndexedDB.",
      type: "number",
      default: 1,
      scope: "global",
    }),
    registerSetting<number>({
      id: "editor.recentCap",
      title: "Recent projects",
      category: "Home",
      description: "How many entries Home keeps in the recent list.",
      type: "number",
      default: 12,
      scope: "global",
    }),
    registerSetting<boolean>({
      id: "editor.reduceMotion",
      title: "Reduce motion",
      category: "Appearance",
      description: "Disable non-essential animations and transitions.",
      type: "boolean",
      default: false,
      scope: "global",
    }),
  );
  return () => unregs.forEach((u) => u());
}

export interface EditorSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Top-level tabs inside the Editor Settings modal. */
type SettingsTabId = "general" | "extensions";

const SETTINGS_TABS: ReadonlyArray<TabDescriptor<SettingsTabId>> = [
  {
    id: "general",
    label: "General",
    tooltipLabel: "General",
    tooltipDescription:
      "Editor-scope preferences (theme, accent, keybindings, files, motion).",
  },
  {
    id: "extensions",
    label: "Extensions",
    tooltipLabel: "Extensions",
    tooltipDescription:
      "Manage installed editor packs — enable or disable contributed panels and tools.",
  },
];

export function EditorSettingsModal({
  open,
  onClose,
}: EditorSettingsModalProps) {
  // Register the canonical editor settings and hydrate values from the
  // legacy localStorage entries on first mount. Both happen once per
  // EditorSettingsModal lifetime — typically the entire shell session.
  React.useEffect(() => {
    hydrateFromLegacyKeys();
    return registerGlobalEditorSettings();
  }, []);

  const [tab, setTab] = React.useState<SettingsTabId>("general");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editor settings"
      width="lg"
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Sub-tab strip. `secondary` variant matches the in-modal
            grouping pattern used elsewhere (LayoutsModal, ProjectSettings). */}
        <TabStrip
          variant="secondary"
          tabs={SETTINGS_TABS}
          value={tab}
          onChange={setTab}
          aria-label="Editor settings sections"
        />

        {tab === "general" ? <GeneralTab /> : null}
        {tab === "extensions" ? <ExtensionsTab /> : null}
      </div>
    </Modal>
  );
}

/**
 * GeneralTab — the registry-driven settings form that previously lived
 * directly in the modal body. Renders every `scope: "global"` setting
 * grouped by category. New tunables appear here automatically when
 * their owning component calls `registerSetting({...})`.
 */
function GeneralTab() {
  // Reactive list of registered global settings. Project- and page-
  // scoped settings render in their respective modals (Project tab,
  // page settings) — not this one.
  const globalSettings = useSettingsList("global");

  // Group by category so the modal reads as a structured form rather
  // than a flat dump. Categories sort alphabetically except "Account"
  // last (a user's name/avatar feels more "down the page" than core
  // appearance toggles).
  const grouped = React.useMemo(() => {
    const out: Record<string, EditorSetting[]> = {};
    for (const s of globalSettings) {
      const key = s.category ?? "Other";
      const bucket = out[key] ?? (out[key] = []);
      bucket.push(s);
    }
    const order = Object.keys(out).sort((a, b) => {
      if (a === "Account") return 1;
      if (b === "Account") return -1;
      return a.localeCompare(b);
    });
    return order.map((cat) => ({ category: cat, items: out[cat]! }));
  }, [globalSettings]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500 leading-relaxed">
        Editor preferences live in your browser and apply across every
        project you open. For project-scoped configuration (manifest,
        dependencies, export, advanced) open the{" "}
        <span className="text-zinc-300 font-medium">Project</span> tab.
      </p>

      {grouped.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No editor settings have been registered.
        </p>
      ) : null}

      {grouped.map((group) => (
        <section key={group.category} className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
            {group.category}
          </h3>
          <div className="space-y-1">
            {group.items.map((setting) => (
              <SettingRow key={setting.id} setting={setting} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Single registry-driven row. Picks a control per `setting.type` and
 * wires it to `useSettingsStore.get / set`. Mirror-writes to the legacy
 * `editor.preferences.<key>` localStorage entries so callsites that
 * still read directly keep working until they migrate to the registry.
 */
function SettingRow({ setting }: { setting: EditorSetting }) {
  const value = useSettingsStore((s) =>
    s.values[setting.id] !== undefined ? s.values[setting.id] : setting.default,
  );

  const commit = React.useCallback(
    (next: unknown) => {
      useSettingsStore.getState().set(setting.id, next);
      // Mirror to legacy key if one exists.
      const legacyKey =
        LEGACY_KEYS[setting.id as keyof typeof LEGACY_KEYS] ?? null;
      if (legacyKey) {
        try {
          localStorage.setItem(legacyKey, String(next));
        } catch {
          // best-effort
        }
      }
    },
    [setting.id],
  );

  return (
    <PropertyRow label={setting.title} hint={setting.description}>
      {renderControl(setting, value, commit)}
    </PropertyRow>
  );
}

function renderControl(
  setting: EditorSetting,
  value: unknown,
  commit: (next: unknown) => void,
): React.ReactNode {
  switch (setting.type) {
    case "boolean":
      return (
        <ToggleSwitch
          checked={Boolean(value)}
          onChange={(v) => commit(v)}
          aria-label={setting.title}
        />
      );
    case "number": {
      // Use Slider for numeric tunables when the setting carries a
      // sensible range encoded as `options` (label/min, label/max pair).
      // Otherwise fall back to a NumberInput. The current global
      // settings (autoSaveSec, recentCap) want slider UX so we infer
      // ranges from the setting id — a heuristic that works for the
      // bootstrapped settings without burdening new registrations.
      const range = inferNumericRange(setting.id);
      // Coerce undefined/null/NaN to the setting's default so the slider
      // never lands on 0 when the user hasn't touched the value yet.
      const numeric = Number(value);
      const safeValue = Number.isFinite(numeric)
        ? numeric
        : (setting.default as number);
      if (range) {
        return (
          <Slider
            value={safeValue}
            min={range.min}
            max={range.max}
            step={range.step}
            onChange={(v) =>
              commit(range.step < 1 ? v : Math.round(v))
            }
            valueLabel={range.format(safeValue)}
          />
        );
      }
      return (
        <NumberInput
          value={safeValue}
          onChange={(v) => commit(v)}
        />
      );
    }
    case "select":
      return (
        <Select
          value={String(value)}
          onChange={(e) => commit(e.target.value)}
          options={(setting.options ?? []).map((opt) => ({
            value: String(opt.value),
            label: opt.label,
          }))}
        />
      );
    case "string":
    default:
      return (
        <TextInput
          value={String(value ?? "")}
          onChange={(e) => commit(e.target.value)}
        />
      );
  }
}

/**
 * Inferred slider ranges for the bootstrapped numeric settings. New
 * settings can opt in by adding an entry here, OR by switching their
 * `type: "number"` to render a plain NumberInput (the default fallback).
 */
function inferNumericRange(id: string):
  | { min: number; max: number; step: number; format: (v: number) => string }
  | null {
  if (id === "editor.autoSaveSec") {
    return {
      min: 0,
      max: 10,
      step: 0.5,
      format: (v) => `${v.toFixed(1)}s`,
    };
  }
  if (id === "editor.recentCap") {
    return {
      min: 4,
      max: 32,
      step: 1,
      format: (v) => `${Math.round(v)}`,
    };
  }
  return null;
}
