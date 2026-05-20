import React from "react";
import { create } from "zustand";
import {
  Search,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  AudioLines,
  Code2,
  Layers,
  Box,
  FileJson,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Kbd } from "../ui/Kbd";
import { Tooltip } from "../ui/Tooltip";
import {
  useCommandStore,
  useCommandList,
  type EditorCommand,
} from "../../state/useCommandStore";
import {
  useFileIndex,
  type FileIndexEntry,
  type FileIndexEntryKind,
} from "../../state/useFileIndex";
import { fuzzyScore } from "../../lib/fuzzyMatch";
import { formatKeybinding, isMacOS } from "../../lib/keybinding";

/**
 * CommandPalette — VSCode-style overlay (Ctrl+P / Ctrl+Shift+P).
 *
 * Mode is chosen by the leading character of the query:
 *   - bare text       → file mode (asset search)
 *   - leading `>`     → command mode (with the `>` shown as a chip,
 *                       NOT as typed text)
 *   - leading `@`     → reserved for symbol mode (no results yet)
 *
 * Up to ~12 results render; keyboard nav with ↑/↓ + Enter; Esc closes.
 * Recently used commands get a small score boost so the user's last
 * actions float toward the top on a tie.
 */

export type PaletteMode = "file" | "command" | "symbol";

interface PaletteUIState {
  open: boolean;
  mode: PaletteMode;
  /** Open the palette in a specific mode. */
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  toggle: (mode: PaletteMode) => void;
}

export const usePaletteUI = create<PaletteUIState>()((set, get) => ({
  open: false,
  mode: "file",
  openPalette: (mode) => set({ open: true, mode }),
  closePalette: () => set({ open: false }),
  toggle: (mode) => {
    const s = get();
    if (s.open && s.mode === mode) set({ open: false });
    else set({ open: true, mode });
  },
}));

interface CommandRow {
  kind: "command";
  cmd: EditorCommand;
  matches: number[];
  score: number;
}

interface FileRow {
  kind: "file";
  file: FileIndexEntry;
  matches: number[];
  score: number;
}

type Row = CommandRow | FileRow;

const MAX_RESULTS = 12;

export function CommandPalette() {
  const open = usePaletteUI((s) => s.open);
  const mode = usePaletteUI((s) => s.mode);
  const close = usePaletteUI((s) => s.closePalette);
  const setMode = React.useCallback((m: PaletteMode) => {
    usePaletteUI.setState({ mode: m });
  }, []);

  const commands = useCommandList();
  const files = useFileIndex((s) => s.files);
  const recent = useCommandStore((s) => s.recent);
  const runById = useCommandStore((s) => s.runById);

  // Raw input value INCLUDING any leading mode-prefix. The prefix is
  // stripped before matching against the query.
  const [rawValue, setRawValue] = React.useState("");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset state every open.
  React.useEffect(() => {
    if (!open) return;
    setRawValue("");
    setSelectedIdx(0);
    // Focus on next frame so the input is mounted.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, mode]);

  // Derive mode + query from rawValue. Leading `>` or `@` flip mode
  // without persisting in the visible text — the prefix is shown as a
  // chip and stripped from the query. If the user opened in command
  // mode via the keybinding, the chip is already showing and they type
  // their query straight in.
  const { effectiveMode, query } = React.useMemo(() => {
    if (rawValue.startsWith(">")) {
      return { effectiveMode: "command" as const, query: rawValue.slice(1) };
    }
    if (rawValue.startsWith("@")) {
      return { effectiveMode: "symbol" as const, query: rawValue.slice(1) };
    }
    return { effectiveMode: mode, query: rawValue };
  }, [rawValue, mode]);

  // Sync the chip-driven mode back to the store if the user typed a
  // prefix while the palette was open.
  React.useEffect(() => {
    if (effectiveMode !== mode) setMode(effectiveMode);
  }, [effectiveMode, mode, setMode]);

  const rows: Row[] = React.useMemo(() => {
    if (effectiveMode === "symbol") return [];
    if (effectiveMode === "command") {
      return rankCommands(commands, query.trim(), recent).slice(0, MAX_RESULTS);
    }
    return rankFiles(files, query.trim()).slice(0, MAX_RESULTS);
  }, [effectiveMode, commands, files, query, recent]);

  // Clamp selection when result count shrinks.
  React.useEffect(() => {
    setSelectedIdx((i) => {
      if (rows.length === 0) return 0;
      if (i >= rows.length) return rows.length - 1;
      return i;
    });
  }, [rows.length]);

  const onRun = React.useCallback(
    async (row: Row) => {
      if (row.kind === "command") {
        close();
        await runById(row.cmd.id);
      } else {
        // File mode — for now, dispatch a generic open-file event the
        // shell can listen for. We don't have a router target for
        // every asset type yet; this hook is the placeholder for the
        // future migration to a real file-open pipeline.
        close();
        window.dispatchEvent(
          new CustomEvent("cardboard:open-asset", {
            detail: { path: row.file.path, type: row.file.type },
          }),
        );
      }
    },
    [close, runById],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[selectedIdx];
        if (row) void onRun(row);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Backspace" && rawValue === "") {
        // Allow Backspace to drop the prefix chip when the input is
        // empty — flips back to file mode.
        if (mode !== "file") {
          e.preventDefault();
          setMode("file");
        }
      }
    },
    [rows, selectedIdx, onRun, close, rawValue, mode, setMode],
  );

  if (!open) return null;

  const showPrefix = effectiveMode !== "file";
  const placeholder =
    effectiveMode === "command"
      ? "Search commands…"
      : effectiveMode === "symbol"
        ? "Symbol search — coming soon"
        : "Search files…";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[15vh]"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="panel-surface-rounded w-full max-w-xl mx-4 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-(--color-border)">
          <Search size={14} className="text-zinc-500 shrink-0" />
          {showPrefix && (
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold",
                effectiveMode === "command"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "bg-sky-500/15 text-sky-300 border border-sky-500/30",
              )}
              aria-label={`${effectiveMode} mode`}
            >
              {effectiveMode === "command" ? ">" : "@"}
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={
              rawValue.startsWith(">") || rawValue.startsWith("@")
                ? rawValue.slice(1)
                : rawValue
            }
            onChange={(e) => {
              const next = e.target.value;
              if (effectiveMode === "command") setRawValue(">" + next);
              else if (effectiveMode === "symbol") setRawValue("@" + next);
              else setRawValue(next);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent outline-none text-sm text-zinc-100 placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={close}
            className="text-zinc-500 hover:text-zinc-300 text-[11px] px-1.5 py-0.5 rounded"
            aria-label="Close palette"
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto" role="listbox">
          {effectiveMode === "symbol" ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">
              Symbol search — coming soon
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">
              {query.trim().length === 0 && effectiveMode === "file"
                ? files.length === 0
                  ? "No project open"
                  : "Start typing to search files"
                : "No matches"}
            </div>
          ) : (
            rows.map((row, idx) => (
              <PaletteRow
                key={
                  row.kind === "command" ? row.cmd.id : `file::${row.file.id}`
                }
                row={row}
                selected={idx === selectedIdx}
                onSelect={() => setSelectedIdx(idx)}
                onRun={() => void onRun(row)}
              />
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-(--color-border) text-[10px] text-zinc-500">
          <div className="flex items-center gap-2">
            <span>
              <Kbd>{isMacOS() ? "⌘P" : "Ctrl+P"}</Kbd> files
            </span>
            <span>
              <Kbd>{isMacOS() ? "⌘⇧P" : "Ctrl+Shift+P"}</Kbd> commands
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>↑↓</Kbd>
            <Kbd>Enter</Kbd>
            <Kbd>Esc</Kbd>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PaletteRowProps {
  row: Row;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}

function PaletteRow({ row, selected, onSelect, onRun }: PaletteRowProps) {
  const rowRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  const title = row.kind === "command" ? row.cmd.title : row.file.path;
  const icon = row.kind === "command" ? row.cmd.icon : fileIcon(row.file.type);
  const category =
    row.kind === "command" ? row.cmd.category : prettyKind(row.file.type);
  const keybinding = row.kind === "command" ? row.cmd.keybinding : undefined;
  const description = row.kind === "command" ? row.cmd.description : undefined;

  const stages = [
    { delay: 1000, content: <span>{title}</span> },
    {
      delay: 3000,
      content: (
        <div>
          <div className="font-semibold">{title}</div>
          {description ? (
            <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
              {description}
            </div>
          ) : null}
          {category ? (
            <div className="text-[10px] text-(--color-fg-muted) mt-1 italic">
              {category}
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Tooltip stages={stages} side="right">
      <button
        ref={rowRef}
        type="button"
        role="option"
        aria-selected={selected}
        onMouseEnter={onSelect}
        onClick={onRun}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px]",
          "border-l-2",
          selected
            ? "bg-amber-500/10 border-amber-400 text-zinc-100"
            : "border-transparent text-zinc-300 hover:bg-zinc-800/40",
        )}
      >
        <span className="w-4 h-4 inline-flex items-center justify-center text-zinc-400 shrink-0">
          {icon ?? <ChevronRight size={12} />}
        </span>
        <span className="flex-1 truncate">
          <HighlightedText text={title} matches={row.matches} />
        </span>
        {category && (
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/60 shrink-0">
            {category}
          </span>
        )}
        {keybinding && (
          <span className="text-[10px] text-zinc-400 shrink-0">
            <Kbd>{formatKeybinding(keybinding)}</Kbd>
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function HighlightedText({
  text,
  matches,
}: {
  text: string;
  matches: number[];
}) {
  if (matches.length === 0) return <>{text}</>;
  const set = new Set(matches);
  const chars: React.ReactNode[] = [];
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) {
      chars.push(
        <span key={i} className="text-amber-300 font-semibold">
          {text[i]}
        </span>,
      );
    } else {
      chars.push(<React.Fragment key={i}>{text[i]}</React.Fragment>);
    }
  }
  return <>{chars}</>;
}

function rankCommands(
  commands: EditorCommand[],
  query: string,
  recent: string[],
): CommandRow[] {
  const recentRank = new Map<string, number>();
  recent.forEach((id, idx) => recentRank.set(id, recent.length - idx));

  // Empty query: show recents first, then everything else alphabetised.
  if (!query) {
    const recents = commands
      .filter((c) => recentRank.has(c.id))
      .sort(
        (a, b) => (recentRank.get(b.id) ?? 0) - (recentRank.get(a.id) ?? 0),
      );
    const rest = commands
      .filter((c) => !recentRank.has(c.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    return [...recents, ...rest].map((cmd) => ({
      kind: "command" as const,
      cmd,
      matches: [],
      score: 0,
    }));
  }

  const out: CommandRow[] = [];
  for (const cmd of commands) {
    // Match against the title primarily; keywords + category add fall-
    // back tokens but never beat a real title match.
    const tokens = [cmd.title, ...(cmd.keywords ?? []), cmd.category ?? ""];
    let best: { score: number; matches: number[] } | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const target = tokens[i];
      if (!target) continue;
      const res = fuzzyScore(query, target);
      if (!res) continue;
      // Only the first token (title) keeps its match indices for the
      // highlight, otherwise we'd be highlighting characters in
      // keywords that aren't in the rendered title.
      const adjusted = i === 0 ? res : { ...res, matches: [] };
      if (!best || adjusted.score > best.score) best = adjusted;
    }
    if (best) {
      const rank = recentRank.get(cmd.id) ?? 0;
      out.push({
        kind: "command",
        cmd,
        matches: best.matches,
        score: best.score + rank * 0.5,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function rankFiles(files: FileIndexEntry[], query: string): FileRow[] {
  if (!query) {
    // Empty query: show first N files sorted by path for a sane preview.
    return files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, MAX_RESULTS)
      .map((file) => ({
        kind: "file" as const,
        file,
        matches: [],
        score: 0,
      }));
  }
  const out: FileRow[] = [];
  for (const file of files) {
    const res = fuzzyScore(query, file.path);
    if (!res) continue;
    out.push({
      kind: "file",
      file,
      matches: res.matches,
      score: res.score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function fileIcon(kind: FileIndexEntryKind): React.ReactNode {
  switch (kind) {
    case "scene":
      return <Layers size={12} />;
    case "script":
      return <Code2 size={12} />;
    case "texture":
      return <ImageIcon size={12} />;
    case "sprite":
      return <Box size={12} />;
    case "sound":
      return <AudioLines size={12} />;
    case "manifest":
      return <FileJson size={12} />;
    default:
      return <FileText size={12} />;
  }
}

function prettyKind(kind: FileIndexEntryKind): string {
  switch (kind) {
    case "scene":
      return "Scene";
    case "script":
      return "Script";
    case "texture":
      return "Texture";
    case "sprite":
      return "Sprite";
    case "sound":
      return "Sound";
    case "manifest":
      return "Manifest";
    default:
      return "File";
  }
}
