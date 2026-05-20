import React from "react";
import { DeviceChip } from "./DeviceChip";
import { useDesktopPairingStore } from "../../state/useDesktopPairingStore";

/**
 * TopBarDeviceChips — the cluster of paired-device drop targets that
 * lives in the editor's TopBar between the Save action and the Pair
 * button.
 *
 * Responsibilities:
 *   1. Subscribe to `useDesktopPairingStore.pairedPeers` and render one
 *      `<DeviceChip>` per CONNECTED peer. Connecting / ended peers are
 *      filtered out — the chip is a drop target, and a half-up
 *      connection isn't ready to receive yet.
 *   2. Maintain a `dragActive` flag from window-level dragstart /
 *      dragend events. This is the visual hint that "drop targets are
 *      live right now"; without it chips at-rest would compete for the
 *      user's attention.
 *   3. Resolve dockview panel-ids to human labels via a caller-provided
 *      registry lookup (so the `mountPanel` wire message carries
 *      something readable for the sidecar to render in its header).
 *
 * The cluster is invisible (zero width) when no peers are paired, so it
 * doesn't interfere with the TopBar layout pre-pairing.
 */

export interface TopBarDeviceChipsProps {
  /**
   * Resolve a dockview panel-id to a label. Threaded from the editor
   * shell, which has the active page's registry. The chips themselves
   * are kept registry-agnostic so they remain reusable in pages where
   * the registry layout differs.
   */
  resolvePanelLabel?: (panelId: string) => string | undefined;
}

export function TopBarDeviceChips({
  resolvePanelLabel,
}: TopBarDeviceChipsProps): React.JSX.Element | null {
  const pairedPeers = useDesktopPairingStore((s) => s.pairedPeers);
  const [dragActive, setDragActive] = React.useState(false);

  React.useEffect(() => {
    const onDragStart = () => setDragActive(true);
    const onDragEnd = () => setDragActive(false);
    // `drop` clears dragActive too — some browsers don't fire dragend
    // reliably after a successful drop in a different window.
    const onDrop = () => setDragActive(false);
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  // Sort: connected first (drop-eligible), then connecting, then ended
  // (visually muted by the chip itself). Within each bucket, sort by
  // connectedAt for deterministic order across re-renders.
  const sorted = React.useMemo(() => {
    const entries = Object.values(pairedPeers);
    const statusWeight = (s: string) =>
      s === "connected" ? 0 : s === "connecting" ? 1 : 2;
    return entries
      .filter((e) => e.status !== "ended")
      .sort((a, b) => {
        const sa = statusWeight(a.status);
        const sb = statusWeight(b.status);
        if (sa !== sb) return sa - sb;
        return a.connectedAt - b.connectedAt;
      });
  }, [pairedPeers]);

  if (sorted.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      aria-label="Paired devices"
      data-testid="topbar-device-chips"
    >
      {sorted.map((entry) => (
        <DeviceChip
          key={entry.id}
          entry={entry}
          dragActive={dragActive}
          resolvePanelLabel={resolvePanelLabel}
        />
      ))}
    </div>
  );
}
