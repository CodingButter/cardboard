import React from "react";
import {
  Copy,
  Download,
  MoreVertical,
  StickyNote,
  Trash2,
} from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { useActiveScene } from "../../../shell/ActiveSceneContext";

/**
 * NotesPanel — designer scratchpad for the active scene.
 *
 * Opt-in panel (not part of the default Map.png layout). Holds
 * scene-local Markdown notes, pinned TODO markers, and free-form
 * "what was I doing here?" reminders. Persists with the scene file
 * so a designer returning days later can pick up where they left
 * off. Wave 2 wires this to the scene document's `notes` field.
 *
 * Surface contract:
 *   Registered with default `surface: true` in MapView, so DockShell
 *   wraps this body in a `<PanelSurface/>` card (p-2 inner padding).
 *   This root is layout-only — no border/bg/padding here.
 *
 * Persistence contract:
 *   - `cardboard.scene.notes.text` — string, default the placeholder
 *     text below. Writes are debounced 300ms after the last keystroke
 *     to avoid hammering localStorage on every character.
 *
 * Command registry contract — every interactive control here also
 * registers a command via `registerCommand` (see `state/README.md`):
 *   - `scene.notes.clear`  — confirmation-gated text wipe.
 *   - `scene.notes.copy`   — copy current text to the system clipboard.
 *   - `scene.notes.export` — download current text as a `.md` file.
 */

// ---------------------------------------------------------------------------
// Persistence

const LS_TEXT = "cardboard.scene.notes.text";

const PLACEHOLDER_TEXT = `# Scene Notes

- This is a scratch pad for scene-level notes.
- Supports markdown syntax (rendered on export).
`;

/** Debounce window for LS writes. Picked to absorb burst typing
 *  without losing more than a quarter-second of user input if the
 *  tab closes mid-stream. */
const LS_WRITE_DEBOUNCE_MS = 300;

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

// ---------------------------------------------------------------------------
// Responsive breakpoints
//
// Two distinct width thresholds:
//   - NARROW_BREAKPOINT_PX: below this, the toolbar collapses every
//     action into a single ghost kebab menu rather than rendering a
//     full button row. This stays well above the panel's minimum so
//     the textarea always has room to breathe.
//   - MIN_CONTENT_WIDTH_PX: below this (or the min-height), we replace
//     the whole body with a "resize panel to use notes" message. The
//     dock can be shrunk arbitrarily small and a textarea at <100px
//     square is essentially unusable.

const NARROW_BREAKPOINT_PX = 220;
const MIN_CONTENT_WIDTH_PX = 120;
const MIN_CONTENT_HEIGHT_PX = 100;

/** Observe `ref`'s contentRect and report `{ width, height }`. Seeds
 *  synchronously from `clientWidth/Height` on mount so the very first
 *  paint matches the actual size (avoids flashing the "resize panel"
 *  message at full size). */
function usePanelSize(
  ref: React.RefObject<HTMLElement | null>,
): { width: number; height: number } {
  const [size, setSize] = React.useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      // Fallback: seed once and trust window resize.
      setSize({ width: el.clientWidth, height: el.clientHeight });
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    ro.observe(el);
    // Seed once synchronously to skip the initial 0×0 frame.
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ---------------------------------------------------------------------------
// Scene-name helper — used to suggest a sensible export filename.
//
// `useActiveScene()` exposes the resolved path/label; we strip the
// `scenes/` prefix + `.json` suffix and fall back to "scene" when no
// scene is pinned. The result is slugified to keep the download name
// shell-friendly across browsers.

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "scene";
}

function useExportFilename(): string {
  const ctx = useActiveScene();
  const path = ctx.activeScene ?? ctx.fallbackScene ?? null;
  const sceneOption = path ? ctx.scenes.find((s) => s.path === path) : null;
  const base = sceneOption
    ? sceneOption.label
    : path
      ? path.replace(/^scenes\//, "").replace(/\.json$/, "")
      : "scene";
  return `${slugify(base)}-notes.md`;
}

// ---------------------------------------------------------------------------
// Panel

export function NotesPanel(): React.JSX.Element {
  // Initial value hydrates from LS once. Subsequent writes round-trip
  // through React state so the textarea is fully controlled.
  const [text, setText] = React.useState<string>(() => {
    const stored = readLS(LS_TEXT);
    return stored ?? PLACEHOLDER_TEXT;
  });

  // Debounced LS write — cancel-on-change so a flurry of keystrokes
  // collapses into a single persist call after the user pauses.
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      writeLS(LS_TEXT, text);
    }, LS_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [text]);

  // Filename derived from the active scene context — used by the
  // export-as-markdown action.
  const filename = useExportFilename();

  // --- Action handlers ----------------------------------------------------

  const handleClear = React.useCallback(() => {
    // Confirmation gate: clear is destructive (the placeholder text is
    // a help string, not user content, so we DO erase fully — the
    // textarea ends up empty). `window.confirm` is intentionally
    // synchronous + native: matches the engine's "fast and obvious"
    // style for irreversible actions.
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Clear all scene notes? This cannot be undone.",
    );
    if (!ok) return;
    setText("");
    // Flush the cleared state to LS immediately — the debounce above
    // would also catch it, but a user clearing on their way out of the
    // tab shouldn't have to wait 300ms.
    writeLS(LS_TEXT, "");
  }, []);

  const handleCopy = React.useCallback(() => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
      }
    } catch {
      /* clipboard rejected (insecure context / permissions) — no-op */
    }
  }, [text]);

  const handleExport = React.useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    try {
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      // Append-then-click-then-remove is the cross-browser-safe shape
      // (some browsers ignore the click on a detached anchor).
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the browser has a tick to start the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      /* DOM/Blob rejected — no-op */
    }
  }, [text, filename]);

  // --- Command-registry refs ---------------------------------------------
  // Canonical handler-ref + useEffect pattern from `state/README.md`.
  // Lets the registration effect mount once with stable command ids
  // while always dispatching to the latest closure.
  const clearHandlerRef = React.useRef(handleClear);
  const copyHandlerRef = React.useRef(handleCopy);
  const exportHandlerRef = React.useRef(handleExport);
  React.useEffect(() => {
    clearHandlerRef.current = handleClear;
  }, [handleClear]);
  React.useEffect(() => {
    copyHandlerRef.current = handleCopy;
  }, [handleCopy]);
  React.useEffect(() => {
    exportHandlerRef.current = handleExport;
  }, [handleExport]);

  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.notes.clear",
        title: "Clear Notes",
        category: "Notes",
        keywords: ["notes", "clear", "wipe", "reset", "scratchpad"],
        description:
          "Clear Notes — empties this textarea after a confirmation prompt.",
        run: () => clearHandlerRef.current(),
      }),
      registerCommand({
        id: "scene.notes.copy",
        title: "Copy Notes to Clipboard",
        category: "Notes",
        keywords: ["notes", "copy", "clipboard", "scratchpad"],
        description:
          "Copy Notes — writes the current notes text to the system clipboard.",
        run: () => copyHandlerRef.current(),
      }),
      registerCommand({
        id: "scene.notes.export",
        title: "Export Notes as Markdown",
        category: "Notes",
        keywords: ["notes", "export", "download", "markdown", "md"],
        description:
          "Export Notes — downloads the current notes as a Markdown (.md) file named after the active scene.",
        run: () => exportHandlerRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // --- Responsive measurements --------------------------------------------

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const { width, height } = usePanelSize(rootRef);
  // Width may legitimately be 0 on the very first paint before the
  // ResizeObserver fires. Treat 0 as "not yet measured" rather than
  // "too narrow" so we don't flash the resize-message at startup.
  const tooSmall =
    (width > 0 && width < MIN_CONTENT_WIDTH_PX) ||
    (height > 0 && height < MIN_CONTENT_HEIGHT_PX);
  const narrow = width > 0 && width < NARROW_BREAKPOINT_PX;

  // Outer container is just the panel hook + flex column. PanelSurface
  // wraps this with the visible card chrome + 8px inner padding, so we
  // DON'T add padding/border/bg here. `min-h-0` is required for the
  // flex-1 textarea to actually scroll instead of overflowing its
  // parent.
  return (
    <div
      ref={rootRef}
      data-panel="notes"
      className="h-full w-full min-h-0 flex flex-col gap-1.5"
    >
      {tooSmall ? (
        <ResizeHint />
      ) : (
        <>
          <NotesToolbar
            onClear={handleClear}
            onCopy={handleCopy}
            onExport={handleExport}
            narrow={narrow}
          />
          <NotesTextarea value={text} onChange={setText} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resize-hint placeholder (rendered when the panel is smaller than the
// minimum sensible content rect)

function ResizeHint(): React.JSX.Element {
  return (
    <div
      className={[
        "flex-1 min-h-0 flex items-center justify-center",
        "text-[10px] uppercase tracking-wide text-(--color-fg-muted)",
        "text-center px-2",
      ].join(" ")}
    >
      Resize panel to use notes
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar — Copy / Export / Clear (or a kebab when narrow)

interface NotesToolbarProps {
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
  narrow: boolean;
}

function NotesToolbar({
  onClear,
  onCopy,
  onExport,
  narrow,
}: NotesToolbarProps): React.JSX.Element {
  return (
    <div className="shrink-0 h-7 flex items-center gap-1 min-w-0">
      <span className="flex-1 min-w-0 text-[10px] uppercase tracking-[0.18em] text-(--color-fg-muted) font-semibold truncate">
        Notes
      </span>
      <div className="shrink-0 flex items-center gap-1">
        {narrow ? (
          <NotesKebab
            onClear={onClear}
            onCopy={onCopy}
            onExport={onExport}
          />
        ) : (
          <>
            <NotesToolbarButton
              ariaLabel="Copy Notes to Clipboard"
              tooltipLabel="Copy"
              tooltipDescription="Copy Notes — writes the current notes text to the system clipboard."
              onClick={onCopy}
              icon={<Copy size={12} aria-hidden="true" />}
            />
            <NotesToolbarButton
              ariaLabel="Export Notes as Markdown"
              tooltipLabel="Export"
              tooltipDescription="Export Notes — downloads the current notes as a Markdown (.md) file."
              onClick={onExport}
              icon={<Download size={12} aria-hidden="true" />}
            />
            <NotesToolbarButton
              ariaLabel="Clear Notes"
              tooltipLabel="Clear"
              tooltipDescription="Clear Notes — empties this textarea after a confirmation prompt."
              onClick={onClear}
              icon={<Trash2 size={12} aria-hidden="true" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar icon button (re-used in the wide layout)

interface NotesToolbarButtonProps {
  ariaLabel: string;
  tooltipLabel: string;
  tooltipDescription: string;
  onClick: () => void;
  icon: React.ReactNode;
}

function NotesToolbarButton({
  ariaLabel,
  tooltipLabel,
  tooltipDescription,
  onClick,
  icon,
}: NotesToolbarButtonProps): React.JSX.Element {
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 2000, content: <span>{tooltipLabel}</span> },
        {
          delay: 5000,
          content: (
            <div>
              <div className="font-semibold">{tooltipLabel}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                {tooltipDescription}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={[
          "inline-flex items-center justify-center",
          "w-6 h-6 rounded",
          "border transition-colors",
          "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
          "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Kebab menu (narrow widths only)

interface NotesKebabProps {
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
}

function NotesKebab({
  onClear,
  onCopy,
  onExport,
}: NotesKebabProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target)) setOpen(false);
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
    <div ref={wrapperRef} className="relative inline-flex">
      <Tooltip
        side="bottom"
        stages={[
          { delay: 2000, content: <span>More</span> },
          {
            delay: 5000,
            content: (
              <div>
                <div className="font-semibold">More actions</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                  Reveal Copy, Export, and Clear actions — folded behind a
                  kebab at narrow panel widths.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="More notes actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={[
            "inline-flex items-center justify-center",
            "w-6 h-6 rounded",
            "border transition-colors",
            "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
            "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <MoreVertical size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className={[
            "absolute right-0 top-full mt-1 z-50",
            "min-w-[140px] py-1 rounded-md",
            "border border-(--color-border-strong) bg-zinc-900 shadow-lg",
          ].join(" ")}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopy();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Copy size={12} aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExport();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Download size={12} aria-hidden="true" />
            <span>Export</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Trash2 size={12} aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Textarea — controlled, fills the panel, vertical-scroll only

interface NotesTextareaProps {
  value: string;
  onChange: (next: string) => void;
}

function NotesTextarea({
  value,
  onChange,
}: NotesTextareaProps): React.JSX.Element {
  // Render the textarea directly rather than via the `Textarea` primitive:
  // the primitive's `.input-textarea` class has padding tuned for short
  // inspector fields and uses `rows` to size itself. Here we want it to
  // flex-fill the remaining panel height with `flex-1` + `min-h-[80px]`,
  // so we mirror the visual styling (bg/border/focus) directly and
  // forgo the rows-based sizing.
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck
      placeholder="Type scene notes here…"
      // `resize-none` because the dock owns sizing — letting the user
      // drag the textarea's native resize handle would fight the
      // dockview layout. `whitespace-pre-wrap` + `break-words` honour
      // line breaks while wrapping long lines (no horizontal scroll).
      className={[
        "flex-1 min-h-[80px] w-full min-w-0",
        "px-2 py-1.5 rounded-md",
        "bg-zinc-950 border border-zinc-800",
        "text-xs leading-snug text-zinc-100 placeholder:text-zinc-600",
        "font-mono",
        "transition-colors duration-150",
        "focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40",
        "resize-none overflow-y-auto overflow-x-hidden",
        "whitespace-pre-wrap break-words",
      ].join(" ")}
    />
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "notes",
  title: "Notes",
  icon: <StickyNote size={12} />,
};

export default NotesPanel;
