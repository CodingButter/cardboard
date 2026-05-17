import React from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui";
import { DropdownMenu } from "./DropdownMenu";
import { IconButton } from "./IconButton";
import { StatusPill } from "./StatusPill";
import logoUrl from "../../assets/logo.png" with { type: "file" };

/**
 * TopBar — §4.11.
 *
 * Full app header (~64px tall). Layout L→R:
 *   1. Cardboard logo image + wordmark.
 *   2. Vertical separator.
 *   3. Project dropdown (label "PROJECT" above).
 *   4. Scene dropdown (label "SCENE" above).
 *   5. Spacer.
 *   6. Save-state StatusPill.
 *   7. Playtest toggle button.
 *   8. Export button.
 *   9. Save button.
 *   10. Settings IconButton.
 *   11. Avatar disc.
 *
 * Per the brief: no red plaque from the mockup; logo image (28-32px)
 * plus the CARDBOARD wordmark in `text-lg` is the canonical brand
 * mark.
 */

export type SaveState = "saved" | "saving" | "dirty" | "error";

export interface TopBarProject {
  id: string;
  name: string;
}

export interface TopBarScene {
  path: string;
  label: string;
}

export interface TopBarProps {
  projectName: string;
  projects: ReadonlyArray<TopBarProject>;
  onSelectProject: (id: string) => void;
  /** When the project picker should be disabled (e.g. on Home). */
  projectsDisabled?: boolean;
  sceneName: string;
  scenes: ReadonlyArray<TopBarScene>;
  onSelectScene: (path: string) => void;
  scenesDisabled?: boolean;
  saveState: SaveState;
  playtestActive: boolean;
  onTogglePlaytest: () => void;
  onExport: () => void;
  onSave: () => void;
  onOpenSettings: () => void;
  userInitials?: string;
  /** Logo image path. Defaults to the bundled cardboard hex. */
  logoSrc?: string;
  className?: string;
}

export function TopBar({
  projectName,
  projects,
  onSelectProject,
  projectsDisabled = false,
  sceneName,
  scenes,
  onSelectScene,
  scenesDisabled = false,
  saveState,
  playtestActive,
  onTogglePlaytest,
  onExport,
  onSave,
  onOpenSettings,
  userInitials,
  logoSrc = logoUrl,
  className,
}: TopBarProps) {
  const currentProject = projects.find((p) => p.name === projectName);
  const currentSceneId = scenes.find((s) => s.label === sceneName)?.path ?? "";

  return (
    <header
      className={cn(
        "flex items-stretch h-16 px-5 gap-4",
        "border-b border-zinc-800 bg-zinc-950/80 backdrop-blur",
        className,
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <img
          src={logoSrc}
          alt="cardboard"
          width={32}
          height={32}
          className="w-8 h-8 object-contain"
          draggable={false}
        />
        <div className="leading-tight">
          <div className="text-lg font-black tracking-tight text-zinc-100">
            CARDBOARD
          </div>
          <div className="text-[10px] tracking-[0.25em] text-zinc-500 font-medium">
            EDITOR
          </div>
        </div>
      </div>

      <Separator />

      {/* Project picker */}
      <DropdownField
        label="PROJECT"
        valueDisplay={projectName || "—"}
        disabled={projectsDisabled || projects.length === 0}
      >
        <DropdownMenu
          trigger={
            <div className="flex items-center justify-between w-full h-9 px-3 border border-zinc-800 rounded-md bg-zinc-900/60 text-sm text-zinc-100">
              <span className="truncate">{projectName || "—"}</span>
              <Chevron />
            </div>
          }
          value={currentProject?.id ?? ""}
          options={projects.map((p) => ({ id: p.id, label: p.name }))}
          onChange={onSelectProject}
          disabled={projectsDisabled || projects.length === 0}
          width={224}
        />
      </DropdownField>

      {/* Scene picker */}
      <DropdownField
        label="SCENE"
        valueDisplay={sceneName || "—"}
        disabled={scenesDisabled || scenes.length === 0}
      >
        <DropdownMenu
          trigger={
            <div className="flex items-center justify-between w-full h-9 px-3 border border-zinc-800 rounded-md bg-zinc-900/60 text-sm text-zinc-100">
              <span className="truncate">{sceneName || "—"}</span>
              <Chevron />
            </div>
          }
          value={currentSceneId}
          options={scenes.map((s) => ({ id: s.path, label: s.label }))}
          onChange={onSelectScene}
          disabled={scenesDisabled || scenes.length === 0}
          width={224}
        />
      </DropdownField>

      <div className="flex-1" />

      {/* Right-side actions */}
      <div className="flex items-center gap-3 shrink-0">
        <SavePill state={saveState} />
        <Button
          variant={playtestActive ? "primary" : "secondary"}
          size="sm"
          onClick={onTogglePlaytest}
          className="gap-2"
        >
          <PlayIcon />
          Playtest
        </Button>
        <Button variant="secondary" size="sm" onClick={onExport} className="gap-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10">
          <UploadIcon />
          Export
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} className="gap-2">
          <SaveIcon />
          Save
        </Button>
        <IconButton
          icon={<GearIcon />}
          tooltip="Settings"
          onClick={onOpenSettings}
        />
        {userInitials && (
          <div
            className={cn(
              "w-9 h-9 rounded-full inline-flex items-center justify-center",
              "bg-sky-500/10 border border-sky-500/30 text-sky-300 text-sm font-semibold",
            )}
            aria-label="User"
          >
            {userInitials}
          </div>
        )}
      </div>
    </header>
  );
}

function Separator() {
  return <span className="self-center w-px h-8 bg-zinc-800" aria-hidden="true" />;
}

function DropdownField({
  label,
  children,
  disabled,
  valueDisplay: _valueDisplay,
}: {
  label: string;
  children: React.ReactNode;
  disabled: boolean;
  valueDisplay: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-0.5 w-[224px] shrink-0",
        disabled && "opacity-60",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

function SavePill({ state }: { state: SaveState }) {
  switch (state) {
    case "saved":
      return <StatusPill variant="ok">All changes saved</StatusPill>;
    case "saving":
      return <StatusPill variant="info">Saving…</StatusPill>;
    case "dirty":
      return <StatusPill variant="warn">Unsaved changes</StatusPill>;
    case "error":
      return <StatusPill variant="error">Save failed</StatusPill>;
  }
}

/* Minimal inline SVG icons so TopBar doesn't depend on lucide-react.
   Callers in R4 can replace these by passing custom action elements
   if richer iconography is wanted. */

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-zinc-400">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
