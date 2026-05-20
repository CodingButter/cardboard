# Remote Dock via QR + PeerJS — Plan

## 1. Overview

The editor's dockview popout system today supports popping a panel
into another browser window on the same machine (Wave 3 cross-window
sync layer). This plan extends popout to a SEPARATE DEVICE — pop a
panel onto a phone, tablet, or another laptop — via QR-code pairing
and a peer-to-peer WebRTC data channel. No backend; we ride on
PeerJS Cloud for signaling, and the SideCar PWA lives in the same
GitHub Pages deploy.

The user explicitly flagged this as worth designing NOW even if the
implementation lands later: retrofitting fifty panels and dozens of
store call sites after the fact is expensive. See
`.claude/memory/project_remote_dock_via_qr.md` for the conversation
that produced this design.

### Why it matters

- Drop the minimap on a tablet beside the keyboard.
- Pop the live game preview to your phone and play-test while editing.
- Tile palette + brush on a tablet → main canvas stays uncluttered.
- Couch-dev — paint controls on a phone, mouse on the canvas.
- Multi-user review — collaborator's phone hosts a read-only Inspector.
- Local multiplayer game-pads — same architecture, phones-as-controllers.

Few editors do this; doing it browser-native via QR + WebRTC + a
PWA is much cleaner than Unreal's companion-app approach.

## 2. Architecture

```
DESKTOP EDITOR                     PEERJS CLOUD                     PHONE / TABLET
──────────────                     ────────────                     ──────────────
1. User clicks "pop out to phone"
2. new Peer() → id="abc-xyz"       ◄── ws register ──
3. Encode URL into QR:
   /sidecar/?peer=abc-xyz&kind=minimap&label=Scene+1
4. Display QR
                                                                    📱 scans QR (one of three paths)
                                                                    ┌────────────────────────┐
                                                                    │ a. System camera       │
                                                                    │ b. SideCar PWA scanner │
                                                                    │ c. Pasted URL          │
                                                                    └────────────────────────┘
                                                                    5. Open URL → SideCar PWA
                                                                    6. Read peer param
                                                                    7. new Peer() → id="phn-mno"
                                                                                       ◄── ws register ──
                                                                    8. peer.connect("abc-xyz") ──►
                              ◄── signaling handshake ───────────►
                              (SDP + ICE exchanged through cloud)
                              ──────────────────────────►
                                                                    9. DataChannel open
DESKTOP ◄═══════════════════════════════════════════════════════════════════════════════════► PHONE
                  DIRECT WebRTC data channel. UDP/DTLS.
                  Store writes, mouse coords, asset payloads —
                  all flow here at peer-to-peer latency.
```

**PeerJS Cloud sees:** peer ids, who pairs with whom, signaling
handshake (SDP + ICE candidates). **Does NOT see:** application data
on the data channel.

## 3. The three pairing paths

| Path | Trigger | Notes |
|---|---|---|
| **System camera scans QR** | User points phone camera at desktop's QR | URL opens browser. If SideCar PWA is installed with matching scope, opens directly in the PWA. |
| **SideCar PWA opened first** | User taps PWA icon on phone, no active session | Cold-launch screen shows in-app camera scanner via `getUserMedia` + `qr-scanner`. Cleaner UX than system-camera detour. Recent-sessions list for tap-to-reconnect. |
| **Share-link** | URL pasted in Slack/email | Same URL, same behavior. Free feature; pairing IS just a URL. |

All three paths converge at `peer.connect(id)` → handshake → panel
mounts.

## 4. URL contract

```
https://codingbutter.github.io/cardboard/sidecar/?peer=<id>&kind=<panelKind>&label=<text>&mode=<mode>
```

| Param | Required | Purpose |
|---|---|---|
| `peer` | ✅ | PeerJS id of the desktop |
| `kind` | one of `kind` / `layout` | Single panel kind: `minimap` / `tilePresets` / `gamePreview` / `controller` / etc. Best for single-panel sidecar use. |
| `layout` | one of `kind` / `layout` | Full layout id: `map-builder` / `controller-deck` / etc. The sidecar mounts a multi-panel dockview from this preset. Takes precedence over `kind` when both are present. |
| `label` | optional | Header text shown immediately on phone before WebRTC connects (e.g. `Scene • Map Editor`) |
| `mode` | optional | `dock` (full panel/layout) / `controller` (input only) / `display` (read-only mirror) |

Heavy state flows after handshake via the WebRTC data channel — NOT
in the URL. URL stays ~120-150 chars, well under QR size limits.

## 5. SideCar PWA structure

- Lives at `apps/editor/.../sidecar/` (route added during D8+; uses
  the existing editor Bun.serve / Pages deploy).
- Single PWA. Mode-routed via URL params.
- **Not a single-panel viewer — a full editor surface.** Has its
  OWN dockview and its OWN layouts. The tablet can host a tablet-
  optimized arrangement (map canvas + tools + tile presets) while
  the desktop runs whatever it wants on the same session. Layout is
  per-device; state is shared.
- Two ways to initialize the layout:
  - URL carries `kind=<panelKind>` → single panel mount (best for
    controllers, previews, "show me the minimap").
  - URL carries `layout=<layoutId>` → full layout mount (best for
    "make this tablet a map builder").
  - Both supported. `layout` wins if both present.
- Cold-launch screen:
  - Live camera preview + QR scanner.
  - Recent-sessions list (last-N peer-ids stored in IDB, tap to
    reconnect).
  - Paste-URL fallback.
- After-pair screen:
  - Header shows `label` immediately (zero-latency feedback).
  - Loading skeleton for the panel(s) the URL specifies.
  - Once data channel opens, layout hydrates from snapshot of the
    relevant stores.
- **Promotion: tablet is a peer surface, not a viewer.** Edits made
  on the tablet propagate to desktop (and any other connected peer)
  via the same store-sync transport. Last-write-wins is the default
  conflict policy. State is shared across devices; layout (which
  panels are visible + where) is local to each device.
- Manifest:
  ```json
  {
    "name": "Cardboard SideCar",
    "short_name": "SideCar",
    "scope": "/cardboard/sidecar/",
    "start_url": "/cardboard/sidecar/",
    "display": "standalone",
    "background_color": "#0a0a0c",
    "theme_color": "#1a1814"
  }
  ```

## 6. Forward-compat hooks (design NOW, implement later)

The user's instinct: design the transport seams in the existing
cross-window sync layer so PeerJS plugs in later without retrofit.
Three decisions to lock in early:

### 6.1 Transport abstraction in `sync.ts`

Today `createSyncedStore` uses `localStorage` + `storage` events +
optional `BroadcastChannel`. Treat that as a TRANSPORT INTERFACE. A
future PeerJS-based transport satisfies the same interface.

**D4+ guidance:** don't write code that pokes `localStorage` directly
or assumes `storage` event semantics. Go through `createSyncedStore`'s
API. If it's missing, extend the API rather than bypassing it.

### 6.2 Mutation origin tracking

`useDragStore` already includes `origin: string` on its payload.
Convention extends to other stores: writes know their origin (this
window? remote peer?). Prevents echo loops once network is wired.

For now: don't assume all writes are local. Don't write code that
implicitly bounces every `set()` back through the same channel that
delivered it.

### 6.3 Per-panel `mountable` capability on `DockPanelDef`

Some panels make sense remotely (Minimap, TilePresets, Brush,
controller surfaces). Others don't (MapCanvas full state,
EditorSettings). Extend the existing `DockPanelDef` type:

```ts
interface DockPanelDef {
  id: string;
  title: string;
  icon?: LucideIcon;
  mount: () => ReactNode;
  scope?: "page" | "shared";
  mountable?: {
    local?: boolean;      // default true — shows in dock-add modal
    remote?: boolean;     // default false — opt-in for "send to phone"
    touchVariant?: boolean; // default false — has a touch-friendly variant component
  };
}
```

Cost today: small type extension + defaults. Cost to retrofit after
fifty panels exist: high. Land this with the D8+ work.

### 6.4 Conflict policy

Document last-write-wins as the default. Implicit in `storage` events
today; still the right default for UI state under network latency.
For history/cell-paint streams, more nuanced conflict resolution
(vector clocks, CRDTs) is a future concern — out of scope for the
first pass.

## 7. Libraries

| Concern | Library | Bundle | Note |
|---|---|---|---|
| WebRTC handshake | `peerjs` | ~30 KB | Two-line API on each side |
| QR generation (desktop) | `qrcode` | ~20 KB | SVG output, scales cleanly |
| QR scanning (phone) | `qr-scanner` | ~25 KB | Uses `BarcodeDetector` where available |
| PWA install prompt | native `beforeinstallprompt` | 0 | Browser-provided event |

All four are browser-safe, tree-shakable, no native deps.

## 8. Phased plan

### D8 — Forward-compat hooks (lands ALONGSIDE Wave 3.3+)
- Extend `DockPanelDef` with optional `mountable` field.
- Document the transport abstraction contract in `sync.ts` JSDoc.
- Add a `originatesLocal()` helper or convention note for stores.
- No behavior change yet. Purely shaping the API surface.

### D9 — SideCar PWA shell + cold-launch
- New route `apps/editor/.../sidecar/`.
- Manifest, service worker, basic shell that reads URL params.
- Cold-launch screen: in-app QR scanner via `qr-scanner` library.
- Recent-sessions list (IDB-backed, last-N peer ids).
- Paste-URL fallback.
- No PeerJS yet — purely UI shell.

### D10 — PeerJS wiring
- Add `peerjs` dependency.
- Desktop pop-out flow: on user "send to phone", `new Peer()` →
  show QR with `kind` + `label`.
- SideCar PWA: `peer.connect(idFromUrl)` on mount.
- Wire data channel into `createSyncedStore`'s transport slot via
  a new `PeerTransport` adapter that satisfies the same interface as
  the local one.
- Initial panel kinds wired: Minimap, TilePresets.

### D11 — Touch-friendly variants
- Mountable panels with `touchVariant: true` get a touch component.
- Bigger hit targets, no hover-only Tooltips, simplified UX.
- Sidecar renders the touch variant when the panel kind has one.

### D12 — Recent sessions + session lifecycle
- IDB-backed recent-peer list with timestamps + labels.
- Tap to reconnect (no rescan needed if desktop session is still up).
- Graceful "session ended" state when desktop closes.

### D12b — Remote Dock Controller panel  *(added 2026-05-19)*

A first-class panel inside the desktop editor that lists all paired
sidecars and lets the user remote-control what each one displays.
Eliminates "rescan QR to switch panels" entirely — pair phone once,
then swap content from the desktop for the rest of the session.

**Shape**

- New panel kind: `remoteDockController` (lives alongside Minimap,
  TilePresets, etc. in the dock-add modal).
- Reads from `usePairedPeersStore` — a new store holding
  PEER METADATA (id, label, currentPanelKind, status, last-seen
  timestamp). NOT the actual `RTCPeerConnection` objects; those
  can't serialize and live in a singleton on the originating window.
- UI: a card per paired peer. Each card shows current panel kind,
  a dropdown to switch panels, a disconnect button. Status pill
  (connected / reconnecting / disconnected) per card.
- Empty state: "No devices paired. Pop out a panel and scan the QR
  to pair one."

**Mechanics**

- Same WebRTC data channel as store sync. Adds CONTROL-MESSAGE
  types alongside the store-write messages:
  ```ts
  type ControlMessage =
    | { kind: "switchPanel"; to: SemanticPanelKind }
    | { kind: "switchLayout"; to: LayoutId }      // tablet swaps full layout
    | { kind: "ping" }
    | { kind: "pong" }
    | { kind: "requestState"; storeIds: string[] }
    | { kind: "disconnect"; reason?: string };
  ```
- Desktop sends `{kind: "switchPanel", to: "tilePresets"}` for a
  single-panel swap, or `{kind: "switchLayout", to: "map-builder"}`
  to push a multi-panel layout to the sidecar. The sidecar unmounts
  the current view, mounts the new one, re-requests state for the
  relevant stores.
- "Broadcast to all paired devices" — desktop sends the same
  switch-panel/switch-layout message to every connected peer. Live
  demo mode — three tablets in a room all mirror the same view.

**`usePairedPeersStore`**

Uses `createSyncedStore` so popping the Controller dock to a second
monitor still shows the same paired peers. State:
```ts
interface PairedPeer {
  id: string;           // PeerJS id
  label: string;        // user-friendly name ("Jamie's iPad")
  currentKind: SemanticPanelKind;
  status: "connecting" | "connected" | "reconnecting" | "ended";
  connectedAt: number;
  lastSeenAt: number;
}
interface PairedPeersState {
  peers: Record<string, PairedPeer>;
}
```

The `RTCPeerConnection` objects themselves live in a per-window
singleton (`networkTransport.activeConnections: Map<peerId, RTCPeerConnection>`).
The store has the metadata; the singleton has the live connections.
Switching panels from any window: update store → singleton observes
change → sends control message over connection it owns.

**Why this is cheap to add**

- The WebRTC transport is already there (D10).
- The store sync layer already runs over it.
- Control messages are just another message type on the same channel.
- `usePairedPeersStore` is one more `createSyncedStore` — same shape
  as the existing 8.
- The Controller dock is just a React panel reading the store.

No new architectural primitives. Slots in naturally.

### D13 — Game runtime sidecar (phone-as-controller)
- Game runtime emits a `kind=controller` peer-id when running on
  desktop.
- Sidecar's controller mode = touch-friendly input layer (virtual
  d-pad, buttons, gyro).
- Game subscribes to controller inputs via WebRTC data channel.
- Local multiplayer falls out naturally — multiple phones connect to
  the same game peer.

### D14 — TURN fallback (optional, ship when needed)
- Free-tier TURN provider (Twilio 10GB/mo or self-hosted coturn).
- Handles ~5% symmetric-NAT case.
- Skip until users report connection failures.

### D15 — Self-host PeerServer (optional)
- If we outgrow PeerJS Cloud rate limits, self-host PeerServer on a
  $5/mo VPS. Tiny Node app, drop-in replacement.

## 9. Risks + open questions

1. **PeerJS Cloud reliability.** Third-party infrastructure. If it
   goes down, pairing breaks. Mitigation: self-host (D15) when scale
   demands it. Document the dependency.

2. **Symmetric NAT (~5% of users).** No TURN by default → connection
   fails. Defer until real complaints.

3. **Per-panel auth.** QR URL contains the peer-id; anyone with the
   URL can connect. For an editor session that's probably fine
   (you're sharing it intentionally), but worth a "deny" flow on the
   desktop side for the first unexpected connection.

4. **Bandwidth.** Cell paint floods at 30 Hz over a slow link will
   feel laggy. May need batching for high-traffic streams. Address
   when concrete numbers emerge.

5. **Asset content over WebRTC.** A full prefab JSON or sprite blob
   may need chunking (PeerJS data channel best around 16KB messages).
   Implement the chunker once the asset store ships.

6. **iOS PWA limitations.** Add-to-home-screen is manual via share
   menu; no `beforeinstallprompt`. Workable, just less smooth than
   Android. Document the platform difference in the install banner.

7. **Service worker on PWA.** Required for installability + offline.
   Sidecar SW caches the app shell, NOT user data (no IDB shadowing
   — sidecar reads fresh from peer over WebRTC every session).

## 10. Out of scope (for this plan)

- Asynchronous pairing (devices not online at the same time) — would
  reintroduce a backend (Supabase) for persistent signaling.
  Different plan if/when it matters.
- Native mobile apps. Web is the strategy.
- Pairing more than 2 peers in one session. WebRTC mesh networks are
  doable but get complex past 4-5 peers. Use SFU (Selective Forwarding
  Unit) infrastructure if/when needed.

## 11. Related plans + memories

- `docs/plans/CROSS_WINDOW_DND.md` — the foundation. The DnD
  transport extends naturally.
- `.claude/memory/project_remote_dock_via_qr.md` — the design
  conversation that produced this plan.
- `.claude/memory/project_idb_source_of_truth.md` — IDB is the
  canonical asset store; sidecar reads through `IdbAssetPack` over
  WebRTC.
- `.claude/memory/feedback_popout_state_sync.md` — the same-machine
  popout layer this extends.
