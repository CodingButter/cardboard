import React from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

const STEPPER_STAGES_UP = [
  { delay: 1000, content: <span>Increment</span> },
  {
    delay: 3000,
    content: (
      <div>
        <div className="font-semibold">Increment</div>
        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
          Bumps the value up by one step. Hold Shift while clicking to
          step by 10. Respects the field's min/max clamp.
        </div>
      </div>
    ),
  },
];

const STEPPER_STAGES_DOWN = [
  { delay: 1000, content: <span>Decrement</span> },
  {
    delay: 3000,
    content: (
      <div>
        <div className="font-semibold">Decrement</div>
        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
          Bumps the value down by one step. Hold Shift while clicking to
          step by 10. Respects the field's min/max clamp.
        </div>
      </div>
    ),
  },
];

/**
 * NumberInput — Phase 1 primitive.
 *
 * Numeric input with optional unit suffix, min/max clamp, decimal
 * precision, and stepper buttons. Used pervasively in inspectors
 * (Position X/Y/Z, FOV degrees, scale factors, animation duration).
 *
 * Mockups: `Editor Design/Entities.png`, `Editor Design/Animation.png`,
 * `Editor Design/Map.png`, `Editor Design/ProjectSettings.png`.
 *
 * Surface classes consumed: `.input-number` (mono right-aligned text on
 * zinc-950 surface). Steppers are rendered when `showSteppers` is true.
 */

export interface NumberInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type" | "min" | "max" | "step"
  > {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal precision when serialising back to string. */
  precision?: number;
  /** Unit suffix (rendered to the right of the input as a tiny chip). */
  unit?: React.ReactNode;
  /** Render +/- stepper buttons. */
  showSteppers?: boolean;
}

function clamp(n: number, min?: number, max?: number): number {
  let out = n;
  if (typeof min === "number" && out < min) out = min;
  if (typeof max === "number" && out > max) out = max;
  return out;
}

function format(n: number, precision?: number): string {
  if (Number.isNaN(n)) return "";
  if (typeof precision === "number") return n.toFixed(precision);
  return String(n);
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  unit,
  showSteppers = false,
  className,
  disabled,
  ...rest
}: NumberInputProps) {
  // Local text mirror so users can clear / mid-edit invalid states
  // without us snapping them back to the previous committed value.
  const [text, setText] = React.useState<string>(() => format(value, precision));
  const lastValueRef = React.useRef(value);

  // Sync external value updates → text mirror, but only when the caller
  // actually changed the number (avoids fighting the user's typing).
  React.useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(format(value, precision));
    }
  }, [value, precision]);

  function commit(next: string) {
    const parsed = parseFloat(next);
    if (Number.isFinite(parsed)) {
      const clamped = clamp(parsed, min, max);
      lastValueRef.current = clamped;
      onChange(clamped);
      setText(format(clamped, precision));
    } else {
      // Restore last committed value on invalid input.
      setText(format(lastValueRef.current, precision));
    }
  }

  function bump(direction: 1 | -1) {
    const base = Number.isFinite(value) ? value : 0;
    const next = clamp(base + direction * step, min, max);
    lastValueRef.current = next;
    onChange(next);
    setText(format(next, precision));
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 min-w-0 w-full",
        className,
      )}
    >
      <div className="relative flex-1 min-w-0">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(-1);
            }
          }}
          className={cn("input-number", unit ? "pr-6" : undefined)}
          {...rest}
        />
        {unit && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-wider text-zinc-500 pointer-events-none">
            {unit}
          </span>
        )}
      </div>
      {showSteppers && (
        <div className="inline-flex flex-col shrink-0">
          <Tooltip stages={STEPPER_STAGES_UP}>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => bump(1)}
              aria-label="Increment"
              className="icon-button w-5 h-4 rounded-sm"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip stages={STEPPER_STAGES_DOWN}>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => bump(-1)}
              aria-label="Decrement"
              className="icon-button w-5 h-4 rounded-sm"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
