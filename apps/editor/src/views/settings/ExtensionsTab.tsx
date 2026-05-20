import React from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui";
import { ToggleSwitch } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/Tooltip";
import {
  useEditorPacksStore,
  type EditorPackEntry,
} from "../../state/useEditorPacksStore";
import { registerCommand } from "../../state/useCommandStore";

/**
 * ExtensionsTab — Editor Settings → Extensions.
 *
 * Lists installed editor packs and lets the user enable/disable each
 * one. The Extensions list is driven by `useEditorPacksStore` (LS-
 * persisted). The actual loader (`editorPackLoader.ts`) reads the
 * enabled subset ONCE at editor startup, so toggling here doesn't take
 * effect until the next reload — we show a banner the moment the user
 * touches a toggle so they know to reload.
 *
 * COMMAND REGISTRY
 * ----------------
 * Per `feedback_command_registry_required`, every interactive editor
 * action must register via `registerCommand`. We register:
 *   - `editor.extensions.toggle.<packId>` — flips the enabled flag.
 *   - `editor.extensions.reload` — `window.location.reload()`.
 *
 * Both register on mount and unregister on unmount via the standard
 * `useEffect(() => registerCommand(...), [])` pattern. Toggle commands
 * are re-registered whenever the list of installed pack ids changes
 * (e.g. after a future install-from-file).
 *
 * "RELOAD TO APPLY" DETECTION
 * ---------------------------
 * The banner appears whenever the current enabled-set differs from
 * what the page started with. We snapshot the enabled-set on first
 * mount of the tab (via a ref) and compare against the live store
 * state on every render. This is intentionally permissive — toggling
 * a pack OFF then back ON within one session still trips the banner
 * because the load decision is made once at startup; any user-visible
 * change to the enabled set has the same "reload required" semantics.
 *
 * FORWARD-LOOKING UX
 * ------------------
 * The drop-an-.apg-to-install flow is intentionally not wired here —
 * a forward-looking message in the empty state hints at it, but the
 * surface (file picker, IDB write, manifest validation) is deferred to
 * the next pass. The store already supports multi-pack lists, so the
 * UI grows naturally when that flow lands.
 */

export function ExtensionsTab() {
  // Subscribe to the live packs map so toggles re-render the rows in
  // place. The selector returns the whole record — we'll project it to
  // a stable array via Object.values in render.
  const packs = useEditorPacksStore((s) => s.packs);
  const setEnabled = useEditorPacksStore((s) => s.setEnabled);

  // Snapshot the enabled subset at mount so we can detect drift later
  // ("any toggle since load"). Compute once via lazy useState init so
  // it survives re-renders without re-snapshotting. The snapshot is a
  // JSON-stringified id→bool map so deep equality is just `===`.
  const initialSnapshot = React.useMemo(() => {
    const snapshot: Record<string, boolean> = {};
    for (const entry of Object.values(packs)) {
      snapshot[entry.id] = entry.enabled;
    }
    return JSON.stringify(snapshot);
    // We intentionally exclude `packs` from deps — this is a
    // ONCE-on-mount snapshot. Subsequent edits should differ from
    // this baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSnapshot = React.useMemo(() => {
    const snapshot: Record<string, boolean> = {};
    for (const entry of Object.values(packs)) {
      snapshot[entry.id] = entry.enabled;
    }
    return JSON.stringify(snapshot);
  }, [packs]);

  const dirty = currentSnapshot !== initialSnapshot;

  // Stable list, insertion-order. Object.values + Object.keys both
  // iterate in insertion order on modern engines — same guarantee the
  // loader relies on.
  const entries = React.useMemo(() => Object.values(packs), [packs]);

  // Register the reload command (mount-only, no per-pack closures).
  React.useEffect(() => {
    return registerCommand({
      id: "editor.extensions.reload",
      title: "Extensions: Reload Editor",
      category: "View",
      keywords: ["reload", "refresh", "restart", "extensions", "packs"],
      description:
        "Reload the editor so toggled extensions take effect.",
      run: () => {
        if (typeof window === "undefined") return;
        window.location.reload();
      },
    });
  }, []);

  // Register one toggle command per installed pack. Re-register
  // whenever the set of pack ids changes so newly installed packs
  // pick up their own command, and uninstalled packs lose theirs.
  // We depend on `entries` (an Object.values projection): identity
  // changes only when `packs` itself changes — which is exactly
  // when register/unregister is correct.
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const entry of entries) {
      const displayName = entry.meta?.name ?? entry.id;
      unregs.push(
        registerCommand({
          id: `editor.extensions.toggle.${entry.id}`,
          title: `Extensions: Toggle ${displayName}`,
          category: "View",
          keywords: ["extensions", "pack", "toggle", entry.id],
          description: `Enable or disable the ${displayName} editor pack. Takes effect on reload.`,
          run: () => {
            // Read live state at run-time — the closure's `entry`
            // may be stale by the time the palette invokes us.
            const live =
              useEditorPacksStore.getState().packs[entry.id];
            if (!live) return;
            setEnabled(entry.id, !live.enabled);
          },
        }),
      );
    }
    return () => {
      for (const u of unregs) u();
    };
  }, [entries, setEnabled]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 leading-relaxed">
        Editor extensions add panels, inspectors, and tools to the
        editor. Disabled extensions are skipped at load time — their
        panels won't appear in the Docks modal until you re-enable
        them.
      </p>

      {dirty && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-xs text-amber-200">
            <RefreshCw size={12} className="shrink-0" />
            <span>
              Reload the editor to apply extension changes.
            </span>
          </div>
          <Tooltip
            stages={[
              {
                delay: 2000,
                content: <span>Reload editor</span>,
              },
              {
                delay: 5000,
                content: (
                  <div>
                    <div className="font-semibold">Reload editor</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[240px]">
                      Reloads the page so the toggled extensions are
                      picked up by the editor pack loader.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (typeof window === "undefined") return;
                window.location.reload();
              }}
            >
              Reload
            </Button>
          </Tooltip>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center">
          <Puzzle
            size={20}
            className="mx-auto text-zinc-600"
            aria-hidden="true"
          />
          <p className="mt-2 text-xs text-zinc-400">
            No editor extensions installed.
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
            Drop a <code className="font-mono">.apg</code> file here to
            install. (Coming soon.)
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <ExtensionRow
              key={entry.id}
              entry={entry}
              onToggle={(next) => setEnabled(entry.id, next)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ExtensionRowProps {
  entry: EditorPackEntry;
  onToggle: (next: boolean) => void;
}

function ExtensionRow({ entry, onToggle }: ExtensionRowProps) {
  const displayName = entry.meta?.name ?? entry.id;
  const version = entry.meta?.version ?? null;
  const panelCount = entry.meta?.panelCount ?? null;

  const panelCountLabel =
    panelCount == null
      ? "Metadata available after first load"
      : `Contributes ${panelCount} ${panelCount === 1 ? "panel" : "panels"}`;

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Puzzle
            size={12}
            className="shrink-0 text-zinc-500"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-zinc-200 truncate">
            {displayName}
          </span>
          {version && (
            <span className="shrink-0 text-[10px] font-mono text-zinc-500">
              v{version}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500 truncate">
          {panelCountLabel}
        </div>
        {entry.meta?.name && entry.meta.name !== entry.id && (
          <div className="mt-0.5 text-[10px] font-mono text-zinc-600 truncate">
            {entry.id}
          </div>
        )}
      </div>
      <Tooltip
        stages={[
          {
            delay: 2000,
            content: (
              <span>{entry.enabled ? "Disable" : "Enable"} {displayName}</span>
            ),
          },
          {
            delay: 5000,
            content: (
              <div>
                <div className="font-semibold">
                  {entry.enabled ? "Disable" : "Enable"} {displayName}
                </div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[240px]">
                  Toggling this extension takes effect after the
                  editor reloads. Disabled extensions are skipped at
                  startup.
                </div>
              </div>
            ),
          },
        ]}
      >
        <ToggleSwitch
          checked={entry.enabled}
          onChange={onToggle}
          aria-label={`Toggle ${displayName}`}
        />
      </Tooltip>
    </li>
  );
}
