/* @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";
import type { GameConfig } from "GameConfig";
import type { KeyBindings } from "Components";
import type { KeyCode } from "Controllers/KeyboardController";
import { bindingLabel } from "Controllers/Bindings";
import type { PartialGameConfig } from "Settings";
import { exportSettings, importSettings } from "Settings";

/**
 * User-facing settings modal. The settings system passes in:
 *
 *   - `live` — the in-memory merged CONFIG. Used as the source of
 *     truth for current values displayed in the UI (so sliders show
 *     the running game's actual FOV / sensitivity / etc.).
 *   - `onChange(mut)` — call with a mutator that updates the
 *     persisted overlay. The system handles saving + applying.
 *   - `onClose` — close the modal.
 *
 * Fields are split into:
 *   - "Live" — applying mutates CONFIG and is visible on the next
 *     frame (e.g. mouse sensitivity, jump, bindings).
 *   - "Reload required" — engine modules captured the value at boot;
 *     a hard refresh is needed for the change to take effect.
 */

export interface SettingsScreenProps {
  live: GameConfig;
  overlay: PartialGameConfig;
  onChange: (mut: (s: PartialGameConfig) => void) => void;
  onClose: () => void;
}

/** Action key → human label, in display order. */
const BINDING_LABELS: Record<keyof KeyBindings, string> = {
  forward: "Move forward",
  backward: "Move backward",
  strafeLeft: "Strafe left",
  strafeRight: "Strafe right",
  run: "Run",
  jump: "Jump",
  crouch: "Crouch",
};

export function SettingsScreen({ live, overlay, onChange, onClose }: SettingsScreenProps) {
  /** Capture target: `{ action, slotIndex }`. Null = not capturing. */
  const [capturing, setCapturing] = useState<{ action: keyof KeyBindings; slot: number } | null>(
    null,
  );
  const [tab, setTab] = useState<"controls" | "graphics" | "io">("controls");
  // Reactivity for in-place CONFIG mutation: bump this on each
  // onChange so sliders / chips re-render with the new values.
  const [_, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  // While capturing, the next key OR mouse-button press becomes the
  // new binding. Mouse buttons are encoded as `Mouse0..Mouse4` so the
  // KeyBindings shape stays uniform.
  useEffect(() => {
    if (!capturing) return;
    const commit = (code: KeyCode) => {
      onChange((s) => {
        const b = (s.bindings ??= {}) as Partial<KeyBindings>;
        const current = (b[capturing.action] as KeyCode[] | undefined) ??
          ([...live.bindings[capturing.action]] as KeyCode[]);
        const next = [...current];
        next[capturing.slot] = code;
        b[capturing.action] = next;
      });
      setCapturing(null);
      bump();
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(null);
        return;
      }
      commit(e.code as KeyCode);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      commit(`Mouse${e.button}` as KeyCode);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
    };
  }, [capturing, onChange, live]);

  // Escape closes the modal (when not capturing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturing) return;
      if (e.code === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onClose]);

  return (
    <div
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="flex w-[640px] max-w-[90vw] flex-col gap-3 rounded-lg border border-amber-700/60 bg-zinc-900/95 p-5 text-zinc-200 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            class="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
          >
            Esc to close
          </button>
        </div>

        <div class="flex gap-1 border-b border-zinc-800">
          {(["controls", "graphics", "io"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              class={`-mb-px px-3 py-2 text-sm capitalize ${
                tab === id
                  ? "border-b-2 border-amber-400 text-amber-200"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {id === "io" ? "Import / Export" : id}
            </button>
          ))}
        </div>

        {tab === "controls" && (
          <ControlsTab
            live={live}
            capturing={capturing}
            setCapturing={setCapturing}
            onChange={onChange}
            bump={bump}
          />
        )}
        {tab === "graphics" && <GraphicsTab live={live} onChange={onChange} bump={bump} />}
        {tab === "io" && <IoTab overlay={overlay} onChange={onChange} bump={bump} />}
      </div>
    </div>
  );
}

/* ─── Tabs ─────────────────────────────────────────────────────────── */

function ControlsTab({
  live,
  capturing,
  setCapturing,
  onChange,
  bump,
}: {
  live: GameConfig;
  capturing: { action: keyof KeyBindings; slot: number } | null;
  setCapturing: (v: { action: keyof KeyBindings; slot: number } | null) => void;
  onChange: (mut: (s: PartialGameConfig) => void) => void;
  bump: () => void;
}) {
  // Build a code → list-of-actions index so we can highlight bindings
  // that conflict with another action. Storing the friendly action
  // labels makes the tooltip useful without further lookups.
  const conflictIndex = new Map<KeyCode, string[]>();
  for (const a of Object.keys(BINDING_LABELS) as (keyof KeyBindings)[]) {
    for (const code of live.bindings[a] as readonly KeyCode[]) {
      const list = conflictIndex.get(code) ?? [];
      list.push(BINDING_LABELS[a]);
      conflictIndex.set(code, list);
    }
  }

  return (
    <div class="flex flex-col gap-4">
      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Bindings</h3>
        <p class="text-xs text-zinc-500">
          Click a binding then press any key OR mouse button. Yellow border = also
          used by another action.
        </p>
        <table class="w-full text-sm">
          <tbody>
            {(Object.keys(BINDING_LABELS) as (keyof KeyBindings)[]).map((action) => {
              const codes = live.bindings[action] as readonly KeyCode[];
              return (
                <tr key={action} class="border-t border-zinc-800">
                  <td class="py-2 pr-3 text-zinc-300">{BINDING_LABELS[action]}</td>
                  <td class="py-2">
                    <div class="flex flex-wrap gap-1">
                      {codes.map((code, i) => {
                        const isCapturing =
                          capturing?.action === action && capturing.slot === i;
                        const sharing = (conflictIndex.get(code) ?? []).filter(
                          (label) => label !== BINDING_LABELS[action],
                        );
                        const hasConflict = sharing.length > 0;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setCapturing({ action, slot: i })}
                            title={
                              hasConflict
                                ? `Also bound to: ${sharing.join(", ")}`
                                : undefined
                            }
                            class={`rounded border px-2 py-1 text-xs ${
                              isCapturing
                                ? "border-amber-400 bg-amber-400/20 text-amber-100"
                                : hasConflict
                                  ? "border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:border-yellow-300"
                                  : "border-zinc-700 bg-zinc-800 hover:border-amber-500"
                            }`}
                          >
                            {isCapturing ? "press a key or button…" : bindingLabel(code)}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          onChange((s) => {
                            const b = (s.bindings ??= {}) as Partial<KeyBindings>;
                            const next: KeyCode[] = [
                              ...((b[action] as KeyCode[] | undefined) ??
                                ([...codes] as KeyCode[])),
                              "Space",
                            ];
                            b[action] = next;
                          });
                          setCapturing({ action, slot: codes.length });
                          bump();
                        }}
                        class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-amber-500 hover:text-zinc-100"
                      >
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">Mouse</h3>
        <Slider
          label="Sensitivity"
          min={5}
          max={100}
          step={1}
          value={live.reticle.sensitivity}
          onChange={(v) => {
            onChange((s) => ((s.reticle ??= {}).sensitivity = v));
            bump();
          }}
          live
        />
        <Toggle
          label="Invert Y"
          value={live.reticle.invertY}
          onChange={(v) => {
            onChange((s) => ((s.reticle ??= {}).invertY = v));
            bump();
          }}
          live
        />
      </section>
    </div>
  );
}

function GraphicsTab({
  live,
  onChange,
  bump,
}: {
  live: GameConfig;
  onChange: (mut: (s: PartialGameConfig) => void) => void;
  bump: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3 text-sm">
        <span class="w-44 text-zinc-300">Display</span>
        <button
          type="button"
          class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-left hover:border-amber-500"
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(() => {});
            } else {
              document.body.requestFullscreen().catch((err) => {
                console.warn("Fullscreen request failed:", err);
              });
            }
            bump();
          }}
        >
          {document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen"}
        </button>
        <span class="text-[10px] text-emerald-400">LIVE</span>
      </div>
      <Slider
        label="Resolution scale"
        min={0.25}
        max={1}
        step={0.05}
        value={live.rendering.resolutionScale}
        onChange={(v) => {
          onChange((s) => ((s.rendering ??= {}).resolutionScale = v));
          // Resize takes effect on the next frame via `Game.fitCanvasToWindow`,
          // which reads CONFIG.rendering.resolutionScale. Trigger it now by
          // dispatching a synthetic resize.
          window.dispatchEvent(new Event("resize"));
          bump();
        }}
        live
      />
      <Slider
        label="Field of view (°)"
        min={40}
        max={110}
        step={1}
        value={live.camera.fovDegrees}
        onChange={(v) => {
          onChange((s) => ((s.camera ??= {}).fovDegrees = v));
          bump();
        }}
        live
      />
      <Slider
        label="Fog distance (tiles)"
        min={4}
        max={48}
        step={1}
        value={live.camera.fogDistance}
        onChange={(v) => {
          onChange((s) => ((s.camera ??= {}).fogDistance = v));
          bump();
        }}
        live
      />
      <Slider
        label="Pitch (look up/down ratio)"
        min={0}
        max={1}
        step={0.05}
        value={live.camera.pitchFraction}
        onChange={(v) => {
          onChange((s) => ((s.camera ??= {}).pitchFraction = v));
          bump();
        }}
        live
      />
      <Toggle
        label="Bilinear texture filtering"
        value={live.rendering.bilinearFiltering}
        onChange={(v) => {
          onChange((s) => ((s.rendering ??= {}).bilinearFiltering = v));
          bump();
        }}
        live
      />
      <Select
        label="Renderer backend"
        value={live.rendering.backend}
        options={[
          { value: "canvas2d", label: "Canvas2D (CPU)" },
          { value: "webgl", label: "WebGL2 (GPU)" },
        ]}
        onChange={(v) => {
          if (v === live.rendering.backend) return;
          // Canvas context type is fixed after the first getContext call,
          // so swapping backends in place isn't possible. Persist + reload
          // so the new renderer is built against the chosen backend.
          onChange((s) => ((s.rendering ??= {}).backend = v as "canvas2d" | "webgl"));
          window.location.reload();
        }}
      />
      <p class="text-xs text-zinc-500">
        Items marked <span class="text-emerald-400">LIVE</span> take effect
        immediately. Switching renderer reloads the page automatically.
      </p>
    </div>
  );
}

function IoTab({
  overlay,
  onChange,
  bump,
}: {
  overlay: PartialGameConfig;
  onChange: (mut: (s: PartialGameConfig) => void) => void;
  bump: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-zinc-300">
        Settings persist to your browser's local storage. Use export to
        share a profile or save a backup; import to restore one.
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm hover:border-amber-500"
          onClick={() => exportSettings(overlay)}
        >
          Export JSON
        </button>
        <button
          type="button"
          class="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm hover:border-amber-500"
          onClick={async () => {
            try {
              const imported = await importSettings();
              onChange((s) => {
                // Replace, don't merge — the imported file is the
                // user's intentional new state.
                for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k];
                Object.assign(s, imported);
              });
              bump();
            } catch (err) {
              console.warn("Import failed:", err);
            }
          }}
        >
          Import JSON
        </button>
        <button
          type="button"
          class="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200 hover:border-red-500"
          onClick={() => {
            if (!confirm("Reset all settings to defaults? Pack-supplied values stay.")) return;
            onChange((s) => {
              for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k];
            });
            bump();
          }}
        >
          Reset to defaults
        </button>
      </div>
      <p class="text-xs text-zinc-500">
        Tip: append <code class="rounded bg-zinc-800 px-1">?settings=&lt;url&gt;</code> to the
        game URL to load a hosted profile.
      </p>
      <details class="rounded border border-zinc-800 bg-zinc-950/50 p-2 text-xs">
        <summary class="cursor-pointer text-zinc-400">Current overlay (saved to localStorage)</summary>
        <pre class="mt-2 max-h-48 overflow-auto text-zinc-300">
          {JSON.stringify(overlay, null, 2) || "(empty)"}
        </pre>
      </details>
    </div>
  );
}

/* ─── Inputs ───────────────────────────────────────────────────────── */

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  live,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  live?: boolean;
}) {
  return (
    <label class="flex items-center gap-3 text-sm">
      <span class="w-44 text-zinc-300">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
        class="flex-1"
      />
      <span class="w-12 text-right tabular-nums text-zinc-400">{value}</span>
      {live && <span class="text-[10px] text-emerald-400">LIVE</span>}
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
  live,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  live?: boolean;
}) {
  return (
    <label class="flex items-center gap-3 text-sm">
      <span class="w-44 text-zinc-300">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      {live && <span class="text-[10px] text-emerald-400">LIVE</span>}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label class="flex items-center gap-3 text-sm">
      <span class="w-44 text-zinc-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
        class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
