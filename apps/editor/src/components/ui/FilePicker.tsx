import React from "react";
import { cn } from "../../lib/cn";

/**
 * FilePicker — §4.20.
 *
 * Two render modes:
 *   - `button`: a single trigger that opens the native file dialog.
 *   - `dropzone`: a large drag-drop surface plus a "click to browse"
 *     fallback. Used by HomeScreen ("Import Pack") and Assets.
 *
 * Hidden `<input type="file">` does the heavy lifting; we just
 * forward drag-drop events into the same `onFiles` callback.
 */

export interface FilePickerProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  mode?: "button" | "dropzone";
  /** Inside-dropzone children (icon + caption). */
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function FilePicker({
  accept,
  multiple = false,
  onFiles,
  mode = "button",
  children,
  disabled = false,
  className,
}: FilePickerProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const openPicker = () => inputRef.current?.click();
  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  };

  // The hidden input is shared by both render modes — we just style
  // the trigger differently.
  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      onChange={(e) => {
        handleFiles(e.target.files);
        // Reset so the same file can be re-picked.
        e.target.value = "";
      }}
      disabled={disabled}
      className="hidden"
    />
  );

  if (mode === "button") {
    return (
      <>
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-2 h-9 px-4 rounded-md",
            "border border-zinc-700 bg-zinc-800 text-zinc-100 text-sm font-medium",
            "hover:bg-zinc-700 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          {children ?? "Choose file…"}
        </button>
        {hiddenInput}
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && openPicker()}
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        "rounded-lg border-2 border-dashed text-center cursor-pointer",
        "px-6 py-10 transition-colors",
        "focus-within:ring-2 focus-within:ring-amber-400",
        dragOver
          ? "border-amber-500 bg-amber-500/5 text-amber-200"
          : "border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-950/60",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {children ?? <DefaultDropzoneContent />}
      {hiddenInput}
    </div>
  );
}

function DefaultDropzoneContent() {
  return (
    <>
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <div className="space-y-0.5">
        <div className="text-sm text-zinc-200 font-medium">
          Drop files here or click to browse
        </div>
      </div>
    </>
  );
}
