import React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

/**
 * DropdownMenu — §4.18.
 *
 * Hand-rolled menu: clicking the trigger opens a floating panel of
 * options anchored beneath it. No Radix. Closes on outside click or
 * Escape. Positioning uses `useLayoutEffect` to read the trigger's
 * bounding rect and place the panel just below it.
 */

export interface DropdownOption<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface DropdownMenuProps<T extends string> {
  /** Element rendered as the clickable trigger. Should be a button
   *  (or a styled wrapper element with a button inside). */
  trigger: React.ReactNode;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (next: T) => void;
  /** Align panel under trigger by start or end edge. */
  align?: "start" | "end";
  /** Pixel width override. Default matches trigger width. */
  width?: number;
  /** When true, the trigger is non-interactive. */
  disabled?: boolean;
  className?: string;
}

export function DropdownMenu<T extends string>({
  trigger,
  value,
  options,
  onChange,
  align = "start",
  width,
  disabled = false,
  className,
}: DropdownMenuProps<T>) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  // Panel renders into a body-level portal (see below), so its DOM node
  // is outside `wrapperRef`. The outside-click handler needs its own
  // ref to allow clicks inside the menu without closing.
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({});

  // Position the panel using viewport-relative coords + `position: fixed`
  // so the popup escapes any parent stacking context (parents with
  // `position: relative` / `transform` / `filter` would otherwise trap
  // `z-50` within their own layer, causing the popup to render below
  // siblings like the GridEditor canvas or PrimaryTabs).
  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const w = width ?? rect.width;
    setPanelStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: align === "start" ? rect.left : rect.right - w,
      width: w,
    });
  }, [open, align, width]);

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !wrapperRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className={cn("relative inline-block", className)}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "w-full text-left appearance-none cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "rounded-md",
        )}
      >
        {trigger}
      </button>
      {open &&
        !disabled &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={panelStyle}
          className={cn(
            "z-[1000] rounded-lg border border-zinc-800",
            "bg-zinc-900 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]",
            "py-1 max-h-80 overflow-y-auto",
          )}
        >
          {options.map((opt) => {
            const selected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                disabled={opt.disabled}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left",
                  "transition-colors duration-100",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  selected
                    ? "text-amber-300 bg-amber-500/10"
                    : "text-zinc-200 hover:bg-zinc-800",
                )}
              >
                {opt.icon && (
                  <span className="inline-flex items-center w-4 h-4 text-zinc-400">
                    {opt.icon}
                  </span>
                )}
                <span className="truncate flex-1">{opt.label}</span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-amber-400"
                    aria-hidden="true"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
