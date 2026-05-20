// P3 prefabs batch migration. Moved from
// `apps/editor/src/views/prefabs/panels/JsonPreviewPanel.tsx` into the
// core-editor-pack with no behavioural changes — only the import paths
// flipped to pack-relative for presentational primitives and SDK-routed
// for `registerCommand`.
import React from "react";
import { Braces, Copy, Play } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../../apps/editor/src/components/dock/DockShell";
// Presentational primitive — safe to bundle.
import { Tooltip } from "../../../../apps/editor/src/components/ui/Tooltip";
// Externalised — `registerCommand` must run against the host's
// `useCommandStore` singleton.
import { registerCommand } from "@cardboard/editor-shell";
import { MOCK_ENTITIES, type EntityRow } from "./prefabs-fixtures";

/**
 * JsonPreviewPanel — read-only monospace view of the active entity's
 * serialized definition, plus the "Save & Test" affordance.
 *
 * Visual target: the right column of `Editor Design/Entities.png` —
 * a syntax-highlighted JSON block topped by a small `JSON` eyebrow,
 * with a sticky amber `Save & Test` button at the bottom and a smaller
 * `Copy JSON` ghost button just under it.
 *
 * Wave 2 (this file) renders `MOCK_ENTITIES[0]` as the active entity.
 * Wave 3 wires the entity reference to the real prefabs selection
 * store. The panel itself never owns the entity — it merely projects
 * the currently-selected one as a JSON code block.
 *
 * Panel registry note: this panel is registered with `surface: false`
 * in `PrefabsView.tsx`, so we render flush against the dock group's
 * inner padding — no card chrome, no rounded background. The eyebrow
 * label + monospace `<pre>` carry the visual weight on their own.
 */

// ---------------------------------------------------------------------------
// Responsive breakpoints — measured on the panel root via ResizeObserver.
//
//   < FALLBACK_WIDTH_PX → render a "Resize panel" fallback. The JSON
//     block isn't legible below this point even with wrapping, and the
//     Save & Test button stops fitting its label.
//
// Wrapping is always on (`whitespace-pre-wrap`), so we never spawn a
// native horizontal scrollbar at any width above the fallback threshold.

const FALLBACK_WIDTH_PX = 120;

// ---------------------------------------------------------------------------
// Syntax highlighter — minimal, regex-based, no external deps.
//
// We walk a fresh `JSON.stringify(value, null, 2)` string and emit a
// `<span>` per matched token, escaping HTML on the way through. The
// regex covers:
//
//   • String keys     — `"foo":` → amber
//   • String values   — `"bar"`  → sky
//   • Numbers         — `1.5`    → emerald
//   • Booleans / null — `true`   → violet
//   • Braces/brackets — `{}[]`   → gray
//
// Everything else (whitespace, commas, colons) is passed through as
// muted text. Order in the regex matters — keys must be matched
// BEFORE bare string values so the trailing colon disambiguates them.
//
// We return a React fragment (array of spans + strings) rather than
// `dangerouslySetInnerHTML` so the rendered tree is properly escaped
// and React's reconciliation can diff each token if the entity changes.

type Token =
  | { kind: "key"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; text: string }
  | { kind: "punct"; text: string }
  | { kind: "plain"; text: string };

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\]])/g;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) {
      out.push({ kind: "plain", text: src.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      // Key — the regex consumed the trailing colon as well, but we
      // only want to color the quoted name. Emit the key, then a
      // punct-colored colon so it doesn't blend into the value.
      out.push({ kind: "key", text: m[1] });
      // Re-emit the gap between the closing quote and the colon, plus
      // the colon itself, as a punct token. `match[0]` is the whole
      // match including the colon, so we slice from the key's length.
      const tail = m[0].slice(m[1].length);
      out.push({ kind: "punct", text: tail });
    } else if (m[2] !== undefined) {
      out.push({ kind: "string", text: m[2] });
    } else if (m[3] !== undefined) {
      out.push({ kind: "number", text: m[3] });
    } else if (m[4] !== undefined) {
      out.push({ kind: "boolean", text: m[4] });
    } else if (m[5] !== undefined) {
      out.push({ kind: "punct", text: m[5] });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < src.length) {
    out.push({ kind: "plain", text: src.slice(last) });
  }
  return out;
}

function tokenClass(kind: Token["kind"]): string {
  switch (kind) {
    case "key":
      return "text-amber-300";
    case "string":
      return "text-sky-300";
    case "number":
      return "text-emerald-300";
    case "boolean":
      return "text-violet-300";
    case "punct":
      return "text-zinc-500";
    case "plain":
      return "text-zinc-400";
  }
}

function HighlightedJson({ value }: { value: unknown }): React.JSX.Element {
  const src = React.useMemo(() => JSON.stringify(value, null, 2), [value]);
  const tokens = React.useMemo(() => tokenize(src), [src]);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={tokenClass(t.kind)}>
          {t.text}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel root.

export function JsonPreviewPanel(): React.JSX.Element {
  // ---- State -------------------------------------------------------------
  //
  // Wave 2 — fixed to MOCK_ENTITIES[0]. Wave 3 will replace this with
  // a selector against the prefabs-selection store so the panel updates
  // as the user clicks rows in the EntityListPanel. Widening to plain
  // `EntityRow` keeps the rest of the panel typed against the interface
  // rather than the literal `as const` shape.
  const entity: EntityRow = React.useMemo(
    () => ({ ...MOCK_ENTITIES[0] }),
    [],
  );

  // Compute the JSON string once per entity change. Both the rendered
  // preview and the Copy command read from the same source so they
  // never drift.
  const jsonText = React.useMemo(
    () => JSON.stringify(entity, null, 2),
    [entity],
  );

  // ---- Responsive measurement -------------------------------------------

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState<number>(0);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const tooNarrow = width > 0 && width < FALLBACK_WIDTH_PX;

  // ---- Handlers ----------------------------------------------------------

  const saveAndTest = React.useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[prefabs] save and test", entity.id);
  }, [entity.id]);

  const copyJson = React.useCallback(() => {
    // Clipboard API may be missing in headless contexts or insecure
    // origins. Guard so the command never throws — log on failure so
    // the verification flow sees it.
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      navigator.clipboard.writeText(jsonText).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[prefabs] copy json failed", err);
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[prefabs] clipboard unavailable");
    }
  }, [jsonText]);

  // Stable handler refs so the command-registration effect never has
  // to re-run when the entity/json changes. The handlers themselves
  // are re-created via useCallback so the latest closure values stay
  // visible through the ref.
  const saveRef = React.useRef(saveAndTest);
  const copyRef = React.useRef(copyJson);
  React.useEffect(() => {
    saveRef.current = saveAndTest;
    copyRef.current = copyJson;
  }, [saveAndTest, copyJson]);

  // ---- Command registry -------------------------------------------------
  //
  // Mount-once registration; the handler refs above let the latest
  // closures flow through without a re-register on every render.
  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "prefabs.entity.saveAndTest",
        title: "Save & Test Entity",
        category: "Entity",
        keywords: ["entity", "prefab", "save", "test", "play"],
        description:
          "Save the active entity definition and launch a test instance in the scene preview (stub).",
        run: () => saveRef.current(),
      }),
      registerCommand({
        id: "prefabs.json.copy",
        title: "Copy Entity JSON",
        category: "Entity",
        keywords: ["entity", "prefab", "json", "copy", "clipboard"],
        description:
          "Copy the active entity's serialized JSON definition to the system clipboard.",
        run: () => copyRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ---- Render -----------------------------------------------------------

  if (tooNarrow) {
    return (
      <div
        ref={rootRef}
        data-panel="json-preview"
        // `data-tutorial-id="json-preview"` anchors the built-in
        // `prefabs-intro` step that shows the live JSON rendering.
        data-tutorial-id="json-preview"
        className="h-full w-full min-h-0 flex items-center justify-center"
      >
        <div className="text-[10px] uppercase tracking-[0.18em] text-(--color-fg-muted) text-center px-2">
          Resize panel
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-panel="json-preview"
      data-tutorial-id="json-preview"
      className="h-full w-full min-h-0 flex flex-col gap-1.5 overflow-x-hidden"
    >
      {/* Eyebrow — matches the page's other small section labels. */}
      <div className="shrink-0 flex items-center gap-1.5 px-0.5">
        <Braces
          size={10}
          aria-hidden="true"
          className="text-(--color-fg-muted)"
        />
        <span className="text-[10px] uppercase tracking-[0.18em] text-(--color-fg-muted) font-semibold">
          JSON
        </span>
        <span
          className="ml-auto text-[10px] text-(--color-fg-muted) truncate"
          aria-label={`Entity ${entity.name}`}
        >
          {entity.name}
        </span>
      </div>

      {/* Body — monospace preview. `whitespace-pre-wrap` keeps the
          JSON.stringify indentation while allowing long string values
          (asset paths, descriptions) to wrap within the panel width.
          `break-words` covers the case where a single token (e.g. a
          long URL) would otherwise force horizontal overflow. */}
      <pre
        className={[
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden",
          "text-[10px] font-mono tabular-nums leading-snug",
          "whitespace-pre-wrap break-words",
          "rounded border border-(--color-border-strong) bg-zinc-950/50",
          "p-2",
          "text-zinc-400",
        ].join(" ")}
        aria-label={`JSON preview of ${entity.name}`}
      >
        <code className="block">
          <HighlightedJson value={entity} />
        </code>
      </pre>

      {/* Sticky action cluster — stays pinned at the bottom regardless
          of preview length. Outside the scrollable <pre>, so it always
          remains in view. */}
      <div className="shrink-0 flex flex-col gap-1">
        <Tooltip
          side="top"
          stages={[
            { delay: 1000, content: <span>Save & Test</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Save & Test</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    Save the active entity definition and launch a test
                    instance in the scene preview (stub).
                  </div>
                </div>
              ),
            },
          ]}
          wrapperClassName="block w-full"
        >
          <button
            type="button"
            aria-label="Save & Test Entity"
            onClick={saveAndTest}
            className={[
              "w-full inline-flex items-center justify-center gap-1.5",
              "h-7 rounded",
              "bg-amber-500 hover:bg-amber-400 active:bg-amber-600",
              "text-zinc-950 font-medium text-[11px]",
              "transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-amber-300/60",
            ].join(" ")}
          >
            <Play size={12} aria-hidden="true" />
            <span>Save &amp; Test</span>
          </button>
        </Tooltip>

        <Tooltip
          side="top"
          stages={[
            { delay: 1000, content: <span>Copy JSON</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Copy JSON</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    Copy the entity's serialized JSON definition to the
                    system clipboard.
                  </div>
                </div>
              ),
            },
          ]}
          wrapperClassName="block w-full"
        >
          <button
            type="button"
            aria-label="Copy Entity JSON"
            onClick={copyJson}
            className={[
              "w-full inline-flex items-center justify-center gap-1.5",
              "h-6 rounded",
              "bg-transparent border border-(--color-border-strong)",
              "text-(--color-fg-secondary) text-[10px]",
              "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
              "transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-amber-300/40",
            ].join(" ")}
          >
            <Copy size={11} aria-hidden="true" />
            <span>Copy JSON</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "json-preview",
  title: "JSON",
  category: "Diagnostics",
  icon: <Braces size={12} />,
};

export default JsonPreviewPanel;
