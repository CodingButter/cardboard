---
name: project-remote-dock-via-qr
description: Future capability — pop a dockview panel onto a phone/tablet via QR pairing. PeerJS + WebRTC peer-to-peer, hosted on a SideCar PWA route in the same GitHub Pages deploy. Design the seams in the current sync.ts transport NOW even if implementation lands later; retrofit cost is high.
metadata:
  type: project
---

**Idea (Jamie, 2026-05-19):** the editor's dockview popout system should be extendable to ANOTHER DEVICE, not just another browser window on the same machine. Pop out a panel → editor renders a QR code → user scans on phone/tablet → that device opens the panel, synced live.

## Architecture (revised after the call)

**Original assumption:** Supabase Realtime as backplane. **Replaced by** PeerJS + WebRTC peer-to-peer.

### Why PeerJS over Supabase

- Cardboard is hosted on **GitHub Pages — static, no backend**. Can't run our own signaling server.
- PeerJS Cloud is a free public signaling server. We register, get a `peerId`, encode it in the QR.
- Once paired, WebRTC data channel flows **direct peer-to-peer**. PeerJS Cloud only sees handshake metadata (who paired with whom), not application data.
- Self-host PeerServer later if we hit rate-limit / reliability ceiling. Same Bun process can run it on a $5/mo VPS.

### The pairing UX (three paths)

QR URL shape:
```
https://codingbutter.github.io/cardboard/sidecar/?peer=<id>&kind=<panelKind>&label=<headerText>
```

Path 1: **System camera scans QR** → URL opens browser or, if SideCar PWA is installed with matching scope, opens directly in the PWA.

Path 2: **SideCar PWA opened first** (no active session) → cold-launch screen shows its own camera-based QR scanner (`getUserMedia` + `qr-scanner` library). User points sidecar at desktop's QR. No system-camera detour.

Path 3: **Share-link** → the QR URL is also a copy-pastable join link. Works in Slack, email, DMs. Free feature, no extra mechanism.

All three converge at the same place: `peer.connect(id)` → handshake → panel mounts.

### Sidecar app structure

- Single PWA at `apps/editor/.../sidecar/` (one install, one icon). Mode-routed via URL `kind` param.
- Cold-launch screen: live camera + scan UI, "recent sessions" list (tap to reconnect), paste-URL fallback.
- Manifest: `scope: "/cardboard/sidecar/"`, `display: "standalone"`, app icons, theme colors matching the editor.
- Tiny tree: QR scanner, PeerJS client, one router that mounts the panel by `kind`.

### URL param contract

| Param | Required | Purpose |
|---|---|---|
| `peer` | ✅ | PeerJS id |
| `kind` | ✅ | Panel kind: `minimap`, `tilePresets`, `gamePreview`, `controller`, etc. |
| `label` | optional | Header text for the loading state (e.g. "Scene • Map Editor") |
| `mode` | optional | `dock` / `controller` / `display` — read-only mirror vs full mount vs input-only |

Heavy state (entities, cells, prefab refs) flows via WebRTC after handshake, NOT in the URL. URL stays small (~120-150 chars) and QR-friendly.

### Libraries

| Concern | Library | Bundle |
|---|---|---|
| WebRTC handshake | `peerjs` | ~30 KB |
| QR generation (desktop) | `qrcode` | ~20 KB |
| QR scanning (phone) | `qr-scanner` | ~25 KB |
| PWA install prompt | native `beforeinstallprompt` | 0 |

## Forward-compat: design the seams NOW (the user's instinct)

Even though we're not implementing the network transport yet, **design D4–D7 of the DnD plan so PeerJS plugs in later without a retrofit**. Three decisions to lock NOW:

### 1. Transport abstraction in `sync.ts`

`createSyncedStore` already abstracts the transport. Today it uses `persist` + `storage` events + optional `BroadcastChannel`. Treat that as a transport INTERFACE. The future PeerJS transport satisfies the same interface — sends `{key, value, origin}` writes, receives same shape. The 8 wave-3 stores + `useDragStore` + `useAssetStore` don't know which transport is wired.

D4+ guidance: don't write code that pokes `localStorage` directly or assumes `storage` event semantics. Go through `createSyncedStore`'s API. If it's missing, extend the API rather than bypassing it.

### 2. Mutation origin tracking on every write

`useDragStore` already includes `origin: string` on its payload. Same pattern propagates to other stores when they need to disambiguate "did this come from me or from a peer." Already implicit in BroadcastChannel for ephemeral state; needs explicit tagging on durable writes once a network transport exists.

**Document as convention:** all `set(...)` calls that originate from a remote peer should be flagged so the local window doesn't echo the write back over the network. Convention can be enforced later via a `setFromRemote(...)` action variant; for now just keep the door open by not assuming all writes are local.

### 3. Per-panel `mountable` capability on `DockPanelDef`

Some panels make sense remotely (Minimap, TilePresets, Brush, controller surfaces). Some don't (MapCanvas full state, EditorSettings). Extend `DockPanelDef` in `apps/editor/src/components/dock/DockShell.tsx`:

```ts
interface DockPanelDef {
  id: string;
  title: string;
  icon?: LucideIcon;
  mount: () => ReactNode;
  scope?: "page" | "shared";       // existing
  mountable?: {
    local?: boolean;               // default true
    remote?: boolean;              // default false — explicit opt-in
    touchVariant?: boolean;        // default false — has a touch-friendly variant
  };
}
```

When a panel author opts into `remote: true`, the popout UI surfaces a "send to phone" affordance. When `touchVariant: true`, the sidecar renders a touch-friendly version. Cost today: maybe 4-line type extension + defaults. Cost to retrofit after fifty panels exist: high.

### 4. Last-write-wins as documented conflict policy

For UI state (tool, brush, selection) last-write-wins is fine and is the implicit behavior of `storage` events. Document it. For richer mutations (history, cell paints), more nuanced conflict resolution may be needed when network latency enters — defer that decision until concrete use cases land.

## How to apply (today)

- Wave 3.3 panel migrations: no change required. The pattern is already correct.
- D4 (`useAssetStore`) and D5 (write path) — write against `createSyncedStore` API exclusively. Don't peek `localStorage` directly.
- When DockPanelDef expansion lands (small extension), default existing panels to `mountable: {local: true, remote: false}`. Opt-in remotely only for panels that genuinely make sense.
- New plan doc at `docs/plans/REMOTE_DOCK_QR.md` describes the full network-aware architecture for when we're ready to scope.

## Related memory

- [[project-idb-source-of-truth]] — IDB is the asset canon; sidecar reads its content via the same IdbAssetPack contract resolved over the network.
- [[feedback-popout-state-sync]] — the foundation; the network transport is its next phase.
- [[feedback-page-layouts-and-shared-docks]] — panel mountable-ness intersects with shared-vs-page scope on DockPanelDef.
