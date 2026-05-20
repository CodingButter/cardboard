import { createSyncedStore } from "./sync";
import type { DeviceTier, SidecarIdentity } from "./pairingTypes";

/**
 * useDesktopPairingStore — durable session state for the desktop's
 * pairing layer.
 *
 * The store carries the SERIALIZABLE subset:
 *   - Our own PeerJS-assigned id once it's known (so popped-out windows
 *     can read it too, for D10c+).
 *   - A record of paired peers' identity metadata (name + colour + icon
 *     + tier) and status. The actual `Peer` / `DataConnection` objects
 *     live in `desktopPairingSingleton.ts` — they can't cross the
 *     window-boundary anyway, and they'd choke `JSON.stringify`.
 *
 * Cross-window sync: `createSyncedStore` means popouts see paired-peer
 * status updates without re-instantiating their own Peer. Only the
 * orchestrator window holds a live runtime — popouts read the mirror.
 *
 * Reset on page load: paired-peer status is per-page-session. A reload
 * mints a fresh `ownPeerId` (PeerJS doesn't persist) and any old
 * `pairedPeers` entries are stale. We persist them anyway so a popout
 * that opens slightly later still sees the latest identity; the
 * orchestrator's `initDesktopPeer` overwrites stale entries on
 * re-connection.
 */

export interface PairedPeerEntry {
  /** Remote PeerJS id. */
  id: string;
  /** Sidecar identity payload — null until the hello arrives. */
  identity: SidecarIdentity | null;
  /** Tier announced by the sidecar — null until the hello arrives. */
  deviceTier: DeviceTier | null;
  /** Per-peer lifecycle state. */
  status: "connecting" | "connected" | "ended";
  /** Optional initial mount the sidecar URL requested (kind=…). */
  mountedKind: string | null;
  /** Optional initial layout the sidecar URL requested (layout=…). */
  mountedLayout: string | null;
  /** Epoch ms — first time we saw this peer in this session. */
  connectedAt: number;
}

export interface DesktopPairingState {
  ownPeerId: string | null;
  pairedPeers: Record<string, PairedPeerEntry>;
}

export interface DesktopPairingActions {
  setOwnPeerId: (id: string | null) => void;
  /** Insert-or-replace a paired-peer entry. */
  upsertPairedPeer: (id: string, entry: PairedPeerEntry) => void;
  /** Update only the `status` field of an existing entry. */
  markPairedPeerStatus: (
    id: string,
    status: PairedPeerEntry["status"],
  ) => void;
  /** Drop a paired-peer entry entirely (used after a clean disconnect). */
  removePairedPeer: (id: string) => void;
  /** Reset everything — used by `destroyDesktopPeer` in tests / HMR. */
  reset: () => void;
}

const initialState: DesktopPairingState = {
  ownPeerId: null,
  pairedPeers: {},
};

export const useDesktopPairingStore = createSyncedStore<
  DesktopPairingState,
  DesktopPairingActions
>(
  "desktopPairing",
  initialState,
  (set) => ({
    setOwnPeerId: (id) => set({ ownPeerId: id }),
    upsertPairedPeer: (id, entry) =>
      set((s) => ({
        pairedPeers: { ...s.pairedPeers, [id]: entry },
      })),
    markPairedPeerStatus: (id, status) =>
      set((s) => {
        const existing = s.pairedPeers[id];
        if (!existing) return {};
        return {
          pairedPeers: {
            ...s.pairedPeers,
            [id]: { ...existing, status },
          },
        };
      }),
    removePairedPeer: (id) =>
      set((s) => {
        if (!(id in s.pairedPeers)) return {};
        const next = { ...s.pairedPeers };
        delete next[id];
        return { pairedPeers: next };
      }),
    reset: () => set({ ...initialState }),
  }),
);
