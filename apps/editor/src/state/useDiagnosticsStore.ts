import { createSyncedStore } from "./sync";

/**
 * useDiagnosticsStore — the editor's log / problems feed.
 *
 * Capped, in-memory log of `DiagnosticLine` entries. The Output and
 * Problems panels both read from here (Problems filters severity ≥
 * warn). Lines may optionally carry a cell coordinate for "jump to
 * location" affordances.
 *
 * Persistence: NONE. Diagnostics are session-scoped — there's no value
 * in surfacing yesterday's "missing texture" warning today. We use
 * `partialize: () => ({})` so the persist middleware writes (and
 * re-reads) an empty object, which is a cheap no-op.
 *
 * Cross-window: `enableBroadcast: true` opens a BroadcastChannel so
 * popouts see live logs. We post a message on every `log()` call; the
 * channel listener appends the line to the local store. The storage
 * event is NOT used (the persisted slice is empty) — broadcast is the
 * only cross-window lane for diagnostics.
 */

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface DiagnosticCellRef {
  x: number;
  y: number;
}

export interface DiagnosticLine {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  ts: number;
  /** Optional cell coord for "jump to" affordance in ProblemsPanel. */
  cell?: DiagnosticCellRef;
}

export interface DiagnosticsStateData {
  lines: DiagnosticLine[];
  /** Max number of lines retained. Older lines are dropped FIFO. */
  capacity: number;
}

export interface DiagnosticsStateActions {
  log: (
    severity: DiagnosticSeverity,
    message: string,
    cell?: DiagnosticCellRef,
  ) => void;
  clear: () => void;
  setCapacity: (n: number) => void;
}

export type DiagnosticsState = DiagnosticsStateData & DiagnosticsStateActions;

interface DiagnosticsBroadcast {
  kind: "append" | "clear";
  line?: DiagnosticLine;
}

const DEFAULT_CAPACITY = 500;

const INITIAL: DiagnosticsStateData = {
  lines: [],
  capacity: DEFAULT_CAPACITY,
};

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `diag-${Date.now().toString(36)}-${lineCounter.toString(36)}`;
}

function trimToCapacity(
  lines: DiagnosticLine[],
  capacity: number,
): DiagnosticLine[] {
  if (lines.length <= capacity) return lines;
  return lines.slice(lines.length - capacity);
}

export const useDiagnosticsStore = createSyncedStore<
  DiagnosticsStateData,
  DiagnosticsStateActions
>(
  "diagnostics",
  INITIAL,
  (set, _get, broadcast) => ({
    log: (severity, message, cell) => {
      const line: DiagnosticLine = {
        id: nextId(),
        severity,
        message,
        ts: Date.now(),
        ...(cell ? { cell } : {}),
      };
      set((s) => ({
        lines: trimToCapacity([...s.lines, line], s.capacity),
      }));
      const msg: DiagnosticsBroadcast = { kind: "append", line };
      broadcast(msg);
    },
    clear: () => {
      set({ lines: [] });
      const msg: DiagnosticsBroadcast = { kind: "clear" };
      broadcast(msg);
    },
    setCapacity: (n) => {
      const capacity = Math.max(1, Math.floor(n));
      set((s) => ({
        capacity,
        lines: trimToCapacity(s.lines, capacity),
      }));
    },
  }),
  {
    enableBroadcast: true,
    // Diagnostics are session-scoped — persist nothing. The persist
    // middleware still runs but writes an empty object.
    partialize: () => ({}),
  },
);

// Subscribe to incoming broadcasts from sibling windows. When a popout
// logs a line, we append it to our local store; when it clears, we
// clear ours too.
if (useDiagnosticsStore.channel) {
  useDiagnosticsStore.channel.addEventListener("message", (ev) => {
    const data = ev.data as DiagnosticsBroadcast | undefined;
    if (!data || typeof data !== "object" || !("kind" in data)) return;
    if (data.kind === "append" && data.line) {
      // Echo guard — skip if we already have this line id (can happen
      // if a future change makes the writer also receive its own
      // broadcasts).
      const incoming = data.line;
      useDiagnosticsStore.setState((s) => {
        if (s.lines.some((l) => l.id === incoming.id)) return s;
        return {
          lines: trimToCapacity([...s.lines, incoming], s.capacity),
        };
      });
    } else if (data.kind === "clear") {
      useDiagnosticsStore.setState({ lines: [] });
    }
  });
}

/** Non-React getter for imperative call sites. */
export function getDiagnosticsState(): DiagnosticsState {
  return useDiagnosticsStore.getState();
}
