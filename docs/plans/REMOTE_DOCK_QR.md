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

## 5b. Device tiers + drag-to-device sidebar UX

Three device classes; classification done on the sidecar's
cold-launch and reported in the peer-handshake metadata so desktop
knows what each paired device can do:

| Tier | Heuristic | Capability |
|---|---|---|
| **mobile** | viewport `< 768px` OR (touch-only AND viewport `< 900px`) | Single dockview with groups-as-tabs only. No multi-pane. Touch-variant panels mandatory. |
| **tablet** | touch device AND viewport `768–1366px` | Full layouts with light constraints (max ~2-3 dockviews). Touch-variant panels preferred. Slightly less bandwidth assumed. |
| **laptop/desktop** | non-touch OR viewport `≥ 1366px` | Unconstrained. Full layouts, hover tooltips, mouse-grade interactions. |

Detection logic lives in `apps/editor/src/sidecar/deviceTier.ts` (new
file when D9 lands). The sidecar evaluates on cold-launch and
includes the tier in the WebRTC peer-handshake metadata under a
`deviceTier` field on its `usePairedPeersStore` entry.

### Device identity (name + color + icon)

Each sidecar carries a user-configured identity so multiple devices
of the same tier are instantly distinguishable. "Workshop Tablet"
with the orange flame is obviously different from "Couch iPad" with
the blue star, even though both are tablets.

**Identity lives on the device, not the desktop session.** The
sidecar PWA writes it to its OWN IDB (`sidecar.identity`). When the
same iPad connects to your home Mac, your work laptop, or a
friend's PC, it carries the same name + color + icon every time.
Travels with the hardware, not the host. The desktop's PairedPeer
entry is just a mirror of what the device announced — never the
canonical source.

Stored locally on the sidecar in IDB (`sidecar.identity`), sent in
the WebRTC peer-handshake metadata, mirrored into the desktop's
`PairedPeer` entry:

```ts
interface SidecarIdentity {
  name: string;          // user-configured, e.g. "Workshop Tablet"
  color: string;         // hex from curated palette, e.g. "#f59e0b"
  icon: string;          // lucide icon name from curated set
}

interface PairedPeer {
  id: string;
  deviceTier: "mobile" | "tablet" | "desktop";
  identity: SidecarIdentity;
  currentKind: SemanticPanelKind;
  currentLayout?: LayoutId;
  status: "connecting" | "connected" | "reconnecting" | "ended";
  connectedAt: number;
  lastSeenAt: number;
}
```

**First-launch setup wizard** on the sidecar PWA. Name field, color
swatch picker (8-12 curated colors), icon picker grouped:
- **Device-type icons** — `Tablet`, `Smartphone`, `Monitor`, `Laptop`,
  `Gamepad2`, `PenTool`.
- **Abstract markers** — `Star`, `Heart`, `Flame`, `Bolt`, `Leaf`,
  `Diamond`, `Crown`, `Anchor`, `Compass`.

Skip-able. Defaults if skipped: `name = "Tablet #N"` (or "Phone #N",
"Desktop #N"), `color` randomly chosen from the palette, `icon`
defaulted per tier (`Tablet`/`Smartphone`/`Monitor`).

Editable later from sidecar Settings.

**Where the identity appears:**
- **Drag-to-device-icon chips in the sidebar.** Each chip uses the
  device's `color` for its background tint + the chosen `icon`. On
  hover, shows the `name` as a Tooltip.
- **Remote Dock Controller dock.** Card header shows the colored
  icon + name. Status indicator (connected / reconnecting) keys off
  the same color.
- **Recent-sessions list on the sidecar.** Other devices the user
  has paired in the past show with their identities — quick visual
  recognition for re-pairing.
- **Live-demo broadcast mode.** When the same panel is broadcast to
  N devices, the desktop's confirmation chip shows the device icons
  side by side so you can see at a glance which devices are
  receiving.

### Drag-to-device-icon sidebar UX

When the user drags a panel header tab in the editor, the left
sidebar (already home to trash) reveals an icon per paired device.
Drop on a device icon → panel sent to that device.

- Each paired peer renders a `<DropZone accepts={["panel"]}>` chip
  in the sidebar's left rail.
- Icon style matches the trash treatment — visible only while a
  drag is in flight, dimmed otherwise.
- Drop payload: `DndPayload<"panel">` with the panel id, current
  state snapshot (optional), and the source dockview group id.
- Drop handler routes via the existing WebRTC control channel:
  - `tier === "mobile"` → `{kind: "addPanelToGroup", panelKind, asTab: true}`
  - `tier === "tablet" | "desktop"` → `{kind: "addPanelToLayout", panelKind, hint?: "left|right|bottom"}`
- Mobile sidecar adds the new panel as a tab in its single group.
  Tablet/desktop sidecar adds the panel to its layout per its
  dockview rules.
- Symmetry: sidecar tablet/desktop can also drag their own panels
  back to the orchestrator desktop — same mechanism, sidecar's
  sidebar shows desktop and other-device icons. Phone-side mostly
  one-way for now; we can revisit if real use cases emerge.

This makes "send panel to phone" a one-gesture interaction — no
menu, no rescan, no controller-dock visit (the Controller dock
remains useful for batch / overview, but isn't required for
day-to-day handoff).

### A new SemanticAssetKind

Adds `"panel"` to the `SemanticAssetKind` union in
`apps/editor/src/state/dnd/payload.ts`. New MIME type:
`application/x-cardboard-panel`. Payload shape:

```ts
interface PanelDndPayload {
  v: 1;
  kind: "panel";
  id: string;               // panel kind id, e.g. "minimap"
  label: string;             // header label for sidecar
  origin: string;            // source window/peer id
  meta?: {
    groupId?: string;        // sourcing dockview group, for "move" semantics
    state?: unknown;         // optional state snapshot to seed remote panel
  };
}
```

## 5c. Game-as-dock + initial IDB mirror (the live test-on-device flow)

**This isn't a new platform — it's the apg pack system paying off
via "editor package injection".** Games are already data-driven,
declarative, IDB-backed by design. At dev-time, the editor injects
a BRIDGE PACK into the user's pack chain (alongside the user's own
pack). The bridge registers store-change subscribers, asset-bus
listeners, and the WebRTC transport. Production builds chain only
the user's pack — the bridge is tree-shaken out. Zero runtime cost
in shipped games. See `.claude/memory/project_editor_package_injection.md`
for the full architectural rationale.

The game runner is itself a panel kind (`kind=gamePreview`). Sidecar
mounts the existing game runner component; it reads from the
sidecar's LOCAL IDB replica via the same `IdbAssetPack` contract
the desktop game uses. No special-casing — it's just another
mountable panel that happens to render a game.

This unlocks **live test-on-device**: edit a script on the desktop,
the phone game responds the moment the asset bus fires. Change a
tile preset, the sprite updates in the running game on the phone
instantly. No build step. No reload. No deploy cycle.

Why this works without per-game effort: pack content IS the source
of truth. The engine reads packs from IDB. Hot-reload is "the pack
content changed, refetch." Any game built on Cardboard's engine
gets this for free — the dev experience is a benefit of pack-first
architecture, not a separate framework to wire up.

### Three sync layers, in order of granularity

1. **State layer (Zustand stores).** Multi-transport
   (LocalStorage + BroadcastChannel + WebRTC). Small payloads,
   frequent. Tool selection, brush state, selection, scene cell
   deltas, layer visibility — everything the panels read.

2. **Asset bus (`cardboard:assets` BroadcastChannel + WebRTC
   bridge).** Per-id invalidations: `{kind: "changed", id}`. Sidecar
   listens; on receipt it requests the new blob over the WebRTC
   data channel and writes it to its local IDB. Selectors in the
   game runner re-fire automatically.

3. **Initial IDB mirror on pair.** When a new sidecar connects,
   desktop streams a snapshot of the relevant IDB tables over the
   data channel. Sidecar populates its local IDB. From there,
   layers 1 and 2 keep them in sync. Snapshot scope depends on
   what the sidecar's mounted panel kind needs:
   - `gamePreview` → full asset + scene snapshot.
   - `minimap` → scene cells + layers only.
   - `tilePresets` → tile presets registry only.
   - The handshake message includes a `requiresIdbTables: string[]`
     hint so desktop sends only what's needed.

### Granular hot-reload categorization

The game runner subscribes to specific store SLICES, not the whole
store. Each kind of editor change has its own granular handler that
patches the runtime without restart. Fallback to restart only when
the change can't be applied incrementally.

| Change | Patch strategy | Difficulty | Game state preserved? |
|---|---|---|---|
| Cell painted at (x, y) | Swap mesh material on that one cell | Easy | ✅ |
| Tile preset edited (color/sprite) | Re-tint every cell using that preset | Easy | ✅ |
| Layer visibility toggled | Show/hide the layer's mesh group | Easy | ✅ |
| New entity spawned (editor side) | Add to runtime entity list | Easy | ✅ |
| Entity deleted | Remove instance, dispose mesh | Easy | ✅ |
| Settings (ambient / fog) | Update light/material params live | Easy | ✅ |
| Prefab schema field added | New instances use new schema; existing migrate? | Medium | ⚠️ Decision per case |
| Script body edited | Module-cache invalidate + re-import + re-bind on tick boundary | **Hard** | ⚠️ Mostly (depends on closure state) |
| Scene dims resized | Rebuild scene root, restart physics | **Hard / restart** | ❌ |
| Camera setup changed | Restart camera; player pose preserved if possible | Medium | ⚠️ Partial |

**The architectural enabler:** editor state lives in
`useSceneStore` + IDB; runtime state (player position, score, NPC AI
ticks, animation timers) lives in the GAME runtime's own data
structures. Stores emit fine-grained changes; runtime patches its
mesh tree but leaves its own state alone.

**Script hot-reload approach:**
- Pack scripts run in a custom sandbox/module loader (per the
  engine architecture).
- When a script blob changes (asset bus invalidation), the loader
  flushes the module cache for that id, re-imports the new body,
  and rebinds entities using that script on the next tick boundary.
- Pre-tick swap → next tick runs new body; mid-tick edits queue
  until end-of-tick. No half-applied states.
- Closure state (private variables held inside the script module)
  is reset on reload. Components store their persistent state on
  the entity, not in the script module — design rule.

**Restart-only kinds:**
- Scene dimension changes (resize playfield).
- Engine-version changes (rare).
- User-requested restart from a Reset button.

### Implementation order

- **D10 (PeerJS wiring)** lands layers 1 + 2 minus the WebRTC
  bridge for the asset bus — same-machine cross-window already
  works for both.
- **D10b** extends the asset bus with a WebRTC transport (mirrors
  the Zustand transport pattern from §6.1).
- **D11 (touch variants)** unchanged.
- **NEW: D11b — Initial IDB mirror.** Handshake protocol +
  snapshot streaming + sidecar IDB hydration. Required before
  `gamePreview` can actually run on a sidecar.
- **NEW: D13b — Game-as-dock.** Register the existing game runner
  as a `DockPanelDef` with `mountable: { remote: true,
  touchVariant: true }`. Sidecar mounts it; reads its local IDB
  via the same `IdbAssetPack` contract the desktop game uses.

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
