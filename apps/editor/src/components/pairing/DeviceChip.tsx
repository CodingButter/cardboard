import React from "react";
import * as Lucide from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";
import { sendMountPanel } from "../../state/desktopPairingSingleton";
import type { PairedPeerEntry } from "../../state/useDesktopPairingStore";

/**
 * DeviceChip — a per-paired-peer drag target rendered in the TopBar.
 *
 * Visual: a 28×28 rounded chip tinted with the device's identity colour,
 * stamped with its identity lucide icon. Hover surfaces a progressive
 * tooltip with the device's name + tier + paired peer-id (last 6 chars
 * for support-debug).
 *
 * Drag-target mechanics:
 *
 *   • A dockview panel-tab drag puts `dockview/panel-id` on the
 *     dataTransfer.types list. We sniff that MIME on `dragover` and
 *     `dragenter` — no need to plug into dockview's API from up here,
 *     and the chip will accept tab drags from popouts too (any window
 *     whose dockview tabs put the same MIME on the wire). When the
 *     MIME is present we call `preventDefault()` so a `drop` fires.
 *
 *   • While ANY drag is in flight the chip glows at low intensity to
 *     advertise itself as a target. The cursor entering the chip's
 *     bbox upgrades the glow to "accept-drop". This matches the trash
 *     drop target's two-stage treatment in WorkspacePanel.
 *
 *   • On drop we read `dockview/panel-id` from `dataTransfer`, look it
 *     up against the page's registry to derive a label, and call
 *     `sendMountPanel(peerId, ...)`. For now the handler also fires a
 *     short flash + console.log — the sidecar-side mount handler is
 *     M2 work.
 *
 * Why two visual stages?
 *   The trash icon in the workspace rail uses the same idle→armed
 *   progression and users have learned to read it as "drop target
 *   present, ready to receive." Keeping the convention reduces the
 *   number of distinct drag-affordance vocabularies a user has to
 *   recognise.
 */

export interface DeviceChipProps {
  /**
   * The paired-peer entry. Carries identity (name + colour + icon) +
   * status so the chip can render an at-rest pip and gate sending.
   */
  entry: PairedPeerEntry;
  /**
   * Resolve a dockview panel-id to a human-readable label for the
   * `mountPanel` wire message. Falls back to the id itself when the
   * lookup misses (e.g. third-party pack panel the desktop registry
   * doesn't know about).
   */
  resolvePanelLabel?: (panelId: string) => string | undefined;
  /** Whether ANY drag is currently in flight on the document. Driven
   *  by the parent container — see `TopBarDeviceChips`. */
  dragActive: boolean;
}

/**
 * The HTML5 DataTransfer type dockview attaches to panel-tab drags.
 * Sniffing this is how we tell a panel drag from any other drag (asset,
 * native file, text selection) without dockview-API access.
 */
const DOCKVIEW_PANEL_MIME = "dockview/panel-id";

/**
 * Returns true if the DataTransfer carries dockview's panel-id MIME.
 * Defensive: older browsers expose `types` as DOMStringList; iterate
 * with for-loop rather than relying on `.includes`.
 */
function dataTransferHasPanelMime(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = dt.types;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === DOCKVIEW_PANEL_MIME) return true;
  }
  return false;
}

export function DeviceChip({
  entry,
  resolvePanelLabel,
  dragActive,
}: DeviceChipProps): React.JSX.Element {
  const [isOver, setIsOver] = React.useState(false);
  const [flash, setFlash] = React.useState<"idle" | "sent" | "failed">("idle");
  const enterCountRef = React.useRef(0);
  const identity = entry.identity;

  const color = identity?.color ?? "#3b82f6";
  const iconName = identity?.icon ?? "Smartphone";
  const tier = entry.deviceTier ?? "device";
  const connected = entry.status === "connected";
  // M2: the chip carries a small accent stripe when a panel is
  // currently mounted on this device. The sidecar's `unmountPanel`
  // (back button) clears `mountedKind`, which clears the stripe.
  const mounted = Boolean(entry.mountedKind);

  const handleDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!connected) return;
      if (!dataTransferHasPanelMime(e.dataTransfer)) return;
      // preventDefault is what makes the browser fire `drop` on us.
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
    },
    [connected],
  );

  const handleDragEnter = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!connected) return;
      if (!dataTransferHasPanelMime(e.dataTransfer)) return;
      enterCountRef.current += 1;
      if (enterCountRef.current === 1) setIsOver(true);
    },
    [connected],
  );

  const handleDragLeave = React.useCallback(
    (_e: React.DragEvent<HTMLDivElement>) => {
      enterCountRef.current = Math.max(0, enterCountRef.current - 1);
      if (enterCountRef.current === 0) setIsOver(false);
    },
    [],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      enterCountRef.current = 0;
      setIsOver(false);
      if (!connected) return;
      const panelId = e.dataTransfer?.getData(DOCKVIEW_PANEL_MIME);
      if (!panelId) return;
      const label = resolvePanelLabel?.(panelId) ?? panelId;
      // Tablet/desktop tiers can host multi-pane layouts so a side
      // hint is meaningful; mobile is tab-only. The mountPanel handler
      // on the sidecar is responsible for honouring or ignoring the
      // hint per its tier.
      const asTab = tier === "mobile";
      const ok = sendMountPanel(entry.id, {
        panelKind: panelId,
        label,
        asTab,
      });
      // Visual confirmation: brief flash + log line. Toast would be
      // overkill given there's no toast surface yet (see task #16's
      // deferred items).
      // eslint-disable-next-line no-console
      console.info(
        `[device-chip] mountPanel → ${entry.id.slice(0, 8)}… (${
          identity?.name ?? "unknown"
        }): ${panelId}`,
        { ok, label, asTab },
      );
      setFlash(ok ? "sent" : "failed");
      // 900ms holds long enough to read on a quick gesture, short
      // enough that a rapid second drag isn't blocked by the visual.
      window.setTimeout(() => setFlash("idle"), 900);
    },
    [connected, entry.id, identity?.name, resolvePanelLabel, tier],
  );

  // Visibility: the chip dims to ~70% opacity at rest so it doesn't
  // crowd the TopBar's action cluster; brightens to full opacity once
  // a drag is in flight so the user can find their target without
  // scanning.
  const visibility = dragActive ? "opacity-100" : "opacity-80";

  const ring = isOver
    ? "ring-2 ring-offset-1 ring-offset-(--color-bg-app) shadow-lg"
    : dragActive && connected
      ? "ring-1"
      : "";

  // Use the device's identity color for the ring tint so the chip
  // feels like the same object as its identity card in the modal.
  const ringStyle: React.CSSProperties = isOver
    ? { boxShadow: `0 0 0 2px ${color}cc, 0 4px 12px ${color}66` }
    : dragActive && connected
      ? { boxShadow: `0 0 0 1px ${color}80` }
      : {};

  const flashStyle: React.CSSProperties =
    flash === "sent"
      ? { boxShadow: `0 0 0 2px #10b981, 0 0 12px #10b981aa` }
      : flash === "failed"
        ? { boxShadow: `0 0 0 2px #ef4444, 0 0 12px #ef4444aa` }
        : {};

  return (
    <Tooltip
      side="bottom"
      stages={[
        {
          delay: 800,
          content: (
            <span>
              {identity?.name ?? "Unknown device"}
            </span>
          ),
        },
        {
          delay: 2400,
          content: (
            <div>
              <div className="font-semibold">
                {identity?.name ?? "Unknown device"}
              </div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[260px] capitalize">
                {tier} · {entry.status}
              </div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                Drag a panel tab here to send it to this device.
              </div>
            </div>
          ),
        },
      ]}
    >
      <div
        role="button"
        aria-label={`Send panel to ${identity?.name ?? "device"}`}
        data-testid={`device-chip-${entry.id}`}
        data-drag-active={dragActive ? "true" : undefined}
        data-drop-over={isOver ? "true" : undefined}
        data-flash={flash}
        data-mounted={mounted ? "true" : undefined}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative inline-flex items-center justify-center",
          "h-7 w-7 rounded-md shrink-0",
          "transition-all duration-150",
          visibility,
          ring,
          !connected && "opacity-40 grayscale",
        )}
        style={{
          backgroundColor: `${color}1f`,
          borderColor: `${color}66`,
          color,
          borderWidth: 1,
          borderStyle: "solid",
          ...ringStyle,
          ...flashStyle,
        }}
      >
        <LucideByName name={iconName} className="w-4 h-4" color={color} />
        {/* M2: top-edge stripe lit when a panel is currently mounted
         *  on this sidecar. Sized small + tinted from identity color so
         *  it reads as "this chip has cargo" without competing with the
         *  status pip in the corner. */}
        {mounted && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 left-1 right-1 h-[2px] rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        {/* Tiny status pip in the bottom-right corner. Emerald when
         *  connected; amber when connecting; zinc when ended. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full",
            "border border-(--color-bg-app)",
            entry.status === "connected"
              ? "bg-emerald-400"
              : entry.status === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-zinc-500",
          )}
        />
      </div>
    </Tooltip>
  );
}

/**
 * Resolve a lucide icon by name. Falls back to `Smartphone` since this
 * helper is used by the device-icon UX exclusively — `Square` would be
 * misleading in that context.
 */
function LucideByName({
  name,
  className,
  color,
}: {
  name: string;
  className?: string;
  color?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Lucide as Record<string, any>)[name] as
    | React.ComponentType<{
        className?: string;
        size?: number;
        color?: string;
      }>
    | undefined;
  if (!Icon) {
    return <Lucide.Smartphone className={className} color={color} />;
  }
  return <Icon className={className} color={color} />;
}
