---
name: project-editor-package-injection
description: "Editor Package Injection" — at dev-time, the editor injects a bridge pack into the chain alongside the user's game pack. The bridge provides hot-reload + remote-dock + live-on-device testing. Production builds omit it. Zero runtime cost in shipped games.
metadata:
  type: project
---

**Naming (Jamie, 2026-05-19):** the dev-experience features
(hot-reload to running game, remote dock to phone/tablet, live
test-on-device) live in a separate package that the editor INJECTS
into the user's game pack chain at dev-time.

## Why this naming is right

- Cardboard already has [[pack-chain]] semantics — packs chain
  together at load, downstream overrides upstream. The runtime
  loads N packs in order, merges their manifests.
- The "bridge" is itself a pack. Or pack-like — a script + manifest
  module that the runtime treats like any other pack contribution.
- Dev mode chains: `[user-pack, editor-bridge-pack]`. The bridge
  registers store-change subscribers, asset-bus listeners, and the
  WebRTC transport.
- Production mode chains: `[user-pack]` only. No bridge, no
  hot-reload runtime, no remote-dock subscriber. Pure game.

## What the bridge does

- Subscribes to the relevant stores (scene cells, tile presets,
  layer visibility, settings) and applies patches to the running
  game's runtime data structures.
- Listens on the asset bus (`cardboard:assets`) for "asset X
  changed" → refetches from IDB → swaps mesh material / re-tints
  cells / reloads script module.
- Connects to the editor's PeerJS data channel (when running on a
  sidecar) and receives store/asset updates over the wire.
- Reports its own state (FPS, runtime errors, asset load progress)
  back to the editor for the Diagnostics panel.

## Why this is the apg pack-system paying off

This isn't a separate framework or new architectural layer. Because
games are already data-driven, declarative, IDB-backed by design,
the bridge is just exposing what the apg architecture already
enables. Hot-reload is "pack content changed, refetch." Any game
built on Cardboard's engine gets these benefits without per-game
boilerplate — not because we built a dev framework, but because
pack-first architecture made content the source of truth.

## The marketplace fallout — extension packs

This naming unlocks a third-party extension ecosystem **for free**.
Pack-chain doesn't care whether a pack came from the user's project,
from Cardboard's own bridge package, or from a third-party developer
extension. All three flow through the same loader.

That means anyone can ship **editor extension packs** that:
- Get installed into the editor (not the user's game).
- Auto-inject into the chain at dev-time whenever the user opens
  a game.
- Tree-shake out of production exports automatically.

Example: someone builds a **"Konami code" cheat pack** — `up up down
down left right left right B A select start` enables dev-mode cheats
in any game it's installed into. Pure dev tool, zero production
weight, single-install activation. Game-specific creators can ship
their own cheat packs for their playtest teams. Generic packs ship
in a marketplace.

Other examples a third party could build:
- **AI playtest agent** — auto-explores the game, reports issues.
- **Performance profiler** — FPS / draw-call / memory HUD.
- **Runtime state inspector** — live entity/component dock panel.
- **Network simulator** — latency + packet loss injection.
- **Accessibility checker** — contrast, hit-area, text-size audits.
- **Telemetry recorder** — capture sessions for replay analysis.
- **AI asset generator** — Claude/OpenAI calls for variations.
- **Localization helper** — string extraction + translation mgmt.

This is **VS Code's plugin model, but for game development**, riding
the apg pack-chain we already shipped. We didn't design a
marketplace; we stumbled into one because pack-chain is the universal
extension point.

### One store, three categories

The community pack store already exists in design (see
`docs/plans/PACK_CHAIN.md`). Editor extension packs don't need a
separate distribution mechanism — they slot in as one more
category alongside the existing two:

| Category | What it does | When it loads |
|---|---|---|
| **Game packs** | Playable games. Standalone, runnable. | Always (production + dev). |
| **Mod packs** | Extend existing game packs. Chain after the base game pack. | Always (production + dev). |
| **Editor packs** | Extend the editor itself. May also include runtime contributions per dual-scope. | Dev-mode only — tree-shaken from production exports. |

Same install flow, same chain loader, same manifest format, same
search/discovery UI. The store doesn't need a separate code path —
editor packs are just a TAG on the listing. Users browse by tag /
category, install one click, and the pack-chain handles the rest.

This is the moment the platform play snaps into focus: pack-chain
isn't just for content, isn't just for mods, isn't just for editor
extensions. It's the **universal contribution mechanism** for the
entire Cardboard ecosystem.

### Two scopes per pack: runtime + editor

A single pack manifest can declare contributions to BOTH the
runtime AND the editor. Production builds strip the editor
contributions and any dev-only items; dev-mode injection includes
them. One pack format, one mental model.

| Scope | What you contribute |
|---|---|
| **Runtime** | Components, scripts, prefabs, asset blobs. Loaded by the engine; runs in the game. Ships in production exports unless flagged dev-only. |
| **Editor** | Custom dock panels, custom inspectors, dock layouts, command palette entries, keybindings. Loaded by the editor; runs in the editor UI. Stripped from production exports. |

A pack might contribute to either, or both. The interesting cases
are the PAIRED contributions — runtime + editor working together as
one coherent feature:

- **Scripting language extension** — runtime: an interpreter for a
  new script kind; editor: a code-editor panel for that language.
- **Level-design AI helper** — runtime: AI fillers that generate
  content; editor: a "Generate" button + preview panel.
- **Telemetry pack** — runtime: instrumentation hooks; editor: a
  dashboard panel visualizing captured data.
- **Cheat system** — runtime: input watcher + preset scripts;
  editor: Cheat Code Manager panel.

### Extension packs contribute ALL four primitive kinds

Extension packs aren't just dev tools that watch from the side —
they can contribute the same engine-level primitives that user game
packs do. Pack-chain doesn't distinguish "extension" vs "game":

| Contribution | Example for the cheat-system extension |
|---|---|
| **Components** | `CheatCodeListener` component schema — key-sequence + trigger-script-id fields |
| **Scripts** | Runtime input watcher that monitors keystrokes against the sequence; preset trigger scripts ("god mode", "all weapons") |
| **Prefabs** | Pre-configured "Konami cheat" entity bundle the user drops into their scene |
| **Custom editor panels** | "Cheat Code Manager" dock panel — lists every CheatCodeListener in the project, key sequence, target, links to entities |

The user attaches `CheatCodeListener` to entities in their game pack
(same way they'd attach any other component), configures the
sequence in JSON, picks a preset trigger script OR writes their own.
Production export: chain doesn't include the extension pack, the
component definition disappears, entities with `CheatCodeListener`
have unknown components stripped or warned about (pack-chain's
existing missing-component behavior).

### The architectural moment

The mechanism is exactly what the apg system already enables.
Components are data-driven. Scripts are pack-provided. The engine
merges contributions across the chain. **Extension packs are just
more packs that happen to opt into dev-mode-only injection.**
Implementation details — schema design, runtime watcher, preset
scripts, custom panel UI — are up to the extension's author, the
same way game devs design their own components today. **No new
engine work required.**

## Bridge package location

When implemented:
- `packages/editor-bridge/` — new workspace package.
- Exports a single `attachEditorBridge(runtime, options)` function.
- Bundled with the editor's dev-mode build; tree-shaken out of
  production game exports.
- Engine has zero awareness of the bridge — it just sees one more
  pack in the chain whose manifest happens to register subscribers.

## Related

- [[project-idb-source-of-truth]] — IDB is the asset canon; the
  bridge subscribes to its change notifications.
- [[feedback-popout-state-sync]] — the same multi-transport store
  sync that powers cross-window popouts powers the bridge's
  cross-device updates.
- [[project-remote-dock-via-qr]] — the bridge is the runtime piece
  of the remote-dock subsystem; the SideCar PWA pairs with the
  editor and runs the bridge to receive updates.
- `docs/plans/REMOTE_DOCK_QR.md` §5c — game-as-dock + initial IDB
  mirror specification.
- `docs/plans/PACK_CHAIN.md` — pack chaining semantics that the
  bridge rides.
