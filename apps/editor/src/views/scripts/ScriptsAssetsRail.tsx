import React from "react";
import { AudioWaveform, Box, Copy, Image as ImageIcon } from "lucide-react";
import {
  CollapsibleSection,
  IconButton,
  PanelHeader,
  ScrollArea,
  Tooltip,
} from "../../components/ui/index";
import { cn } from "../../lib/cn";
import type { PackManifest } from "@two_5_d/engine";

/**
 * ScriptsAssetsRail — right rail of the Scripts view.
 *
 * Lists the pack's sprite / sound / prefab ids so authors can copy a
 * canonical reference into the active script without context-
 * switching back to the Asset library tab. Each row click copies the
 * id (or full `api.audio.play("…")` snippet for sounds) to the
 * clipboard.
 */

export interface ScriptsAssetsRailProps {
  manifest: PackManifest | null;
  /** Called with an inserted snippet; the editor pastes at the cursor. */
  onInsertSnippet?: (snippet: string) => void;
}

export function ScriptsAssetsRail({
  manifest,
  onInsertSnippet,
}: ScriptsAssetsRailProps) {
  const sprites = React.useMemo(
    () => (manifest?.sprites ? Object.keys(manifest.sprites).sort() : []),
    [manifest?.sprites],
  );
  const sounds = React.useMemo(
    () => (manifest?.sounds ? Object.keys(manifest.sounds).sort() : []),
    [manifest?.sounds],
  );
  const prefabs = React.useMemo(
    () => (manifest?.prefabs ? Object.keys(manifest.prefabs).sort() : []),
    [manifest?.prefabs],
  );

  return (
    <aside className="flex flex-col h-full min-h-0 border-l border-zinc-800 bg-zinc-950/40 w-[280px] shrink-0">
      <PanelHeader title="Assets" />
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-2 space-y-2">
          <AssetGroup
            id="sprites"
            label={`Sprites (${sprites.length})`}
            icon={<ImageIcon size={13} className="text-amber-400/80" />}
            ids={sprites}
            emptyHint="No sprites declared in manifest.sprites."
            buildSnippet={(id) => `"${id}"`}
            onInsertSnippet={onInsertSnippet}
          />
          <AssetGroup
            id="sounds"
            label={`Sounds (${sounds.length})`}
            icon={<AudioWaveform size={13} className="text-amber-400/80" />}
            ids={sounds}
            emptyHint="No sounds declared in manifest.sounds."
            buildSnippet={(id) => `api.audio.play("${id}")`}
            onInsertSnippet={onInsertSnippet}
          />
          <AssetGroup
            id="prefabs"
            label={`Prefabs (${prefabs.length})`}
            icon={<Box size={13} className="text-amber-400/80" />}
            ids={prefabs}
            emptyHint="No prefabs declared in manifest.prefabs."
            buildSnippet={(id) => `api.spawn("${id}")`}
            onInsertSnippet={onInsertSnippet}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}

interface AssetGroupProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  ids: ReadonlyArray<string>;
  emptyHint: string;
  buildSnippet: (id: string) => string;
  onInsertSnippet?: (snippet: string) => void;
}

function AssetGroup({
  id,
  label,
  icon,
  ids,
  emptyHint,
  buildSnippet,
  onInsertSnippet,
}: AssetGroupProps) {
  void id;
  return (
    <CollapsibleSection title={label} defaultOpen>
      {ids.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-zinc-500 italic">
          {emptyHint}
        </div>
      ) : (
        <ul className="text-xs">
          {ids.map((entryId) => (
            <AssetRow
              key={entryId}
              entryId={entryId}
              icon={icon}
              snippet={buildSnippet(entryId)}
              onInsertSnippet={onInsertSnippet}
            />
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

function AssetRow({
  entryId,
  icon,
  snippet,
  onInsertSnippet,
}: {
  entryId: string;
  icon: React.ReactNode;
  snippet: string;
  onInsertSnippet?: (s: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {
      // Clipboard write can reject under non-secure contexts — fall back
      // to insertion if available.
      onInsertSnippet?.(snippet);
    }
  }, [snippet, onInsertSnippet]);

  return (
    <li
      className={cn(
        "group flex items-center gap-2 px-2 h-7 rounded-sm",
        "text-zinc-300 hover:bg-zinc-900/60 cursor-pointer",
      )}
      onClick={() => onInsertSnippet?.(snippet)}
      title={snippet}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1 font-mono text-[11px]">{entryId}</span>
      <Tooltip content={copied ? "Copied!" : "Copy snippet"}>
        <IconButton
          icon={<Copy size={11} />}
          tooltip={copied ? "Copied!" : "Copy snippet"}
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void copy();
          }}
        />
      </Tooltip>
    </li>
  );
}
