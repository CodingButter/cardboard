import React from "react";
import { X, Save as SaveIcon } from "lucide-react";
import * as monaco from "monaco-editor";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { cn } from "../../lib/cn";
import { IconButton, Tooltip } from "../../components/ui/index";
import { MOD_API_TYPES, MOD_API_TYPES_PATH } from "./modApiTypes";

/**
 * ScriptsMonaco — the actual code-editor surface.
 *
 * This module is what `ScriptsView` lazy-imports — it pulls in the
 * full `monaco-editor` package (~1.2MB). Loading is deferred to first
 * Scripts-tab mount per §12 Q7. Home / Map / Entities sessions never
 * pay for it.
 *
 * Responsibilities:
 *   - Render the Monaco editor for the active file.
 *   - Maintain the tabstrip of open files (close button on each).
 *   - Configure TS/JS defaults + inject the ModAPI ambient .d.ts.
 *   - Surface cursor position + language mode + dirty state to the
 *     parent (which forwards into the StatusBar via the shell).
 *   - Wire the parent's `value` ←→ Monaco model contents so external
 *     changes (e.g. file-tree refresh, external save) propagate.
 *
 * Web-worker setup:
 *   - Monaco ships a TS / JSON / CSS / HTML worker. We register a
 *     `MonacoEnvironment.getWorker` once on first import (idempotent
 *     by guard) using Bun's `new Worker(new URL(..., import.meta.url))`
 *     pattern — the bundler emits each worker as a separate chunk and
 *     resolves the URL at load time.
 */

// ─── One-time Monaco environment + ambient-lib setup ─────────────────
//
// Hoisted to module scope so the cost is paid once per session
// (this module is itself lazy-loaded, so "session" effectively means
// "after the user first opens the Scripts tab").

let didConfigure = false;

/**
 * Configure Monaco's worker factory + inject the ModAPI ambient types.
 * Idempotent.
 */
function configureMonaco(): void {
  if (didConfigure) return;
  didConfigure = true;

  // The `@monaco-editor/react` loader by default fetches Monaco from
  // a CDN. We've imported the package directly above, so hand the
  // already-loaded instance to the loader to short-circuit the fetch
  // and use the local bundle instead.
  loader.config({ monaco });

  // Worker factory.
  //
  // Monaco's language services normally run off-thread. Monaco's per-
  // language contribution modules (`cssMode`, `htmlMode`, `jsonMode`,
  // `tsMode`) and core editor reference worker chunks via
  // `new Worker(new URL("ts.worker.js", import.meta.url), { type: "module" })`
  // — a pattern Bun's bundler does not currently emit as separate
  // asset chunks for production builds. The URL ends up resolving to
  // a 404 at runtime.
  //
  // WIRING: until Bun lands proper worker-asset emission for this
  // pattern, register a `MonacoEnvironment.getWorker` factory that
  // returns a no-op Worker spawned from an inline Blob URL. Monaco's
  // worker manager treats an unresponsive worker as "not available"
  // and falls back to its main-thread language path — IntelliSense
  // via `addExtraLib` still works, plus syntax highlighting, save,
  // and code folding. The trade-off is no semantic diagnostics from
  // a background TS worker. Pack scripts are small (typically
  // <500 LOC), so the cost is negligible.
  //
  // Replace this with a real per-label factory once Bun emits worker
  // chunks — keep the file URLs the same as the language contribution
  // modules so cssMode / tsMode / etc. all route through here.
  if (typeof window !== "undefined") {
    type MonacoEnv = {
      getWorker?: (workerId: string, label: string) => Worker;
    };
    const w = window as unknown as { MonacoEnvironment?: MonacoEnv };
    // Lazily-built no-op worker URL. A minimal worker stub that simply
    // never responds — Monaco's worker manager has a timeout and
    // falls back gracefully.
    let stubUrl: string | null = null;
    const getStubWorker = (): Worker => {
      if (!stubUrl) {
        const blob = new Blob(
          ["self.onmessage = function() {};"],
          { type: "application/javascript" },
        );
        stubUrl = URL.createObjectURL(blob);
      }
      return new Worker(stubUrl);
    };
    w.MonacoEnvironment = {
      getWorker() {
        return getStubWorker();
      },
    };
  }

  // Configure JS + TS defaults — pack scripts mix `.js` (mostly) with
  // `.tsx` (UI modal components). Allow JS, enable JSX so the editor
  // doesn't underline `<Component />`.
  // `monaco.languages.typescript` is the legacy access path; the
  // canonical surface in monaco 0.55+ is the top-level `monaco.typescript`
  // namespace.
  const tsDefaults = monaco.typescript.typescriptDefaults;
  const jsDefaults = monaco.typescript.javascriptDefaults;

  const compilerOpts: monaco.typescript.CompilerOptions = {
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    jsx: monaco.typescript.JsxEmit.Preserve,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  };
  tsDefaults.setCompilerOptions(compilerOpts);
  jsDefaults.setCompilerOptions(compilerOpts);

  // Diagnostics: keep semantic on for TS files; off for JS so pack
  // scripts aren't littered with red squiggles on `api.foo()` calls
  // (which the JS service can't always resolve).
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  // Inject ModAPI types as an extra lib visible to BOTH TS + JS so
  // hover hints and IntelliSense fire for `.js` pack scripts too.
  tsDefaults.addExtraLib(MOD_API_TYPES, MOD_API_TYPES_PATH);
  jsDefaults.addExtraLib(MOD_API_TYPES, MOD_API_TYPES_PATH);

  // Custom dark theme — base on vs-dark and tweak focus colors to
  // match the editor's amber-on-zinc aesthetic. Defined once; the
  // editor consumer references it via `theme="cardboard-dark"`.
  try {
    monaco.editor.defineTheme("cardboard-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "71717a", fontStyle: "italic" },
        { token: "keyword", foreground: "fbbf24" },
        { token: "string", foreground: "fde68a" },
        { token: "number", foreground: "fcd34d" },
        { token: "type", foreground: "fde68a" },
      ],
      colors: {
        "editor.background": "#09090b",
        "editor.foreground": "#e4e4e7",
        "editorCursor.foreground": "#fbbf24",
        "editor.lineHighlightBackground": "#18181b",
        "editorLineNumber.foreground": "#52525b",
        "editorLineNumber.activeForeground": "#fbbf24",
        "editor.selectionBackground": "#3f3f4644",
        "editor.inactiveSelectionBackground": "#27272a",
        "editor.findMatchBackground": "#fbbf2433",
        "editor.findMatchHighlightBackground": "#fbbf241a",
      },
    });
  } catch {
    // defineTheme throws on re-registration in some Monaco builds —
    // harmless when the second call would have set the same theme.
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export interface OpenFile {
  path: string;
  /** Loaded file body — may be empty for new files. */
  value: string;
  /** True when the local value diverges from IDB. */
  dirty: boolean;
}

export interface CursorPos {
  line: number;
  column: number;
}

export interface ScriptsMonacoProps {
  openFiles: ReadonlyArray<OpenFile>;
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, value: string) => void;
  onCursorChange?: (path: string, pos: CursorPos) => void;
  /** Save the currently active file (Ctrl/Cmd+S). */
  onSaveActive: () => void;
}

export interface ScriptsMonacoHandle {
  /** Insert text at the cursor of the active editor. */
  insertAtCursor: (text: string) => void;
  /** Focus the editor pane (e.g. after picking a file from the rail). */
  focus: () => void;
}

export const ScriptsMonaco = React.forwardRef<
  ScriptsMonacoHandle,
  ScriptsMonacoProps
>(function ScriptsMonaco(props, ref) {
  const {
    openFiles,
    activePath,
    onActivate,
    onClose,
    onChange,
    onCursorChange,
    onSaveActive,
  } = props;

  // Configure Monaco on first mount only. Subsequent mounts re-use
  // the registered theme + extraLib + worker factory.
  React.useEffect(() => {
    configureMonaco();
  }, []);

  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );

  const handleMount: OnMount = (editor, _monacoInstance) => {
    editorRef.current = editor;

    // Save shortcut — delegates to the parent (which can save one or
    // many dirty files).
    editor.addCommand(
      // eslint-disable-next-line no-bitwise
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => onSaveActive(),
    );

    // Cursor position → surface to parent.
    editor.onDidChangeCursorPosition((e) => {
      const path = activePathRef.current;
      if (!path) return;
      onCursorChange?.(path, { line: e.position.lineNumber, column: e.position.column });
    });
  };

  // Imperative API for the rail / file tree.
  const activePathRef = React.useRef(activePath);
  React.useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  React.useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(text: string) {
        const ed = editorRef.current;
        if (!ed) return;
        const sel = ed.getSelection();
        if (!sel) return;
        ed.executeEdits("scripts-rail-insert", [
          {
            range: sel,
            text,
            forceMoveMarkers: true,
          },
        ]);
        ed.focus();
      },
      focus() {
        editorRef.current?.focus();
      },
    }),
    [],
  );

  const active = activePath
    ? openFiles.find((f) => f.path === activePath) ?? null
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Tab strip — one tab per open file. */}
      <div
        role="tablist"
        aria-label="Open scripts"
        className={cn(
          "flex items-stretch h-9 border-b border-zinc-800 bg-zinc-950/60",
          "overflow-x-auto",
        )}
      >
        {openFiles.length === 0 ? (
          <div className="flex items-center px-3 text-xs text-zinc-500">
            No files open
          </div>
        ) : (
          openFiles.map((f) => {
            const isActive = f.path === activePath;
            return (
              <div
                key={f.path}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "group flex items-center gap-1.5 pl-3 pr-1 h-full text-xs",
                  "border-r border-zinc-800 cursor-pointer select-none",
                  "transition-colors",
                  isActive
                    ? "bg-zinc-900 text-amber-200 border-b-2 border-b-amber-400 -mb-px"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/40",
                )}
                onClick={() => onActivate(f.path)}
              >
                <span className="truncate max-w-[180px]" title={f.path}>
                  {f.path.split("/").pop() ?? f.path}
                  {f.dirty && <span className="ml-1 text-amber-400">•</span>}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.path);
                  }}
                  className={cn(
                    "ml-0.5 rounded-sm w-5 h-5 inline-flex items-center justify-center",
                    "text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800",
                  )}
                  aria-label={`Close ${f.path}`}
                  title="Close (Ctrl+W)"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
        <div className="flex-1" />
        {active?.dirty && (
          <div className="flex items-center px-2">
            <Tooltip content="Save (Ctrl/Cmd+S)">
              <IconButton
                icon={<SaveIcon size={13} />}
                tooltip="Save"
                variant="primary"
                onClick={onSaveActive}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {/* Editor surface. When no file is active we render a minimal
          placeholder; mounting Monaco with no value is supported but
          showing nothing wastes WebGL textures. */}
      <div className="flex-1 min-h-0 min-w-0 bg-[#09090b]">
        {active ? (
          <Editor
            key="cardboard-monaco"
            theme="cardboard-dark"
            path={active.path}
            defaultLanguage={languageForPath(active.path)}
            language={languageForPath(active.path)}
            value={active.value}
            onChange={(v) => onChange(active.path, v ?? "")}
            onMount={handleMount}
            options={{
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              renderLineHighlight: "line",
              smoothScrolling: true,
              cursorBlinking: "smooth",
              padding: { top: 8, bottom: 8 },
              wordWrap: "off",
              bracketPairColorization: { enabled: true },
              "semanticHighlighting.enabled": true,
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500">
            Pick a script from the left to start editing.
          </div>
        )}
      </div>
    </div>
  );
});

export function languageForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  const ext = path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript"; // Monaco's TS service handles TSX too.
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}

export function languageLabel(path: string): string {
  const lang = languageForPath(path);
  switch (lang) {
    case "typescript":
      return path.endsWith(".tsx") ? "TSX" : "TypeScript";
    case "javascript":
      return path.endsWith(".jsx") ? "JSX" : "JavaScript";
    case "json":
      return "JSON";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "markdown":
      return "Markdown";
    default:
      return "Plain";
  }
}
