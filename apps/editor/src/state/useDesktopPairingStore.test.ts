import { test, expect, beforeEach } from "bun:test";
import { useDesktopPairingStore } from "./useDesktopPairingStore";

/**
 * Sidecar M2 — exercises the `setPairedPeerMount` / `clearPairedPeerMount`
 * actions that desktopPairingSingleton calls when sending mountPanel or
 * receiving unmountPanel.
 */

beforeEach(() => {
  useDesktopPairingStore.getState().reset();
});

function seed(id: string) {
  useDesktopPairingStore.getState().upsertPairedPeer(id, {
    id,
    identity: null,
    deviceTier: null,
    status: "connected",
    mountedKind: null,
    mountedLayout: null,
    connectedAt: Date.now(),
  });
}

test("setPairedPeerMount sets mountedKind on an existing peer", () => {
  seed("peer-a");
  useDesktopPairingStore.getState().setPairedPeerMount("peer-a", "tools");
  const entry = useDesktopPairingStore.getState().pairedPeers["peer-a"]!;
  expect(entry.mountedKind).toBe("tools");
});

test("setPairedPeerMount is a no-op for unknown peers", () => {
  useDesktopPairingStore.getState().setPairedPeerMount("ghost", "tools");
  expect(useDesktopPairingStore.getState().pairedPeers["ghost"]).toBeUndefined();
});

test("clearPairedPeerMount nulls mountedKind", () => {
  seed("peer-b");
  useDesktopPairingStore.getState().setPairedPeerMount("peer-b", "notes");
  useDesktopPairingStore.getState().clearPairedPeerMount("peer-b");
  const entry = useDesktopPairingStore.getState().pairedPeers["peer-b"]!;
  expect(entry.mountedKind).toBeNull();
});

test("clearPairedPeerMount preserves other entry fields", () => {
  seed("peer-c");
  useDesktopPairingStore.getState().setPairedPeerMount("peer-c", "palette");
  useDesktopPairingStore.getState().clearPairedPeerMount("peer-c");
  const entry = useDesktopPairingStore.getState().pairedPeers["peer-c"]!;
  expect(entry.status).toBe("connected");
  expect(entry.id).toBe("peer-c");
});
