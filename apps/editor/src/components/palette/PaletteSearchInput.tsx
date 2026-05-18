import React from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePaletteUI } from "./CommandPalette";
import { isMacOS } from "../../lib/keybinding";

/**
 * PaletteSearchInput — the TopBar's centred search affordance.
 *
 * Functionally just a button styled as an input — clicking or focusing
 * it opens the palette in file mode. The user types in the actual
 * palette overlay, not here. (This mirrors VSCode's TopBar search; the
 * persistent input is a quick-access button, the real input lives in
 * the modal so it can drive keyboard nav and result rendering.)
 *
 * Width-constrained by its container (`max-w-md mx-auto`) so it never
 * crowds the brand or the right-side action cluster.
 */

export function PaletteSearchInput() {
  const open = usePaletteUI((s) => s.openPalette);
  return (
    <button
      type="button"
      onClick={() => open("file")}
      className={cn(
        "group relative h-7 w-full inline-flex items-center gap-2 px-2.5",
        "rounded-md bg-(--color-bg-card) border border-(--color-border)",
        "text-[12px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60",
        "transition-colors",
      )}
      title="Search files (Ctrl+P) • commands (Ctrl+Shift+P)"
      aria-label="Open command palette"
    >
      <Search size={12} className="text-zinc-500 shrink-0" />
      <span className="flex-1 text-left truncate">Search files & commands…</span>
      <span
        aria-hidden="true"
        className={cn(
          "ml-2 inline-flex items-center px-1 py-0.5 rounded",
          "text-[10px] font-mono text-zinc-500 border border-zinc-700/80",
          "group-hover:text-zinc-300 group-hover:border-zinc-600",
        )}
      >
        {isMacOS() ? "⌘P" : "Ctrl+P"}
      </span>
    </button>
  );
}
