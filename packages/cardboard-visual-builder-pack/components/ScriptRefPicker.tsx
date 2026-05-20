/**
 * ScriptRefPicker — VB5 autocomplete control for `onClick.script` /
 * any `ScriptRef.script` field.
 *
 * Registered via
 * `ctx.registerCustomComponent("panel-builder.script-ref-picker", ...)`.
 * Source: `useCommandStore.getState().commands` — every command
 * currently registered with the editor's command registry. Suggestions
 * are the command ids; on commit the caller receives the chosen id and
 * wraps it into `{ script: "<id>" }` itself (we don't return the full
 * ScriptRef shape so the picker stays composable with future flavours
 * — argument arrays, value placeholders, etc.).
 *
 * Filter: substring match against the command id AND the command
 * title (so a user typing "undo" surfaces `history.undo` whose title
 * starts with "Undo"). Substring-only keeps the deps slim.
 *
 * Keyboard: ArrowUp / ArrowDown navigate; Enter / Tab select; Esc
 * dismisses.
 */

import React from "react";
import { useCommandStore } from "@cardboard/editor-shell";

const FIELD_LABEL = "text-[10px] uppercase tracking-wider text-zinc-500";
const FIELD_INPUT =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs " +
  "text-zinc-100 focus:border-amber-500/80 focus:outline-none";

export interface ScriptRefPickerProps {
  label?: string;
  /** Current script id (just the string — not the wrapping object). */
  value: string;
  /** Commit callback. Fires per-keystroke. */
  onChange: (next: string) => void;
  placeholder?: string;
  inputId?: string;
}

export function ScriptRefPicker({
  label,
  value,
  onChange,
  placeholder,
  inputId,
}: ScriptRefPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Subscribe to the commands record so newly-registered commands show
  // up in the dropdown immediately (e.g. a user installs a pack mid-
  // session and the new commands are available to bind).
  const commands = useCommandStore((s) => s.commands);

  const suggestions = React.useMemo(() => {
    if (!open) return [];
    const q = value.toLowerCase().trim();
    const all = Object.values(commands);
    const matches = q
      ? all.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q),
        )
      : all;
    matches.sort((a, b) => a.id.localeCompare(b.id));
    return matches.slice(0, 50);
  }, [open, commands, value]);

  React.useEffect(() => {
    if (highlight >= suggestions.length) setHighlight(0);
  }, [highlight, suggestions.length]);

  const onSelect = React.useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) =>
          suggestions.length === 0 ? 0 : (h + 1) % suggestions.length,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) =>
          suggestions.length === 0
            ? 0
            : (h - 1 + suggestions.length) % suggestions.length,
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions.length > 0) {
          e.preventDefault();
          onSelect(suggestions[highlight]!.id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, suggestions, highlight, onSelect],
  );

  const onBlur = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (!wrapperRef.current) return;
      const next = e.relatedTarget as Node | null;
      if (next && wrapperRef.current.contains(next)) return;
      setOpen(false);
    },
    [],
  );

  return (
    <label className="flex flex-col gap-1">
      {label !== undefined && <span className={FIELD_LABEL}>{label}</span>}
      <div
        ref={wrapperRef}
        className="relative"
        onBlur={onBlur}
      >
        <input
          id={inputId}
          type="text"
          className={FIELD_INPUT}
          value={value}
          placeholder={placeholder ?? "selection.clear"}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          data-testid="script-ref-picker-input"
        />
        {open && suggestions.length > 0 && (
          <ul
            className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-950 shadow-lg"
            role="listbox"
            data-testid="script-ref-picker-suggestions"
          >
            {suggestions.map((cmd, i) => (
              <li
                key={cmd.id}
                role="option"
                aria-selected={i === highlight}
                tabIndex={-1}
                className={[
                  "flex flex-col px-2 py-1 cursor-pointer",
                  i === highlight
                    ? "bg-amber-500/20"
                    : "hover:bg-zinc-800",
                ].join(" ")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(cmd.id);
                }}
              >
                <span
                  className={[
                    "text-xs font-mono truncate",
                    i === highlight ? "text-amber-100" : "text-zinc-200",
                  ].join(" ")}
                >
                  {cmd.id}
                </span>
                <span className="text-[10px] text-zinc-500 truncate">
                  {cmd.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}

export default ScriptRefPicker;
