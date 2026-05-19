import React from "react";
import { Upload } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";

/**
 * EntityDropZonePanel — dashed drop-target for importing entity
 * (prefab) definitions from external JSON files.
 *
 * Visual target: the bottom-left "Drag and drop prefab here" region of
 * `Editor Design/Entities.png`. A small upload-style affordance: dashed
 * border around the panel content, a muted `Upload` icon, a short
 * "Drop entity JSON" title, and a "or click to browse" subtitle.
 *
 * Interaction:
 *   - Drag a `.json` File over the panel — the dashed border + bg
 *     light up with an amber accent.
 *   - Drop the File — we attempt to parse its text as JSON and log the
 *     parsed value (stub for Wave 3, which wires the real import +
 *     register-into-pack pipeline).
 *   - Click the panel — opens the hidden `<input type="file"
 *     accept=".json">` picker. Same parse + log behavior on selection.
 *
 * Both paths log `[prefabs] drop intent` so the affordance is
 * observable end-to-end during development.
 *
 * Command registry:
 *   `prefabs.import.browse` — opens the file picker (same as clicking
 *   the panel). Title "Import Entity from File…", category "Entity".
 *
 * Responsive (ResizeObserver against the panel root):
 *   - At <100px (smallest of w/h): drop the subtitle (icon + title).
 *   - At <44px (smallest of w/h): icon only.
 *
 * Note: the default dockview layout sizes this panel ~80px tall (after
 * chrome the content area lands ~58px), so the "small" tier is what
 * shows by default and the "tiny" tier is a safety net for users who
 * collapse the column further.
 */

// ---------------------------------------------------------------------------
// Breakpoints.

const SMALL_PX = 100;
const TINY_PX = 44;

/** Parse the dropped/picked File as JSON and log the result. The real
 *  import flow (validate against entity schema, register into the
 *  active pack) lands in Wave 3. We `console.log` so the wiring is
 *  observable in dev without UI feedback for now. Parse failures log
 *  a warning so a malformed drop isn't silently swallowed. */
async function handleFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    // eslint-disable-next-line no-console
    console.warn(
      "[prefabs] drop intent: ignoring non-JSON file",
      file.name,
    );
    return;
  }
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    // eslint-disable-next-line no-console
    console.log("[prefabs] drop intent", { filename: file.name, parsed });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[prefabs] drop intent: parse failure", file.name, err);
  }
}

export function EntityDropZonePanel(): React.JSX.Element {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [size, setSize] = React.useState<"normal" | "small" | "tiny">(
    "normal",
  );

  // ResizeObserver — drop content tiers as the panel shrinks. We track
  // BOTH width and height because this panel is laid out short (80px)
  // by default; a width-only check would never trigger the small tier
  // on first paint.
  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const min = Math.min(rect.width, rect.height);
      if (min < TINY_PX) setSize("tiny");
      else if (min < SMALL_PX) setSize("small");
      else setSize("normal");
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Click → open the hidden file picker. Memoized so the command
  // registration's handler-ref doesn't churn.
  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Stable ref so the registered command always calls the latest
  // openPicker without forcing a re-register on every render.
  const openPickerRef = React.useRef(openPicker);
  React.useEffect(() => {
    openPickerRef.current = openPicker;
  }, [openPicker]);

  // Command registration — mount-once. The handler reads through the
  // ref so future iterations of `openPicker` flow through automatically.
  React.useEffect(() => {
    return registerCommand({
      id: "prefabs.import.browse",
      title: "Import Entity from File…",
      category: "Entity",
      keywords: ["prefab", "entity", "import", "browse", "json", "upload"],
      run: () => openPickerRef.current(),
    });
  }, []);

  // ---- DnD handlers ------------------------------------------------------

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      // Must call preventDefault on dragover for drop to fire.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [],
  );

  const onDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      // Ignore leave events bubbling up from child nodes — those fire as
      // the cursor moves between children even though we're still over
      // the drop area. Only clear when the cursor actually leaves the
      // root element's bounds.
      if (
        e.currentTarget instanceof Node &&
        e.relatedTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget)
      ) {
        return;
      }
      setDragOver(false);
    },
    [],
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void handleFile(file);
    },
    [],
  );

  const onPickerChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset so picking the same filename again still triggers change.
      e.target.value = "";
    },
    [],
  );

  // ---- Render ------------------------------------------------------------
  //
  // The whole panel body is a button — single click target makes the
  // affordance unambiguous and keyboard-reachable. The dashed border
  // mirrors the Add Layer button in LayersPanel (same border-dashed +
  // border-(--color-border-strong) treatment, with the same amber hover
  // accent). Drag-over swaps in the full amber accent.

  return (
    <div
      ref={rootRef}
      data-panel="entity-drop-zone"
      className="h-full w-full p-1"
    >
      <Tooltip
        side="top"
        wrapperClassName="block h-full w-full"
        stages={[
          {
            delay: 2000,
            content: <span>Drop entity JSON</span>,
          },
          {
            delay: 5000,
            content: (
              <div>
                <div className="font-semibold">Drop entity JSON</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Drag a `.json` entity definition here, or click to
                  browse for one. The file is parsed and queued for
                  import into the active pack.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="Drop entity JSON or click to browse"
          onClick={openPicker}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            "h-full w-full min-h-0 min-w-0 rounded",
            "flex flex-col items-center justify-center gap-0.5",
            "border border-dashed transition-colors",
            "text-[10px] uppercase tracking-wide",
            dragOver
              ? "border-amber-500 bg-amber-500/10 text-(--color-fg-primary)"
              : [
                  "border-(--color-border-strong) bg-transparent",
                  "text-(--color-fg-muted)",
                  "hover:border-amber-500/60 hover:bg-amber-500/5",
                  "hover:text-(--color-fg-secondary)",
                ].join(" "),
          ].join(" ")}
        >
          <Upload
            size={size === "tiny" ? 16 : 24}
            aria-hidden="true"
            className={
              dragOver
                ? "text-amber-400"
                : "text-(--color-fg-muted)"
            }
          />
          {size !== "tiny" ? (
            <span className="leading-none">Drop entity JSON</span>
          ) : null}
          {size === "normal" ? (
            <span className="leading-none normal-case tracking-normal text-(--color-fg-muted)">
              or click to browse
            </span>
          ) : null}
        </button>
      </Tooltip>

      {/* Hidden file picker — single shared input element triggered by
          the panel click and the `prefabs.import.browse` command. */}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={onPickerChange}
      />
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-drop-zone",
  title: "Drop Zone",
  icon: <Upload size={12} />,
};

export default EntityDropZonePanel;
