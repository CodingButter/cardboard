import React from "react";
import {
  Brush,
  Circle,
  Dot,
  Minus,
  Plus,
  RectangleHorizontal,
  Slash,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_BRUSHES, type BrushRow } from "../scene-fixtures";

/**
 * BrushPanel — brush kind picker + size stepper.
 *
 * Visual target: the BRUSH dropdown + size slider stack that lived
 * inside the leftmost column of `Editor Design/Map.png`, just under
 * the TOOLS row. Split off from the legacy `ToolsPanel` so brush
 * authoring can dock independently. Wave 2 wires this to the editor's
 * active brush state.
 *
 * Persistence contract (page-scope localStorage):
 *   - `cardboard.scene.brush.activeKind`  string, default first brush id.
 *   - `cardboard.scene.brush.size`        number, default 1 (1..20).
 *
 * Command-registry contract: every clickable affordance ALSO exists
 * as a runtime-registered command so the command palette + global
 * keybinding handler can drive the same actions. The per-brush
 * commands are registered dynamically in a `useEffect` keyed on the
 * brush list so adding/removing a row re-registers cleanly.
 */

/** Brush kind → icon component. The brush "kind" field in
 *  `scene-fixtures.ts` maps onto one of these. New kinds added to the
 *  fixture should add an entry here. */
const BRUSH_ICON_BY_KIND: Record<string, LucideIcon> = {
  point: Dot,
  square: Square,
  circle: Circle,
  line: Slash,
  rect: RectangleHorizontal,
};

const LS_ACTIVE_KIND = "cardboard.scene.brush.activeKind";
const LS_SIZE = "cardboard.scene.brush.size";

const DEFAULT_BRUSH_ID =
  (MOCK_BRUSHES as readonly BrushRow[])[0]?.id ?? "brush-single";
const DEFAULT_SIZE = 1;
const MIN_SIZE = 1;
const MAX_SIZE = 20;

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function findBrush(brushId: string): BrushRow | undefined {
  return (MOCK_BRUSHES as readonly BrushRow[]).find((b) => b.id === brushId);
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

export function BrushPanel(): React.JSX.Element {
  const [activeKind, setActiveKind] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_KIND);
    if (stored && findBrush(stored)) return stored;
    return DEFAULT_BRUSH_ID;
  });

  const [size, setSize] = React.useState<number>(() => {
    const raw = readLS(LS_SIZE);
    if (raw === null) return DEFAULT_SIZE;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampSize(parsed) : DEFAULT_SIZE;
  });

  // Persist on change.
  React.useEffect(() => {
    writeLS(LS_ACTIVE_KIND, activeKind);
  }, [activeKind]);

  React.useEffect(() => {
    writeLS(LS_SIZE, String(size));
  }, [size]);

  // --- Canonical handlers (single source of truth) -----------------
  // Both button onClicks and command `run` delegate to these via
  // handler refs, matching the pattern in `state/README.md`.

  const handleSelectBrush = React.useCallback((brushId: string) => {
    if (!findBrush(brushId)) return;
    setActiveKind(brushId);
  }, []);

  const handleSizeUp = React.useCallback(() => {
    setSize((s) => clampSize(s + 1));
  }, []);

  const handleSizeDown = React.useCallback(() => {
    setSize((s) => clampSize(s - 1));
  }, []);

  const handleSizeSet = React.useCallback((next: number) => {
    setSize(clampSize(next));
  }, []);

  // --- Command-registry refs ---------------------------------------
  // Keep refs current so the registration effects don't need to
  // re-run on every handler identity change.
  const selectBrushRef = React.useRef(handleSelectBrush);
  const sizeUpRef = React.useRef(handleSizeUp);
  const sizeDownRef = React.useRef(handleSizeDown);

  React.useEffect(() => {
    selectBrushRef.current = handleSelectBrush;
  }, [handleSelectBrush]);
  React.useEffect(() => {
    sizeUpRef.current = handleSizeUp;
  }, [handleSizeUp]);
  React.useEffect(() => {
    sizeDownRef.current = handleSizeDown;
  }, [handleSizeDown]);

  // Static commands (size up / down). Registered once on mount.
  React.useEffect(() => {
    const unregUp = registerCommand({
      id: "scene.brush.sizeUp",
      title: "Increase Brush Size",
      category: "Brush",
      keywords: ["brush", "size", "increase", "bigger", "grow"],
      icon: <Plus size={14} />,
      run: () => sizeUpRef.current(),
    });
    const unregDown = registerCommand({
      id: "scene.brush.sizeDown",
      title: "Decrease Brush Size",
      category: "Brush",
      keywords: ["brush", "size", "decrease", "smaller", "shrink"],
      icon: <Minus size={14} />,
      run: () => sizeDownRef.current(),
    });
    return () => {
      unregUp();
      unregDown();
    };
  }, []);

  // Dynamic per-brush commands. Re-registers when the brush list
  // identity changes; returns an unregister array per
  // `state/README.md`'s "Dynamic registrations" pattern.
  React.useEffect(() => {
    const unregs = (MOCK_BRUSHES as readonly BrushRow[]).map((b) =>
      registerCommand({
        id: `scene.brush.set.${b.id}`,
        title: `Set Brush: ${b.name}`,
        category: "Brush",
        keywords: ["brush", "set", b.name, b.kind],
        description: b.description,
        run: () => selectBrushRef.current(b.id),
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
    // MOCK_BRUSHES is a module-level constant today; including it in
    // deps documents the dependency for the day this turns into a
    // live store selector. Identity is stable per module load.
  }, []);

  const sizeAtMin = size <= MIN_SIZE;
  const sizeAtMax = size >= MAX_SIZE;

  // Outer container is just the `data-panel` hook. DockShell wraps
  // this in `<PanelSurface/>` (raised card with p-2 inner padding),
  // so this wrapper only owns layout (flex column + gap between the
  // brush-kind grid and the size stepper), NOT padding or surface
  // styling.
  return (
    <div
      data-panel="brush"
      className="h-full w-full flex flex-col gap-2 overflow-y-auto"
    >
      {/*
        Brush-kind tile grid. Same auto-fit/minmax pattern as the
        ToolPalette tile grid, with slightly larger tiles (40–56px)
        because brushes are higher-information than tools: the icon
        carries the entire signal. `auto-fit` lets the browser pick
        column count to match available panel width — single column
        at ~150px, several columns at 400px+. No native horizontal
        scroll is possible since the grid wraps.
      */}
      <div
        className="grid gap-1"
        role="radiogroup"
        aria-label="Brush kind"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(40px, 56px))",
        }}
      >
        {(MOCK_BRUSHES as readonly BrushRow[]).map((b) => {
          const Icon = BRUSH_ICON_BY_KIND[b.kind] ?? Brush;
          const active = b.id === activeKind;
          return (
            <Tooltip
              key={b.id}
              side="right"
              stages={[
                { delay: 2000, content: <span>{b.name}</span> },
                {
                  delay: 5000,
                  content: (
                    <div>
                      <div className="font-semibold">{b.name}</div>
                      {b.description && (
                        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                          {b.description}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                role="radio"
                aria-label={b.name}
                aria-checked={active}
                onClick={() => handleSelectBrush(b.id)}
                className={[
                  "aspect-square w-full rounded",
                  "flex items-center justify-center",
                  "border transition-colors",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                <Icon size={18} aria-hidden="true" />
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/*
        Size stepper row. Layout strategy: [−] [size readout] [+] as
        flex children. The numeric input in the middle is `flex-1` so
        it absorbs slack at wide widths but the minus/plus buttons
        keep their square shape. min-w-0 on the input prevents it
        from forcing the row to overflow when the panel narrows past
        ~150px.
      */}
      <div className="flex flex-col gap-1 pt-1">
        <div className="text-[10px] uppercase tracking-wide text-(--color-fg-muted)">
          Size
        </div>
        <div className="flex items-stretch gap-1">
          <Tooltip
            side="top"
            stages={[
              { delay: 2000, content: <span>Decrease size</span> },
              {
                delay: 5000,
                content: (
                  <div>
                    <div className="font-semibold">Decrease Brush Size</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                      Steps the brush size down by 1 (minimum {MIN_SIZE}).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Decrease brush size"
              disabled={sizeAtMin}
              onClick={handleSizeDown}
              className={[
                "h-7 w-7 shrink-0 rounded",
                "flex items-center justify-center",
                "border transition-colors",
                sizeAtMin
                  ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-50 cursor-not-allowed"
                  : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
              ].join(" ")}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
          </Tooltip>

          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            value={size}
            aria-label="Brush size"
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(parsed)) handleSizeSet(parsed);
            }}
            className={[
              "flex-1 min-w-0 h-7 px-2 rounded",
              "text-center text-xs tabular-nums",
              "bg-transparent border border-(--color-border-strong)",
              "text-(--color-fg-primary)",
              "focus:outline-none focus:border-amber-500/80",
              // Hide the native number-input spinners — we render our
              // own +/- buttons; the spinners would compete visually
              // and add unpredictable width.
              "[appearance:textfield]",
              "[&::-webkit-inner-spin-button]:appearance-none",
              "[&::-webkit-outer-spin-button]:appearance-none",
            ].join(" ")}
          />

          <Tooltip
            side="top"
            stages={[
              { delay: 2000, content: <span>Increase size</span> },
              {
                delay: 5000,
                content: (
                  <div>
                    <div className="font-semibold">Increase Brush Size</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                      Steps the brush size up by 1 (maximum {MAX_SIZE}).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Increase brush size"
              disabled={sizeAtMax}
              onClick={handleSizeUp}
              className={[
                "h-7 w-7 shrink-0 rounded",
                "flex items-center justify-center",
                "border transition-colors",
                sizeAtMax
                  ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-50 cursor-not-allowed"
                  : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
              ].join(" ")}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>

        {/*
          Slider mirrors the input — gives a "feel" the input doesn't,
          especially at wide panel widths. Themed via the design-system
          tokens; the native `<input type="range">` is acceptable here
          because the user never gets a horizontal scrollbar, and the
          accent token paints the thumb consistently with the rest of
          the editor chrome.
        */}
        <input
          type="range"
          min={MIN_SIZE}
          max={MAX_SIZE}
          step={1}
          value={size}
          aria-label="Brush size (slider)"
          onChange={(e) => handleSizeSet(Number.parseInt(e.target.value, 10))}
          className="w-full accent-amber-500"
        />
      </div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "brush",
  title: "Brush",
  icon: <Brush size={12} />,
};

export default BrushPanel;
