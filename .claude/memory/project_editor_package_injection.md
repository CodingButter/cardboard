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
