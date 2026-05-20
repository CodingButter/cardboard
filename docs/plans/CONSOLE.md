# In-engine developer console — CONSOLE plan

A Quake/Source-style developer console layered on top of the existing
ModAPI. Toggled by backtick. Drops down over the game. Engine ships a
catalog of built-in commands; packs register their own through
`api.console`. A **layered policy system** — build-time stripping plus
runtime role gating plus custom predicates — lets pack authors write
one set of commands that behave correctly in both `dev` and `publish`
builds, without smuggling cheats past a published pack and without
denying themselves their own tooling during development.

Source-of-truth for implementation. Phases C1–C4 below. Cross-refs:
the materials plan (shipped; see git log — precedent for engine-ships-
the-mechanism and packs-ship-the-content split, plus the
cascading-policy precedent M1's cascade established),
[ANIMATIONS.md](./ANIMATIONS.md) + [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md)
(companion-doc pattern — engine plan plus editor authoring plan),
[EVENTS.md](./EVENTS.md) (the bus the console subscribes to for
live event tracing, and which canonical engine emissions the console
itself surfaces),
[EDITOR.md](./EDITOR.md) (Project Settings → Commands tab — the
visual policy editor + mode preview added in C3),
[PACK_CHAIN.md](./PACK_CHAIN.md) (the `dev` vs `publish` build mode
gate, plus the multi-pack cascade rules the console policy file
inherits when chained packs each ship a `commands.json`),
[AUDIO.md](./AUDIO.md) + [TILE_PRESETS.md](./TILE_PRESETS.md) (live
preset mutation is the headline workflow win the console unlocks for
level iteration).

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **Force-multiplier for development.** Replace the edit → rebuild →
  reload → re-walk loop with `preset edit brick.wall reflectiveness
  0.85` in-place. Iteration time drops from ~30 s/round-trip to
  keystrokes.
- **Force-multiplier for modders.** Pack authors register commands
  the same way they register systems, prefabs, modals, or shaders.
  A weapon-mods pack ships `give_weapon shotgun 99`; a wave pack
  ships `spawn_wave 3`. Just another ModAPI surface.
- **Quake/Source familiar.** Backtick toggles. Monospace log on top,
  input row on bottom, autocomplete dropdown. Up-arrow recalls, Tab
  cycles completions. Exactly what every gamedev expects.
- **One author surface, two runtime behaviours.** The same
  `api.console.register("spawn", …)` call works in dev (modder gets
  full access) and publish (gated/stripped/hidden from players).
  Author writes once; policy file decides exposure.
- **Safe by default.** Default policy `deny`. Players see nothing
  unless the pack allow-lists it. Cheat-style commands sit behind a
  role bump (typically `unlock_cheats <password>`). Eval-class
  commands are build-time-stripped in publish — the bytes literally
  aren't in the shipped `.apg`.
- **Surface the existing ModAPI.** Console doesn't reinvent
  capability. It's a typed parser feeding `world.findByName`,
  `api.spawn`, `api.config`, `api.events.emit`. Novelty is the
  parser + policy layer.
- **Pack-overridable UI.** Default UI ships as a default-pack
  Preact modal via `api.ui.registerModal("dev_console", ...)`,
  same pattern as [settings-screen.tsx](../../packages/default-pack/scripts/systems/settings-screen.tsx).
  Themed packs re-register the same modal name with their own
  component. Engine doesn't render.

### Non-goals

- **Not a chat box.** No team / global / whisper channels. No
  player-to-player messaging. Multiplayer chat is a separate UI
  shipped by the multiplayer pack ([MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md)).
- **Not an in-engine code editor.** Single-line input (Shift+Enter
  multi-line in C4 only). No syntax highlighting, no LSP. Edit
  workflows belong in `apps/editor` per [EDITOR.md](./EDITOR.md).
- **Not a debugger.** No breakpoints, step-into, live-watch, memory
  inspection. The `eval` command (dev-only, admin-gated) is the
  escape hatch — not a DevTools replacement.
- **Not a CLI for the engine binary.** Runtime surface inside the
  running game, not a standalone command-line tool.
- **No on-disk persistence beyond history.** Commands mutate world
  state or echo; nothing serialises back into the `.apg`. `set`
  changes are in-memory only unless a pack opts into
  `api.settings.save`.
- **No piping / shell-style composition.** No `|`, no `>`, no `&&`.
  `bind` (C4) is the only command-chaining surface.
- **No remote console.** Multiplayer packs can ship a network-aware
  variant; engine stays local-only. Same reason
  [EVENTS.md § 1](./EVENTS.md) keeps the bus process-local.
- **No localisation of command names.** Stable English identifiers —
  `spawn`, `tp`, `noclip`. Help text can localise; names are API.

---

## 2. Status quo

Today there is no in-engine command surface. Three workarounds:

### 2.1 Hard-code dev knobs into pack scripts

`packages/default-pack/scripts/systems/stats-render.js` hardcodes
F-key toggles into its own keyboard handler. Adding a new dev
toggle means writing a system, picking a key, hoping it doesn't
collide. Every modder reinvents this.

### 2.2 Edit `config.json` and rebuild

CONFIG tuning is "edit the JSON, `bun run build-packs`, reload" —
a 10-second round-trip per scalar. The Esc Settings modal surfaces
only the paths it was hand-coded to know about; pack authors can't
add an experimental knob's slider without modifying the modal UI.

### 2.3 URL params

`?scene=foo`, `?pack=URL`, `?source=editor` cover boot-time mode
switching but are terrible for per-frame iteration (every change
reloads the page).

### 2.4 What we want

```
` (backtick)
> set rendering.fov 100
fov: 90 → 100
> tp 12 7
teleported to (12, 7)
> preset edit brick.wall reflectiveness 0.85
brick.wall.reflectiveness: 0.4 → 0.85 (rebaked tile 14 references)
> spawn imp 14 8
spawned entity 47 (prefab=imp)
> events on inventory:*
tracing inventory:* — 3 events captured
```

Six keystrokes-to-commands worth of iteration that today takes a
file edit + rebuild + reload. This is the workflow win.

---

## 3. Architecture overview

The console is intentionally a thin top-layer over existing engine
plumbing. **Three layers**:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — UI                                                │
│ dev-console.tsx (default-pack)                              │
│   • Preact modal, registered via api.ui.registerModal       │
│   • Renders log, input, autocomplete dropdown               │
│   • Owns nothing — reads from ConsoleRegistry on each render│
│                                                             │
│   Override: any pack can re-register the same modal name    │
│   with a themed component. Engine doesn't know or care.     │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — Policy                                            │
│ commands.json (pack-shipped, optional)                      │
│   • defaultPolicy: allow | deny                             │
│   • modes.{dev,publish}.{allowAll,allowList,denyList}       │
│   • roles.{role}: command list w/ +/- composition           │
│   • commands.{name}.{build,runtime}                         │
│                                                             │
│   Build-time enforcement: pack-builder strips dev-only      │
│     command registrations from --mode=publish output.       │
│   Runtime enforcement: ConsoleRegistry.execute() checks     │
│     mode + role + custom predicate before dispatch.         │
├─────────────────────────────────────────────────────────────┤
│ Layer 1 — Mechanism                                         │
│ ConsoleRegistry (engine)                                    │
│   • register(name, handler, opts)                           │
│   • execute(line) → parse + policy-check + dispatch         │
│   • log(text, level) + log history                          │
│   • history (input lines) + role state                      │
│                                                             │
│ console-parser.ts (engine) — line → tokens → typed args     │
│ canonical-commands.ts (engine) — list of engine built-ins   │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Why this split

Layer 1 (mechanism) is engine-owned because it touches world,
components, scene loader, event bus. Layer 2 (policy) is pack data
because the pack author owns the answer to "who can run what."
Layer 3 (UI) is pack content because every modder will theme it
differently. Mirror precedent: the materials plan (shipped; see git
log) ships the shader cascade mechanism in engine, shader content
in packs, the visual policy editor in the editor.

`commands.json` is a JSONC file shipped inside the `.apg` at root,
peer to `manifest.json`. Pack-builder reads it at build time for
stripping; engine reads it at runtime for gating. Same schema, two
consumers. Layer 3 default UI is pack content per
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) — chained packs
override by calling `api.ui.registerModal("dev_console", ...)`
later (last-wins per [PACK_CHAIN.md](./PACK_CHAIN.md)).

---

## 4. ModAPI surface

### 4.1 Types

```ts
// packages/engine/src/ModAPI/types.ts (additions)

/**
 * Argument descriptor for a registered console command. Used by:
 *   - the parser to coerce string tokens to typed values
 *   - the autocomplete engine to suggest values for the next token
 *   - the editor's per-command form to render argument widgets
 *
 * `kind === "enum"` requires `values: readonly string[]`.
 * `kind === "path"` requires `pathSpace` — a hint for the autocompleter
 *   ("config" | "preset" | "scene" | "prefab" | "entity_name").
 */
export type ArgSchema =
  | { name: string; kind: "string"; rest?: boolean; help?: string }
  | { name: string; kind: "number"; help?: string }
  | { name: string; kind: "boolean"; help?: string }
  | { name: string; kind: "enum"; values: readonly string[]; help?: string }
  | { name: string; kind: "path";
      pathSpace: "config" | "preset" | "scene" | "prefab" | "entity_name";
      help?: string };

/**
 * Result of `api.console.execute(line)`. The same shape is what the UI
 * paints into the log. `level === "system"` carries engine-emitted
 * messages (policy denials, parse errors); pack-emitted output is
 * `info | warn | error`.
 */
export interface ExecuteResult {
  ok: boolean;
  level: "info" | "warn" | "error" | "system";
  text: string;
  /** Optional structured payload — render however the UI sees fit. */
  data?: unknown;
}

/**
 * Pack-side handler. Receives parsed args + a result-emitter. May
 * return a result synchronously or call `result.emit` async (for
 * commands that fire-and-fetch — e.g. `pack` reading manifest data
 * from an IDB-backed asset pack).
 */
export type ConsoleHandler = (
  args: readonly unknown[],
  ctx: ConsoleHandlerContext,
) => ExecuteResult | void | Promise<ExecuteResult | void>;

export interface ConsoleHandlerContext {
  /** Emit additional log lines beyond the return value. */
  log(text: string, level?: ExecuteResult["level"]): void;
  /** Raw line as typed, post-trim, pre-tokenisation. */
  rawLine: string;
  /** Resolved role at execute-time. */
  role: string;
  /** Resolved mode at execute-time ("dev" | "publish"). */
  mode: "dev" | "publish";
}

export interface ConsoleCommand {
  readonly name: string;
  readonly help: string;
  readonly args: readonly ArgSchema[];
  readonly examples?: readonly string[];
  /** Pack id that owns this registration; auto-tagged at register-time. */
  readonly packId: string | null;
}

export interface ConsoleAPI {
  /**
   * Register a command. Re-registration with the same name from the
   * same pack id is allowed (last-wins, supports HMR). Cross-pack
   * collisions log a warning and last-wins per the pack-chain order.
   */
  register(
    name: string,
    handler: ConsoleHandler,
    opts: {
      help: string;
      args?: readonly ArgSchema[];
      examples?: readonly string[];
    },
  ): void;

  /** Parse + policy-check + dispatch one line. */
  execute(line: string): Promise<ExecuteResult>;

  /** Write to the log without executing anything. */
  log(text: string, level?: ExecuteResult["level"]): void;

  /** Override the default backtick toggle. Pass null to disable. */
  bindKey(code: KeyCode | null): void;

  /** Mutate role state. Used by pack-defined unlock_cheats commands. */
  setRole(role: string): void;

  /** Current role. */
  readonly role: string;

  /** Current resolved build mode. Read-only — set by pack-builder. */
  readonly mode: "dev" | "publish";

  /**
   * Register a named predicate for use in commands.json's
   * `runtime.predicate` field. Called at command-execute time with
   * the parsed command + args + current role + current mode.
   */
  registerPolicy(
    name: string,
    predicate: (
      cmd: ConsoleCommand,
      args: readonly unknown[],
      role: string,
      mode: "dev" | "publish",
    ) => boolean,
  ): void;

  /** Enumerate registered commands. Used by `help`, autocomplete, the editor. */
  list(): readonly ConsoleCommand[];
}
```

Surface placement: `api.console: ConsoleAPI`. One field on `ModAPI`,
peer of `api.events`, `api.modals`, `api.ui`. Implementation lives in
`packages/engine/src/ModAPI/ConsoleRegistry.ts`.

### 4.2 Registration semantics

`register(name, handler, opts)`:

1. Validates `name` matches `/^[a-z][a-z0-9_]*$/` (snake_case, no
   `:`, no spaces). Reject otherwise — namespaces aren't a thing
   for commands, only for events.
2. Records the registration with `currentPackId` from the active
   pack-script load (same pattern as `EventsRegistry`).
3. If a command with the same name is already registered from a
   different pack: log a warning ("[console] command 'spawn'
   re-registered by pack 'acme_extras' — replacing previous
   registration from 'default-pack'"). Pack-chain last-wins.

### 4.3 Execute semantics

`execute(line)`:

1. Trim. Empty → no-op, return `{ ok: true, level: "info", text: "" }`.
2. Push to history (UI bookkeeping, deduplicated against the most
   recent entry).
3. Tokenise via `console-parser.ts` (§5). Lex errors → return
   `{ ok: false, level: "system", text: "parse error: …" }`.
4. Look up command by name. Unknown → `{ ok: false, level: "system",
   text: "unknown command 'foo' — try `help`" }`.
5. Policy check (§8.3). Denial → `{ ok: false, level: "system",
   text: "command 'foo' denied: role 'player' lacks permission" }`.
6. Type-coerce remaining tokens against `cmd.args`. Coercion failure
   → `{ ok: false, level: "system", text: "argument 'x': expected
   number, got 'banana'" }`.
7. Invoke handler with coerced args. Capture return value or
   accumulated `ctx.log()` lines. Wrap thrown errors into a `level:
   "error"` result.
8. Return final result. The UI appends each accumulated log line
   plus the final return value to the visible log.

### 4.4 Auto-cleanup on pack reload

Same pattern as `EventsRegistry`: registrations are pack-tagged;
`unloadPack(packId)` clears them on HMR. A pack-supplied command
disappears when the pack reloads, then re-appears when its script
re-runs. Built-in commands (canonical) live forever — engine itself
registers them on `Game` boot.

---

## 5. Built-in command catalog

Engine ships canonical commands in `canonical-commands.ts`, mirroring
the `canonical-events.ts` pattern. Registered at `Game` construction
with `packId: null` so they survive HMR. None are deletable from a
pack.

### 5.1 Discovery / navigation

| Command | Args | Behaviour |
|---|---|---|
| `help [cmd]` | `cmd: string?` | Without arg: list visible commands (policy-filtered) alphabetically, `name <args> — help`. With arg: full help including examples, source pack id, current policy verdict for current role/mode. |
| `clear` | — | Wipe the log buffer. History preserved. |
| `pack` | — | Print the loaded pack chain — id, version, source URL, integrity hash prefix, override count. Text-form mirror of the [PACK_CHAIN.md](./PACK_CHAIN.md) dependency modal. |

### 5.2 Config / state

| Command | Args | Behaviour |
|---|---|---|
| `set <path> <value>` | `path: path<config>`, `value: string` | Mutates `CONFIG.<path>` in place via `applyConfigOverride`. Live this frame. NOT persisted unless a pack opts into `api.settings.save`. Examples: `set rendering.fov 100`, `set lighting.dynamic.enabled false`. |
| `get <path>` | `path: path<config\|preset\|entity_name>` | Reads + pretty-prints. `get rendering.fov`, `get preset:brick.wall.reflectiveness`, `get @player.position.x` — last walks the ECS via `world.findByName`. |

### 5.3 World / entity manipulation

| Command | Args | Behaviour |
|---|---|---|
| `spawn <prefab> [x] [y]` | `prefab: enum<prefab ids>`, `x: number?`, `y: number?` | Routes through `api.spawn`. No coords = player position + 1 forward. Prefab enum sources dynamically from `PrefabRegistry.list()` so pack-registered prefabs autocomplete. |
| `tp <x> <y>` | `x: number`, `y: number` | Teleports the `PlayerInput`-bearing entity. Fires `player:teleported` ([EVENTS.md § 4.3](./EVENTS.md)). Bypasses collision — pairs with `noclip` for moving through geometry. |
| `noclip` | — | Toggles a per-player `Noclip` flag (§9.4). `MovementSystem` skips wall + height collision when set. |
| `scene <path>` | `path: path<scene>` | Scene swap. In `apps/editor` iframe mode round-trips via `postMessage` per [EDITOR_IFRAME.md](./EDITOR_IFRAME.md); standalone calls `Game.loadScene` directly. |

### 5.4 Diagnostics

| Command | Args | Behaviour |
|---|---|---|
| `fps` | — | Toggles FPS counter overlay. Hooks `stats-render.js`'s enabled flag. |
| `stats` | — | Toggles the deeper stats panel — per-frame update/render/sprite-cull breakdown, draw call count. |

### 5.5 Event tracing

| Command | Args | Behaviour |
|---|---|---|
| `events on <pattern>` | `pattern: string` (event topic / wildcard per [EVENTS.md § 3.3](./EVENTS.md)) | Subscribes a console-internal listener; each fire prints `[event] topic { payload }`. Additive across calls. |
| `events off [pattern]` | `pattern: string?` | With arg: drops one. Without: drops all. |

### 5.6 Live preset editing — the headline workflow

| Command | Args | Behaviour |
|---|---|---|
| `presets list [filter]` | `filter: string?` | `id — kind — pack-of-origin` for every preset in the resolver. Filter is substring match. |
| `preset edit <id> <field> <value>` | `id: enum<presets>`, `field: string`, `value: string` | Mutates `PresetResolver.resolve(id)[field]` + re-emits affected scene cells. Renderer picks up next frame. In-memory only; persistence requires a pack-defined `preset save` follow-up command. |

### 5.7 Dev escape hatches

| Command | Args | Behaviour |
|---|---|---|
| `eval <js>` | `js: rest-string` | Evaluates JS in a closure exposing `api`, `world`. Returns stringified result. **Dev-only, admin-gated.** Build-time stripped in publish (§8.2) — bytes literally aren't shipped. |
| `bind <key> <command_line>` | `key: string` (KeyCode), `command_line: rest-string` | Stores a keybind in a console-local map. Pressing the key fires the line. localStorage-persisted. Use cases: `bind F8 noclip`, `bind F2 "tp 12 7"`. Not `api.input` bindings — that's for game actions. |
| `unbind <key>` | `key: string` | Drops a bind. |

### 5.8 Canonical count

**14 commands** (with subcommands flattened to underscore-separated
names for parser uniformity): `help`, `clear`, `pack`, `set`, `get`,
`spawn`, `tp`, `noclip`, `scene`, `fps`, `stats`, `events_on`,
`events_off`, `presets_list`, `preset_edit`, `eval`, `bind`,
`unbind`. UI displays them with synthetic spaces. C4 may add space-
separated aliases (see §16, Q1).

---

## 6. Parser + lexer

`console-parser.ts` is ~150 LOC of straightforward state-machine
tokenisation, then schema-guided coercion. The total contract is:

```
parseLine(line: string): { tokens: Token[]; errors: ParseError[] }
coerceArgs(tokens: Token[], schema: ArgSchema[]):
  { args: unknown[]; errors: CoerceError[] }
```

### 6.1 Tokenisation rules

- Whitespace splits tokens. Multiple spaces collapse to one.
- Double-quoted strings preserve internal whitespace + `:` chars:
  `bind F2 "tp 12 7"` → 3 tokens (`bind`, `F2`, `tp 12 7`).
- Backslash escapes inside quoted strings: `\"`, `\\`, `\n`, `\t`.
- A token starting with `--` is a flag: `--save` → flag token
  `save`. Not consumed in C1; reserved for §11.4.
- Lex errors: unterminated quote, dangling backslash, NULL
  character. Each surfaces with a column index for UI underline.

### 6.2 Coercion per `ArgSchema.kind`

| kind | Accepts | Rejects |
|---|---|---|
| `string` | Any token. | `undefined` (missing required arg). |
| `number` | Parsable by `Number()`. NaN OK in the test? **No** — reject NaN. | Anything `Number(t)` returns NaN. |
| `boolean` | `true`/`false`/`on`/`off`/`1`/`0`/`yes`/`no` (case-insensitive). | Anything else. |
| `enum` | Exact match against `values`. | Mismatch → "expected one of: a, b, c". |
| `path` | Any non-empty string; deeper validation deferred to the command. | Empty. |

`rest: true` on a `string` arg consumes the remainder of the line
verbatim (post-tokenisation, the remaining tokens get re-joined with
a single space). Only valid on the last arg. Used by `eval`, `bind`.

### 6.3 Examples + edge cases

| Input | Tokens | Notes |
|---|---|---|
| `spawn imp` | `[spawn, imp]` | trailing args optional |
| `spawn imp 3 4` | `[spawn, imp, 3, 4]` | numeric coercion |
| `bind F2 "tp 12 7"` | `[bind, F2, tp 12 7]` | quoted preserved |
| `bind F2 tp 12 7` | `[bind, F2, tp 12 7]` | rest: true picks up tail |
| `eval api.world.size` | `[eval, api.world.size]` | rest token |
| `set rendering.fov 100` | `[set, rendering.fov, 100]` | path passes through |
| `events on player:*` | `[events_on, player:*]` | : preserved unquoted |
| `say "hello \"world\""` | `[say, hello "world"]` | escape handling |
| `say "unterminated` | `[say]` + parse error | column = position of `"` |

### 6.4 Numeric coercion specifics

- Decimal: `100`, `3.14`, `-5`, `1e3`.
- Hex/octal: NOT supported. Confused-with-snake-case risk too high.
- Infinity / NaN literals: rejected. Parsable but useless for commands.

---

## 7. Autocomplete

Tab cycles. Repeated Tab steps through alternatives in order.

### 7.1 First-token completion

First token = command name. Completion source: `ConsoleRegistry.list()`
filtered by policy (commands the current role + mode cannot run are
hidden from completion). Matching: prefix match. `tp` → `tp` (no
alternatives); `pre` → `preset_edit`, `presets_list`.

### 7.2 Argument completion

After the first token, the cursor's argument position is
`tokens.length - 1` (or `length` if the cursor's on a space).
Completion source = `ArgSchema` for that slot:

| kind | Completion source |
|---|---|
| `enum` | `values` array, prefix-filtered. |
| `path<config>` | `Object.keys(api.config)` walked one level per `.` in the partial. |
| `path<preset>` | `PresetResolver.allIds()`, prefix-filtered. |
| `path<scene>` | `pack.scenes` keys, prefix-filtered. |
| `path<prefab>` | `PrefabRegistry.list()`, prefix-filtered. |
| `path<entity_name>` | `world.allNamedEntities()`, prefix-filtered. |
| `string` / `number` / `boolean` | No completion suggestions; show the arg name as placeholder. |

### 7.3 UI behaviour

- Pressing Tab with no partial typed: cycle through all matches.
- Pressing Tab with a partial: complete to longest-common-prefix
  of matches, then on repeated Tab cycle the suffixes.
- Shift+Tab: cycle backwards.
- Escape clears the autocomplete dropdown without exiting console.

### 7.4 Dynamic suggestions

Some sources change at runtime (entity names: spawning a "boss"
makes `@boss` newly valid). The autocomplete reads fresh on each
keystroke — it's `O(known names)` and known-names is <100 typically.

---

## 8. Command policy system

This is the load-bearing part. A pack ships *one* set of `register`
calls; the policy file makes them behave correctly across dev /
publish, role / mode. Done badly, the modder lifts a denial they
didn't mean to lift or strips a command they did want to keep. Done
well, the same `register` calls in the same source produce
appropriate runtime behaviour without bespoke per-build wiring.

### 8.1 `commands.json` schema (verbatim, this is the spec)

```jsonc
{
  // What happens to commands NOT explicitly named below?
  // "allow" — visible + executable unless mode/role denies them.
  // "deny"  — invisible + unexecutable unless mode/role allows them.
  // RECOMMENDED: "deny". Forces explicit allow-listing for player exposure.
  "defaultPolicy": "deny",

  // Mode rules. Mode is set at build time by pack-builder (--mode flag,
  // default "dev"). Engine sets api.console.mode at boot from the
  // shipped commands.json (or "dev" if no file shipped).
  "modes": {
    "dev":     { "allowAll": true },
    "publish": { "allowList": ["help", "credits"] }
  },

  // Roles. Set runtime by api.console.setRole(name); persisted to
  // localStorage per-session. Default role is "player". The role
  // determines which commands are visible/executable AFTER the mode
  // check passes.
  //
  // Composition rules:
  //   "+name"   — add name to the role's allow list.
  //   "-name"   — remove name from the inherited base.
  //   "*"       — wildcard, all commands.
  //   ["a","b"] — explicit list.
  //
  // Roles compose top-down. "player" is the base; later roles
  // can `+spawn` to ADD or `-help` to REMOVE.
  "roles": {
    "player": ["help", "credits", "fps", "ping"],
    "cheat":  ["+spawn", "+tp", "+noclip", "+set"],
    "admin":  "*"
  },

  // Per-command overrides. Both fields optional. If a command appears
  // here AND in mode/role lists, the per-command rule wins.
  "commands": {
    "eval": {
      // "always" — included in every build.
      // "dev-only" — stripped from publish builds (pack-builder rewrites
      //   the register() call to a no-op, see §8.2).
      // "publish-only" — stripped from dev builds (rare; useful for
      //   commands that simulate cheats only the released build should
      //   surface, e.g. anti-cheat reporting).
      "build": "dev-only",
      "runtime": { "requireRole": "admin" }
    },
    "spawn": {
      "build": "always",
      "runtime": { "requireRole": "cheat" }
    },
    "unlock_cheats": {
      "build": "always",
      // Custom named predicate. Registered via api.console.registerPolicy.
      // Receives (cmd, args, role, mode). Returns boolean.
      "runtime": { "predicate": "cheatCodeMatches" }
    },
    "give_weapon": {
      "build": "always",
      "runtime": {
        "requireRole": "cheat",
        // Multiple constraints AND together.
        "predicate": "weaponExistsAndNotEquipped"
      }
    }
  }
}
```

### 8.2 Build-time gating

`apps/pack-builder/src/build-packs.ts` reads `commands.json` and the
pack-script source files. For each command whose `build` field
matches the *opposite* of the active build mode, the builder finds
its registration call and rewrites it.

**Detection logic** (regex + tiny AST validation — full AST not
needed because the pattern is rigid):

```ts
// Match shape: api.console.register("name", handler, opts)
//   where "name" is a string literal matching the dev-only list.
const PATTERN =
  /api\.console\.register\(\s*["']([a-z][a-z0-9_]*)["']/g;

for (const m of source.matchAll(PATTERN)) {
  const name = m[1];
  if (shouldStrip(name, buildMode)) {
    const startCall = m.index;
    const endCall = findMatchingCloseParen(source, startCall);
    // Replace the entire api.console.register(...) statement with
    // a no-op comment; preserve line count so source maps stay sane.
    source = source.slice(0, startCall)
      + `/* stripped at build (${buildMode}): ${name} */ void 0`
      + source.slice(endCall + 1);
  }
}
```

**Edge cases**:

- **Dynamic command name** (`const NAME = "eval"; api.console.register(NAME, …)`).
  The regex won't match. Pack-builder logs a warning: "[console]
  cannot statically resolve command name at packages/.../foo.ts:42 —
  command will not be build-time strippable. Use a string literal."
  Recommendation: just use literals. There's no good reason to
  dynamically name a command.
- **Conditional registration** (`if (DEV) api.console.register("foo", …)`).
  Builder still strips if `foo` is in the dev-only list. The
  conditional becomes redundant but doesn't break.
- **Pack chains** (a downstream pack registers a command that an
  upstream pack's `commands.json` marked dev-only). Each pack's
  `commands.json` ONLY applies to its own scripts. Cross-pack
  policy is resolved at runtime, not build time — see §8.4.

**Mode flag**:

```sh
bun run build-packs --mode=publish    # strip dev-only commands
bun run build-packs                    # default: --mode=dev
```

The flag is recorded in `manifest.json.buildMode` so the engine
can read it at boot and set `api.console.mode` accordingly. Pack
authors can also set it manually in manifest, but the build flag
overrides.

### 8.3 Runtime gating

`ConsoleRegistry.execute(line)` runs these checks **in order** —
the first failure short-circuits:

1. **Command exists?** If `register()` was never called for this
   name → "unknown command" (system level).
2. **Mode allows?** Resolve from `commands.json.modes[mode]`. If
   `allowAll: true` → pass. If `allowList` → name must be in list.
   If `denyList` → name must NOT be in list. If both: allow-list
   wins (intersection).
3. **Role allows?** Compose role's effective command list per §8.4.
   Name must be in it (or role === `"*"`).
4. **Per-command rule?** If `commands[name].runtime.requireRole`,
   the current role must equal or inherit-from the named role.
5. **Custom predicate?** If `commands[name].runtime.predicate`,
   call the registered predicate with `(cmd, args, role, mode)`.
   Must return `true`.

Denials emit `{ ok: false, level: "system", text: "command
'spawn' denied: role 'player' lacks permission (requires 'cheat')" }`.
The text is always specific — modders debugging policy need to know
*which* gate denied.

### 8.4 Roles + composition

Roles are configured in `commands.json.roles`. Each role's
effective command set is computed by walking:

1. Start with the role's own value (`["help","fps"]`, `"+spawn"`,
   `"*"`, etc.).
2. If string `"*"` → wildcard, accept everything.
3. If list:
   - Items not starting with `+` or `-` → SET the list.
   - Items starting with `+` → ADD to inherited base.
   - Items starting with `-` → REMOVE from inherited base.

The "inherited base" is the role declared immediately above in the
JSON. Order matters: `roles` is an OBJECT but JSON property order
is well-defined in V8 + JSC + SpiderMonkey for string keys, so the
spec is "iteration order = composition order." Authors can be
explicit with a top-level `roleOrder: ["player", "cheat", "admin"]`
field if they need to pin it.

**Runtime role change**: `api.console.setRole(name)` flips the
current role. Persisted to localStorage keyed by pack-id so it
survives reload. Pack authors gate the call:

```js
// In a pack script
api.console.register("unlock_cheats", (args) => {
  const [pw] = args;
  if (pw !== "qwertyuiop") return { ok: false, level: "error", text: "no" };
  api.console.setRole("cheat");
  return { ok: true, level: "info", text: "cheats unlocked" };
}, {
  help: "Unlock cheat commands.",
  args: [{ name: "password", kind: "string" }],
});
```

The `unlock_cheats` command itself appears in the `commands` map
with `runtime: { predicate: "cheatCodeMatches" }` — see the
example schema in §8.1.

**Cross-pack composition**: when packs chain
([PACK_CHAIN.md](./PACK_CHAIN.md)), each pack ships its own
`commands.json`. The engine merges them in chain order — later
packs' `commands` map override earlier packs' for the same command
name, last-wins. `roles` are union'd by name + composed within
each role; `modes` similarly merge. The `defaultPolicy` of the
top-most pack wins.

### 8.5 Custom predicates

`api.console.registerPolicy(name, predicate)` records a named
predicate. The `commands.json` `runtime.predicate` field
references it by name. Engine looks it up at execute-time and
calls it:

```js
api.console.registerPolicy("cheatCodeMatches", (cmd, args, role, mode) => {
  return args[0] === "qwertyuiop";
});

api.console.registerPolicy("onlyOnBossFight", (cmd, args, role, mode) => {
  return api.world.currentSceneName() === "boss_fight.json";
});

api.console.registerPolicy("multiplayerHostOnly", (cmd, args, role, mode) => {
  return api.network?.isHost ?? false;  // future, MP M3
});
```

Predicates are sync, pure-by-convention, fast. Engine doesn't
timeout them but a predicate that takes >1 ms blocks the keystroke.

**Unknown predicate**: a `commands.json` referencing `predicate:
"cheatCodeMatches"` when no `registerPolicy("cheatCodeMatches", …)`
has been called yet fails closed — the command is denied with
"predicate 'cheatCodeMatches' not registered." Authors register
predicates in pack-script load order BEFORE the user could open
the console.

---

## 9. Engine implementation sketch

### 9.1 `packages/engine/src/ModAPI/ConsoleRegistry.ts` (~300 LOC)

```ts
export class ConsoleRegistry implements ConsoleAPI {
  private commands = new Map<string, ConsoleCommandEntry>();
  private policies = new Map<string, PolicyPredicate>();
  private log: LogLine[] = [];                  // ring buffer, ~1000 lines
  private history: string[] = [];               // localStorage-backed
  private currentRole = "player";
  private currentPackId: string | null = null;
  private toggleKey: KeyCode | null = "Backquote";
  private commandsJson: CommandsJson;

  constructor(
    private world: World,
    private events: EventsAPI,
    private modals: ModalsRegistry,
    public readonly mode: "dev" | "publish",
  ) {}

  // ConsoleAPI surface: register, execute, log, bindKey, setRole,
  // registerPolicy, list, plus the role/mode getters.
  // Internal: setActivePack, unloadPack, loadCommandsJson, installBuiltIns.
}
```

`Game.ts` instantiates the registry post-events, post-modals, loads
the active pack's `commands.json`, calls `installBuiltIns`, then
opens the keyboard listener that watches for the toggle key and
flips `api.modals.setOpen("dev_console", …)`.

### 9.2 `packages/engine/src/ModAPI/console-parser.ts` (~150 LOC)

Pure functions, no registry dependency. Exports `parseLine(line)`,
`coerceArgs(tokens, schema)`, `buildCompletionContext(line, cursor,
schema)`. Tested in isolation against the §6.3 fixtures.

### 9.3 `packages/engine/src/ModAPI/canonical-commands.ts` (~250 LOC)

Mirror of `canonical-events.ts`. Exports `installCanonicalCommands(
registry, api)` which registers all 14 built-ins with `currentPackId
= null` so they survive pack reload. Each handler closes over `api`
for world/config/scene access.

### 9.4 `packages/engine/src/Components/Noclip.ts` (~20 LOC)

Tiny ECS component the `noclip` command flips. `MovementSystem`
checks for its presence and skips wall + height collision. Named so
pack authors can attach it to other entities for free-flying NPCs.

### 9.5 `packages/default-pack/scripts/systems/dev-console.tsx` (~400 LOC)

The Layer-3 UI. Registered via `api.ui.registerModal("dev_console",
DevConsole, liveProps)` — same shape as `settings-screen.tsx`. The
component reads log/history/autocomplete state from the registry via
freshly-resolved live props on each render; state ownership stays in
the registry. A ~50-line companion system watches the toggle key
and flips `api.modals.setOpen("dev_console", …)`.

### 9.6 Engine total

ConsoleRegistry + parser + canonical-commands + Noclip + types ≈
700 LOC engine, ~400 LOC default-pack UI. C1 ships in one PR.

---

## 10. UI design

### 10.1 Layout

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   [log line 1]   info  (default white)                     │
│   [log line 2]   warn  (yellow)                            │
│   [log line 3]   error (red)                               │
│   [log line 4]   system (cyan)                             │
│   …                                                         │
│   [autocomplete dropdown — relative to cursor]              │
│                                                            │
│   > _                                                       │
└────────────────────────────────────────────────────────────┘
```

- Modal centred, ~60vw × ~80vh, semi-opaque dark background
  (`rgba(0,0,0,0.85)`).
- Monospace (`ui-monospace, "Cascadia Code", "Source Code Pro",
  Menlo, Consolas`).
- Log scroll auto-pinned to bottom; mousewheel up pauses
  auto-pin until cleared. New lines append.
- Input row: prompt `>` + a single-line input. Shift+Enter
  inserts a literal newline + grows the input to multi-line
  (deferred to C4 — C1 ships single-line).
- Autocomplete dropdown appears beneath the input when Tab
  cycles through ≥2 candidates. Inline ghost-text completion
  for a single match.

### 10.2 Keybinds

- ` (backtick) — toggle. Override via `api.console.bindKey(code)`.
- Enter — execute current line.
- Up/Down — history navigation.
- Tab / Shift+Tab — autocomplete cycle.
- Ctrl+L — clear log (alias for `clear`).
- Ctrl+U — clear current input.
- Escape — close console (suppressed if any other modal that
  responds-to-escape is open via `api.modals.anyOther`).

### 10.3 Colour-coded log levels

| Level | Color | Use |
|---|---|---|
| `info` | `#e8e8e8` (default) | Pack-emitted success messages. |
| `warn` | `#ffb84d` | Pack-emitted warnings. |
| `error` | `#ff5d5d` | Pack-emitted errors. Handler throws also land here. |
| `system` | `#5dd7ff` | Engine-emitted: parse errors, policy denials, command success summaries. |

### 10.4 Pack-overridable UI

The default-pack ships `DevConsole.tsx` in `scripts/ui/`. Other
packs override by calling `api.ui.registerModal("dev_console",
MyThemedConsole, livePropsFn)` after the default-pack registers.
[PACK_CHAIN.md](./PACK_CHAIN.md) last-wins applies — the chained
pack's UI is what mounts.

The live-props function gets called every render and returns
`{ registry: ConsoleRegistry, onClose: () => void }`. Components
read state from `registry` (log buffer, current input, autocomplete
state, etc.) — making `registry` the single source of truth makes
themed overrides drop-in. They don't need to re-implement history
recall or autocomplete; they just paint different pixels.

### 10.5 Performance

The console is rendered only when open. Closed = `isOpen("dev_console")
=== false`, modal unmounts, zero per-frame cost. Open: one Preact
re-render per keystroke + one per emitted log line. Log buffer is
a ring buffer capped at 1000 lines; older lines drop. Even with
`events on *` firing 60 Hz, the UI's `requestAnimationFrame`-throttled
re-render keeps cost flat (~one render per frame regardless of how
many log events accumulated).

---

## 11. Editor Commands tab

[EDITOR.md § 6.5](./EDITOR.md) describes the Project Settings modal:
tabs for **Manifest** / **Dependencies** / **Export** / **Advanced**.
C3 adds a fifth: **Commands**.

### 11.1 Tab layout

```
┌─ Project Settings ────────────────────────────────────────┐
│ Manifest  Dependencies  Export  Commands  Advanced        │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  Default policy  ( allow ◯ deny ◉ )                       │
│                                                           │
│  ┌─ Modes ──────────────────────────────────────────┐    │
│  │ dev      [ allowAll ✓ ]                          │    │
│  │ publish  [ allow-list:  help, credits ]          │    │
│  │          [+ add command ▼] [- remove]            │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ Roles ──────────────────────────────────────────┐    │
│  │ player   help, credits, fps, ping                │    │
│  │ cheat    +spawn, +tp, +noclip, +set              │    │
│  │ admin    *                                       │    │
│  │ [+ add role]                                     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ Per-command ────────────────────────────────────┐    │
│  │ eval                                             │    │
│  │   build:    [dev-only ▼]                         │    │
│  │   requireRole: [admin ▼]  predicate: [-]         │    │
│  │ spawn                                            │    │
│  │   build:    [always ▼]                           │    │
│  │   requireRole: [cheat ▼]  predicate: [-]         │    │
│  │ …                                                │    │
│  │ [+ add per-command rule]                         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ Mode preview ───────────────────────────────────┐    │
│  │ Mode:  ( dev ◯ publish ◉ )                       │    │
│  │ Role:  [ player ▼ ]                              │    │
│  │                                                  │    │
│  │ Resolved visible commands (in this mode + role): │    │
│  │   • help                                         │    │
│  │   • credits                                      │    │
│  │                                                  │    │
│  │ ⚠ 7 commands hidden — `spawn`, `tp`, `noclip`,   │    │
│  │   `eval`, `set`, `get`, `bind` (require role     │    │
│  │   bump or denied by mode)                        │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 11.2 Mode preview

The headline feature. Pick `(mode, role)`, see the resolved command
list — exactly the commands a player in that mode + role can run.
Picks up live changes as the author edits the policy file: the
preview is just `ConsoleRegistry.list()` called with the proposed
policy applied client-side in the editor.

The preview surfaces:

- **Visible commands**: green-bullet list.
- **Hidden commands**: tooltipped with reason ("denied by mode
  publish allow-list", "requires role 'cheat'", "predicate
  'cheatCodeMatches' denied this call"). Predicate-based commands
  show as "depends on runtime state" since the predicate isn't
  callable from the editor.

This is the no-surprises guarantee from the spec: an author can
verify "yes, in publish mode my player can only run help and
credits, and yes, cheat unlocks add spawn/tp/noclip exactly as
expected" *before* shipping the `.apg`.

### 11.3 Per-command form

A schema-driven form per `commands.{name}` entry. Drop-downs for:

- `build`: always / dev-only / publish-only / inherit.
- `runtime.requireRole`: dropdown from defined roles, plus
  `<none>`.
- `runtime.predicate`: dropdown from pack-side
  `registerPolicy`-declared names, plus `<none>`. Editor reads
  available predicates from a `commands.json.predicates` declared
  list (authoring convenience — runtime registration is what
  actually counts).

### 11.4 Editor-only validation

The Commands tab runs continuous validation while open:

- **Unused predicates**: predicate referenced but no `registerPolicy`
  call in any pack-script (regex-scanned). Yellow warning.
- **Predicates without references**: declared but unused. Subtler
  warning.
- **Stripped commands inadvertently flagged player-visible**: e.g.
  `eval` `build: dev-only` but `modes.publish.allowList` includes
  `eval`. Red error — in publish mode the command WILL appear in
  the policy but the registration is stripped; runtime says
  "unknown command." Editor flags this so the author fixes
  intent before publishing.

### 11.5 Persistence

Edits to `commands.json` round-trip through the IDB-backed
project store like every other manifest field per
[EDITOR.md § 7](./EDITOR.md). The file is included in the `.apg`
export at root, peer to `manifest.json`.

---

## 12. Use cases — worked examples

### 12.1 Live preset editing (headline)

```
> presets list .wall
brick.wall — tile_floor — default-pack
mossy.brick.wall — tile_floor — default-pack

> preset edit brick.wall reflectiveness 0.85
brick.wall.reflectiveness: 0.4 → 0.85 (rebaked 14 tile references)

> preset edit brick.wall reflectiveness 1.2
[error] reflectiveness out of range [0, 1]; value rejected
```

Round-trip per tweak: ~200 ms. No reload. Iterative tuning becomes
feasible.

### 12.2 Event tracing for a bug

```
> events on weapon:* +inventory:*
tracing — 5 events captured

[event] weapon:fired { weaponId: "shotgun", ammoLeft: 12 }
[event] inventory:removed { itemId: "shells", count: 1 }

[shot again]
[event] weapon:fired { weaponId: "shotgun", ammoLeft: 12 }
[no inventory:removed]
```

Trace shows `weapon:fired` ran but `inventory:removed` didn't —
narrows the bug from "ammo system" to "consume path in gun-render.js."

### 12.3 AI playtesting — pack-registered command

```js
api.console.register("spawn_zombie_horde", ([count]) => {
  for (let i = 0; i < count; i++)
    api.spawn("zombie", playerX + Math.cos(i)*5, playerY + Math.sin(i)*5);
  return { ok: true, level: "info", text: `spawned ${count} zombies` };
}, {
  help: "Spawn N zombies in a circle around the player.",
  args: [{ name: "count", kind: "number" }],
});
```

```
> spawn_zombie_horde 50
spawned 50 zombies
```

### 12.4 Bug repro from a playtester

A playtester reports: "I die instantly entering boss_fight." Paste
the repro:

```
> scene boss_fight
> tp 14 12
> get @player.health
@player.health: 100
[death]
```

Repro lands exactly where the tester landed. Author `noclip`s out,
inspects the trigger entity.

### 12.5 Pack-author cheats via unlock

```js
api.console.registerPolicy("cheatCodeMatches", ([pw]) => pw === "iddqd");
api.console.register("unlock_cheats", () => {
  api.console.setRole("cheat");
  return { ok: true, level: "info", text: "cheats unlocked." };
}, { help: "Unlock cheats.", args: [{ name: "code", kind: "string" }] });
```

```
> spawn imp
command 'spawn' denied: role 'player' lacks permission (requires 'cheat')
> unlock_cheats iddqd
cheats unlocked.
> spawn imp 5 5
spawned entity 47
```

In publish mode, `unlock_cheats` is the only allow-listed gateway;
once it runs, the role bumps and the cheat family becomes available.

### 12.6 Multiplayer admin (future, M3)

```js
api.console.registerPolicy("multiplayerHostOnly", () => api.network?.isHost ?? false);
api.console.register("kick", ([playerId]) => {
  api.network.kick(playerId);
  return { ok: true, level: "info", text: `kicked ${playerId}` };
}, { help: "Kick a player.", args: [{ name: "playerId", kind: "string" }] });
```

`commands.json`: `"kick": { "build": "always", "runtime": { "predicate": "multiplayerHostOnly" } }`.

Non-host players see `kick` denied even on the same `.apg` — the
predicate gates by live runtime state. Also: `mute`, `ban`,
`warp_player`.

### 12.7 Editor-driven scene swap

```
> scene level3
[editor] scene swap requested: level3.json
```

In `apps/editor`, `scene` posts through the iframe bridge
([EDITOR_IFRAME.md](./EDITOR_IFRAME.md)) and triggers the editor's
scene-load flow (with the pre-bake check per
[EDITOR.md § 7.2](./EDITOR.md)).

---

## 13. Trust model

The asymmetry between build-time stripping and runtime gating is
the load-bearing security guarantee. Both check the same policy;
only one is binding.

### 13.1 Build-time stripping is binding

A command marked `build: "dev-only"` has its
`api.console.register(...)` call rewritten in the published `.apg`.
The bytes aren't there. Calling `api.console.execute("eval …")`
returns "unknown command" — not "denied" — because the registration
never happened. This is the only defence against an attacker who'd
patch the engine to skip the runtime check: they can't restore
source code that was never shipped.

### 13.2 Runtime gating is convenience

The role check is a UX gate, not a security boundary. A determined
attacker with the published `.apg` could read the unzipped pack
source, patch the engine, or mutate `commands.json`. None of these
are bugs the engine fixes — same trust model
[EVENTS.md § 6.4](./EVENTS.md) and [STORE.md § 8](./STORE.md)
document. Pack scripts are not sandboxed.

### 13.3 Why this is fine

The threat model is **player-facing safety**, not security against
modders. A naive player shouldn't accidentally fire `eval
api.world.despawn(playerEntity)`; mode + role gates accomplish
that. Players don't reverse-engineer `.apg` files — if they do,
they're a modder, and the trust line moves.

### 13.4 What we guarantee

1. **No unintended player exposure.** Default `deny` + mode + role
   means published packs reveal only what the author allow-listed.
2. **No build-time exposure.** Dev-only commands are physically
   stripped. A hostile downstream pack can't "reach in" to a
   stripped registration.
3. **No cross-pack policy leakage.** Each pack ships its own
   `commands.json`; merges are deterministic and cannot widen a
   stricter mode constraint from upstream (intersection wins for
   `allowList`, union wins for `denyList`).
4. **Predictable denial messages.** Every denial says exactly
   which gate denied. No silent failures.

### 13.5 What we do NOT guarantee

Sandboxed pack execution; sandboxed `commands.json` editing by
other packs; network-side command auth (multiplayer handles its
own); replay-safety of command history (no undo).

---

## 14. Performance characteristics

### 14.1 Closed-console cost

Zero. The modal is unmounted. No registry method runs unless `execute`
is called externally (e.g. a `bind`-triggered command line firing on
keypress).

### 14.2 Open-console cost

| Operation | Cost |
|---|---|
| Keystroke (no Tab) | One Preact rerender. <0.5 ms. |
| Tab autocomplete | One `list()` filter pass + DOM render. <1 ms typical. |
| Enter (execute) | Parse (<0.1 ms) + policy check (5 Map lookups, <0.05 ms) + handler call (handler-dependent). |
| `events on *` rate | 60 Hz emits → 60 Hz `log()` calls → ring buffer push + a render-coalesced UI update. <0.1 ms per emit. |

### 14.3 Memory

- Log buffer: 1000 lines × ~120 bytes avg ≈ 120 KB. Bounded.
- History: 200 lines × ~80 bytes ≈ 16 KB. localStorage-backed.
- Registry: 14 built-ins + ~5-20 pack-registered ≈ 30 entries × ~250 bytes ≈ 8 KB.
- Total: <200 KB regardless of session length.

### 14.4 Build-time stripping cost

Pack-builder regex pass over scripts: ~5-10 ms per pack-script file.
For a default-pack with ~10 scripts: <100 ms added to a full pack
build. Negligible against the existing bake/asset-encode cost.

---

## 15. Phases

| Phase | Scope | State |
|---|---|---|
| **C1** | Engine `ConsoleRegistry` + `console-parser.ts` + `canonical-commands.ts` with ~14 built-ins + default-pack `dev-console.tsx` UI + backtick toggle + Up/Down history. No policy yet — engine treats `defaultPolicy: "allow"`, everything visible. Tests cover parser, registry register/execute, history persistence, modal lifecycle. | Designed. Not started. |
| **C2** | `commands.json` schema + runtime gating (modes / roles / predicates) + `api.console.setRole` / `registerPolicy` + pack-builder `--mode=publish` flag that strips `build: "dev-only"` registrations. Cross-pack merge rules for chains. Default-pack ships a sample `commands.json` demonstrating the patterns. | Designed. Not started. |
| **C3** | `apps/editor` Project Settings → **Commands** tab: visual policy editor (defaultPolicy + modes + roles + per-command rules) + mode preview. Editor-only validation (unused predicates, stripped-but-allow-listed conflicts). Live IDB persistence. | Designed. Awaits C2 to land in engine. |
| **C4** | Polish: pack-overridable UI demo (a Doom-themed override in a sample pack), default-pack-registered commands spread across systems (gun-render's `weapon_state`, pickup's `inventory_dump`, etc.), Shift+Enter multi-line input, autocomplete inline ghost-text + per-arg help tooltip, `bind` command + keybind layer + localStorage persistence. | Designed. Awaits C1-C3. |

### 15.1 C1 file map (planned)

- `packages/engine/src/ModAPI/ConsoleRegistry.ts` — NEW. The class
  in §9.1.
- `packages/engine/src/ModAPI/console-parser.ts` — NEW. The pure
  parser in §9.2.
- `packages/engine/src/ModAPI/canonical-commands.ts` — NEW. The
  built-ins list in §9.3.
- `packages/engine/src/ModAPI/types.ts` — extend `ModAPI` with
  `console: ConsoleAPI`; export `ArgSchema`, `ExecuteResult`,
  `ConsoleCommand`, `ConsoleHandler`, `ConsoleHandlerContext`,
  `ConsoleAPI`.
- `packages/engine/src/ModAPI/ModAPIImpl.ts` — instantiate
  registry + wire it onto `api.console`.
- `packages/engine/src/Components/Noclip.ts` — NEW. Tiny flag
  component for the `noclip` command.
- `packages/engine/src/Systems/MovementSystem.ts` — skip
  collision when entity has `Noclip`.
- `packages/engine/src/Game.ts` — install canonical commands +
  load `commands.json` from pack at boot + emit
  `console:opened` / `console:closed` events (additions to
  [EVENTS.md § 4](./EVENTS.md)'s canonical list).
- `packages/default-pack/scripts/systems/dev-console.tsx` — NEW.
  The Layer-3 UI.
- `packages/default-pack/scripts/ui/DevConsole.tsx` — NEW. The
  Preact component (history view + input + autocomplete).
- `packages/default-pack/scripts/ui/dev-console.css` — NEW.
  Modal styling. Monospace, semi-opaque backdrop, scrollbar.

### 15.2 C2 file map (planned)

- `packages/engine/src/ModAPI/console-policy.ts` — NEW. The
  schema parser + merge + check functions.
- `packages/engine/src/ModAPI/ConsoleRegistry.ts` — extend
  `execute` to run the policy gate; add `setRole`,
  `registerPolicy`, `loadCommandsJson`.
- `apps/pack-builder/src/build-packs.ts` — read
  `commands.json`, regex-rewrite `api.console.register` for
  stripped commands, write back the modified script. Add
  `--mode` CLI flag.
- `packages/default-pack/commands.json` — NEW. A demo policy
  file with realistic modes/roles/predicates.

### 15.3 C3 file map (planned)

- `apps/editor/src/views/ProjectSettings/CommandsTab.tsx` — NEW.
  The visual policy editor.
- `apps/editor/src/views/ProjectSettings/ModePreview.tsx` — NEW.
  The mode-preview pane.
- `apps/editor/src/lib/commands-validation.ts` — NEW.
  Editor-side validation logic (unused predicates, conflicts).
- `apps/editor/src/store/project.ts` — extend project store
  with `commandsJson` IDB row.

### 15.4 C4 file map (planned)

- `packages/default-pack/scripts/systems/dev-console.tsx` —
  multi-line input, inline ghost-text completion.
- `packages/default-pack/scripts/systems/{gun-render,pickup,…}.js` —
  register pack-side commands (`weapon_state`, `inventory_dump`).
- Sample themed-console pack: `packages/sample-doom-console/` —
  illustrates `api.ui.registerModal("dev_console", …)` override
  pattern.
- `bind` command's localStorage round-trip in ConsoleRegistry.

---

## 16. Open questions

1. **Subcommand syntax** (e.g. `preset edit` vs `preset_edit`).
   The §5 catalog uses underscores for parser uniformity but the
   UI may want to display the space-separated forms. Recommendation:
   register both names as aliases — typing either matches. C1
   ships with underscores only; C4 polish adds aliases. Confirm
   during C1.

2. **Where does the policy decide on the editor side vs the
   engine side?** The editor must independently parse and apply
   `commands.json` so the mode-preview is accurate without
   running the engine. Sharing the parser between
   `apps/editor` and `packages/engine` means lifting
   `console-policy.ts` into a shared module (or `packages/shared`).
   Recommendation: keep it in engine but re-export through
   `@two_5_d/engine` so the editor imports the same code. Same
   pattern as `bakeScene` per [EDITOR.md § 7](./EDITOR.md).

3. **Editor live-console mode?** Tempting: while the engine's
   running in the editor iframe, expose a Commands tab pane that's
   a live console connected via postMessage. Would let the editor
   author iterate without alt-tabbing. Recommendation: defer to
   C4 polish if requested; not in critical path.

4. **History deduplication granularity.** Today: most-recent only.
   But `bash` dedupes only consecutive duplicates by default — and
   that's the same behaviour. Some users want full history dedup
   (a unique-set across all entries). Recommendation: match bash
   (consecutive only). Revisit if asked.

5. **`set` persistence semantics.** Live mutation is obvious. Should
   `set` persist by default? Recommendation: NO — `set` mutates
   live CONFIG without persisting; persistence is opt-in via
   `--save` flag (when flag-arg syntax lands in C4) or a pack-side
   companion `save_settings` command. Persisting silently is
   confusing.

6. **Async handlers and the visible "running…" state.** A handler
   that returns a Promise should show a spinner. Recommendation:
   yes, UI renders an inline "…" suffix on the active log line
   until the promise resolves. C1 ships sync-only display; C4
   adds the spinner.

7. **Console-emitted events.** Should engine emit `console:opened`
   / `console:closed` / `console:executed` so packs can subscribe?
   Recommendation: yes — addable to
   [EVENTS.md § 4](./EVENTS.md)'s canonical list (would push the
   count from 25 → 28). The `console:executed { line, result }`
   event in particular enables a pack to mirror commands to a
   server (multiplayer) or replay buffer.

8. **Multi-pack command collision UX.** Today: warning + last-wins.
   But two packs registering `give_weapon` may both have valid
   reasons. Recommendation: keep last-wins but the editor's
   Commands tab shows a "shadowed by 'acme_extras'" badge on the
   eclipsed registration so the author can choose. Possibly the
   pack-chain dependency-priority UI from [EDITOR.md § 6.5](./EDITOR.md)
   gives a knob to flip the order.

9. **Console + multiplayer**. A multiplayer pack might want
   commands to fan out to other clients (server-replicated
   `/me does a thing` chat). Recommendation: defer to
   [MULTIPLAYER_PLAN.md § M3](./MULTIPLAYER_PLAN.md) — the
   multiplayer pack subscribes to `console:executed` (per Q7) and
   forwards selected commands. Engine stays local-only.

10. **Theme tokens for pack-overridable UI.** If override packs are
    common, having a small "theme tokens" object (colors, font
    family, font size) the default-pack UI reads from would let a
    pack just override tokens without writing a whole component.
    Recommendation: out of scope for C1-C4; revisit in a future
    "theming pass" if demand emerges.

---

## 17. Cross-references

- [EVENTS.md § 4](./EVENTS.md) — canonical event topics the console
  subscribes to for tracing; may add `console:opened/closed/executed`
  in C2 (Q7 above).
- [EDITOR.md § 6.5](./EDITOR.md) — Project Settings modal tabs; C3
  adds **Commands** as the fifth tab.
- [PACK_CHAIN.md](./PACK_CHAIN.md) — multi-pack chain semantics
  define how multiple packs' `commands.json` files merge.
- The materials plan § 7 (shipped; see git log) — the precedent
  for how the pack-builder reads a pack JSON file and rewrites
  pack-script source (the Shader-component validation pass) —
  similar static-analysis discipline applies to command stripping.
- [ANIMATIONS.md § 3](./ANIMATIONS.md) + [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) —
  the companion-doc pattern this doc follows: engine plan +
  editor authoring plan, two docs cross-referenced.
- [STORE.md § 8](./STORE.md) — trust model the policy system
  inherits + the trust modal the chain loader shows on untrusted
  packs.
- [MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) — future
  network-replicated commands (Q9).
- [TILE_PRESETS.md § 5](./TILE_PRESETS.md) — `preset edit`'s
  PresetResolver target.
- [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) — `scene` command's
  iframe-bridge round trip in editor mode.
