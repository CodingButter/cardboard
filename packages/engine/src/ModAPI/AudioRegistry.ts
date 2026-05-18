import type { AssetPack, SoundDef, SoundGroup } from "AssetPack";
import { CONFIG } from "GameConfig";
import type { RecipeStore } from "ProceduralAudio";
import type { AudioAPI, AudioHandle, PlayOpts } from "./types";

/**
 * Web Audio backend + ModAPI binding for Au1 of `docs/plans/AUDIO.md`.
 *
 * The registry owns:
 *
 *   - The lazily-instantiated `AudioContext` (first play call triggers
 *     it, so a pack that never plays a sound never builds the audio
 *     graph). See AUDIO.md §5.3.
 *   - The five group gain nodes (`master`, `sfx`, `music`, `ambient`,
 *     `voice`) — `master` is wired to `ctx.destination`, the other
 *     four feed `master`. See AUDIO.md §5.1.
 *   - A decode cache keyed by sound id. Eager sounds (preload not
 *     explicitly `false`) start decoding at `preloadAll()` time; lazy
 *     sounds decode on first `play()`.
 *   - A live set of `AudioHandle`s so `stopAll(group?)` works and
 *     handles automatically drop out of the set on the underlying
 *     `BufferSource`'s `ended` event.
 *
 * One `AudioRegistry` per `ModAPI` instance. The engine constructs it
 * with the active pack; if the pack doesn't ship `manifest.audio`,
 * `preloadAll()` is a no-op and the AudioContext stays uninitialised
 * until/unless a script ever calls `play(...)` against an unknown id
 * (which just warns).
 */
export class AudioRegistry implements AudioAPI {
  private readonly pack: AssetPack;

  /** Lazily constructed on first `ensureContext()` call. */
  private ctx: AudioContext | null = null;

  /** Group gain nodes. Built alongside the context. */
  private masterGain: GainNode | null = null;
  private groupGains: Map<SoundGroup, GainNode> | null = null;

  /**
   * Decode-once cache. Value is either the decoded buffer or a
   * pending promise (so concurrent `play()` calls for the same lazy
   * sound don't kick off two `decodeAudioData` passes).
   */
  private readonly decoded = new Map<string, AudioBuffer | Promise<AudioBuffer>>();

  /** All currently-playing handles. Drained on `ended` / `stop*`. */
  private readonly liveHandles = new Set<HandleImpl>();

  /**
   * Maps sound id → its most-recent live handle. Powers `playReplace`
   * without scanning the whole live-set on every call.
   */
  private readonly lastById = new Map<string, HandleImpl>();

  /**
   * Optional procedural-audio recipe store — SL2 of `docs/plans/SOUND_LAB.md`.
   * When present, `startPlay` checks for a matching recipe id BEFORE
   * the manifest sound lookup (per §6.6 + §12 Q11 RESOLVED: shared
   * namespace, recipes first). Static + loop recipes resolve to an
   * `AudioBuffer` and flow through the same per-handle machinery as
   * manifest audio entries; instrument-mode recipes are NOT plumbed
   * through `play()` — callers use `api.proceduralAudio.playInstrument(...)`.
   */
  private recipeStore: RecipeStore | null = null;

  /**
   * One-shot user-gesture listener wiring. Browsers block
   * `AudioContext.resume()` until the user has clicked / pressed a
   * key. We attach `pointerdown` + `keydown` listeners on first
   * `ensureContext()` and remove them once the context is running.
   */
  private gestureListenerInstalled = false;

  /**
   * Live-bound `groupVolume` surface. Read pulls the current
   * `CONFIG.audio.<group>Volume` (so reads see Settings-slider
   * updates without registry callers having to round-trip); write
   * updates the gain node directly and mirrors the value back to
   * CONFIG so the next render of the Settings UI shows the new value.
   *
   * Reads work even before the AudioContext has been created — the
   * gain values are derived from CONFIG either way.
   */
  readonly groupVolume = {
    get: (group: SoundGroup): number => {
      return readGroupVolumeFromConfig(group);
    },
    set: (group: SoundGroup, v: number): void => {
      const clamped = Math.max(0, Math.min(1, v));
      writeGroupVolumeToConfig(group, clamped);
      this.applyGroupVolumeToGraph(group, clamped);
    },
  };

  constructor(pack: AssetPack) {
    this.pack = pack;
  }

  /**
   * Attach (or detach) the procedural-audio recipe store. The engine
   * wires this on boot AFTER `RecipeStore.loadFromPack(pack)` has
   * populated the recipe map — at that point `startPlay` can resolve
   * recipe ids first. Pass `null` to clear (used by pack-swap paths).
   */
  setRecipeStore(store: RecipeStore | null): void {
    this.recipeStore = store;
  }

  /**
   * Expose the live AudioContext + group gain node to the procedural-
   * audio surface (for instrument-mode voices, per SL2). Returns
   * `null` until the context has been bootstrapped (i.e. after a
   * user-gesture-driven `ensureContext()` call). Pack scripts that
   * need to trigger an instrument before any gesture will see this
   * as `null` and get a silent fallback.
   */
  liveBus(group: SoundGroup = "sfx"): { ctx: AudioContext; group: AudioNode } | null {
    if (!this.ctx) return null;
    const node = this.groupGains?.get(group) ?? this.masterGain;
    if (!node) return null;
    return { ctx: this.ctx, group: node };
  }

  /**
   * Bootstrap the AudioContext eagerly. Used by the procedural-audio
   * surface when a pack-script call needs a context up front (e.g.
   * `proceduralAudio.load(id)` so the bake's sampleRate is known).
   */
  bootstrapContext(): AudioContext {
    return this.ensureContext();
  }

  /**
   * Re-bind the active pack. Called when the engine swaps to a new
   * scene / pack (the scene may stay in the same pack, but
   * future-proofing for hot-reload). Stops every live handle and
   * clears the decode cache.
   */
  rebindPack(pack: AssetPack): void {
    this.stopAll();
    this.decoded.clear();
    (this as unknown as { pack: AssetPack }).pack = pack;
  }

  // ── Public API ──────────────────────────────────────────────────

  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  play(id: string, opts?: PlayOpts): AudioHandle {
    return this.startPlay(id, opts, /* forceLoop */ false, /* replace */ false);
  }

  playLoop(id: string, opts?: PlayOpts): AudioHandle {
    return this.startPlay(id, opts, /* forceLoop */ true, /* replace */ false);
  }

  playReplace(id: string, opts?: PlayOpts): AudioHandle {
    return this.startPlay(id, opts, /* forceLoop */ false, /* replace */ true);
  }

  stop(handle: AudioHandle): void {
    (handle as HandleImpl).stop(0);
  }

  stopAll(group?: SoundGroup): void {
    for (const handle of [...this.liveHandles]) {
      if (group && handle.group !== group) continue;
      handle.stop(0);
    }
  }

  /**
   * Decode every `manifest.audio` entry whose `preload` isn't
   * explicitly `false`. Called by the engine after pack scripts have
   * run (so the pack manifest is final). Returns immediately when the
   * pack has no `audio` field — no AudioContext is created.
   */
  async preloadAll(): Promise<void> {
    const sounds = this.pack.manifest.audio;
    if (!sounds) return;
    // Build the context up front so eager sounds decode against the
    // real context — `decodeAudioData` resamples to the context's
    // sample rate, so doing it later would re-decode.
    this.ensureContext();
    const tasks: Promise<unknown>[] = [];
    let bytes = 0;
    for (const [id, def] of Object.entries(sounds)) {
      if (!shouldPreload(def)) continue;
      tasks.push(
        this.loadBuffer(id, def)
          .then((buf) => {
            bytes += buf.length * buf.numberOfChannels * 4;
          })
          .catch((err) => {
            console.warn(`[audio] failed to preload "${id}" (${def.file}):`, err);
          }),
      );
    }
    if (tasks.length === 0) return;
    await Promise.all(tasks);
    console.log(
      `[two_5_d] audio: ${tasks.length} eager sound(s), ${(bytes / 1024 / 1024).toFixed(2)} MB decoded`,
    );
  }

  // ── Internals ───────────────────────────────────────────────────

  /**
   * Lazily create the AudioContext + group gain graph. Idempotent.
   * Installs the user-gesture resume listener on the first call.
   */
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window !== "undefined"
        ? (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)
        : undefined;
    if (!Ctor) {
      throw new Error("[audio] Web Audio API not available in this environment");
    }
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = readGroupVolumeFromConfig("master");
    master.connect(ctx.destination);
    const groups = new Map<SoundGroup, GainNode>();
    groups.set("master", master);
    for (const g of ["sfx", "music", "ambient", "voice"] as const) {
      const node = ctx.createGain();
      node.gain.value = readGroupVolumeFromConfig(g);
      node.connect(master);
      groups.set(g, node);
    }
    this.masterGain = master;
    this.groupGains = groups;
    this.installGestureListenerIfNeeded();
    return ctx;
  }

  /**
   * Attach a one-shot `pointerdown` / `keydown` listener that resumes
   * the AudioContext. Browsers require a user gesture before audio
   * can play; the listener auto-removes itself once the context is
   * `running`. Pack scripts that call `play()` from inside a click
   * handler hit the fast path — the context resumes synchronously.
   */
  private installGestureListenerIfNeeded(): void {
    if (this.gestureListenerInstalled) return;
    const ctx = this.ctx!;
    if (typeof window === "undefined") return;
    if (ctx.state === "running") return;
    this.gestureListenerInstalled = true;
    const tryResume = (): void => {
      ctx.resume().catch((err) => {
        console.warn("[audio] AudioContext.resume failed:", err);
      });
      if (ctx.state === "running") {
        window.removeEventListener("pointerdown", tryResume);
        window.removeEventListener("keydown", tryResume);
      }
    };
    window.addEventListener("pointerdown", tryResume);
    window.addEventListener("keydown", tryResume);
  }

  /**
   * Single entry point for `play` / `playLoop` / `playReplace`. Loads
   * the buffer (sync if already decoded, async otherwise), wires up
   * the per-play graph (source → perPlay → groupGain), and stashes
   * a handle for `stopAll`.
   */
  private startPlay(
    id: string,
    opts: PlayOpts | undefined,
    forceLoop: boolean,
    replace: boolean,
  ): AudioHandle {
    // Procedural recipe lookup first (SOUND_LAB.md §6.6 + §12 Q11).
    // Recipes share the namespace with `manifest.audio`; recipes win.
    const recipe = this.recipeStore?.get(id);
    const sounds = this.pack.manifest.audio;
    const def = sounds?.[id];

    if (!recipe && !def) {
      console.warn(
        `[audio] play("${id}"): no sound or recipe with that id`,
      );
      return makeInertHandle(id, (opts?.group ?? "sfx") as SoundGroup);
    }

    if (recipe && def) {
      // Collision warning — same shape as `manifest.audio` last-wins.
      // The recipe takes precedence; the manifest sound is shadowed.
      console.warn(
        `[audio] id "${id}" matches both a recipe and a manifest sound; using recipe`,
      );
    }

    // Recipes resolve their `group` from the recipe JSON; manifest
    // sounds from `def.group`. PlayOpts overrides either.
    const baseGroup: SoundGroup = recipe
      ? (recipe.group ?? "sfx")
      : (def!.group ?? "sfx");
    const group: SoundGroup = opts?.group ?? baseGroup;

    if (replace) {
      const prev = this.lastById.get(id);
      if (prev && prev.isPlaying()) prev.stop(0);
    }
    const ctx = this.ensureContext();
    const handle = new HandleImpl(id, group, this.liveHandles, this.lastById);
    this.liveHandles.add(handle);
    this.lastById.set(id, handle);

    // Synthesise a SoundDef for procedural recipes so the per-play
    // wiring (gain, loop, etc.) flows through the existing code path
    // unchanged. Instrument-mode recipes have no bake — log + drop
    // through (caller should use `api.proceduralAudio.playInstrument`).
    if (recipe) {
      if (recipe.mode === "instrument") {
        console.warn(
          `[audio] play("${id}") on an instrument-mode recipe; use api.proceduralAudio.playInstrument(...)`,
        );
        handle.markEnded();
        return handle;
      }
      const synthDef: SoundDef = {
        file: `recipe:${id}`,
        volume: 1,
        group: recipe.group ?? "sfx",
        loop: recipe.mode === "loop",
      };
      const cached = this.decoded.get(id);
      const promise = cached
        ? Promise.resolve(cached)
        : this.loadRecipeBuffer(id, ctx);
      Promise.resolve(promise)
        .then((buf) => {
          if (!buf) {
            handle.markEnded();
            return;
          }
          if (handle.cancelled) return;
          this.startSourceForHandle(handle, ctx, buf, synthDef, opts, forceLoop);
        })
        .catch((err) => {
          console.warn(`[audio] play("${id}") recipe render failed:`, err);
          handle.markEnded();
        });
      return handle;
    }

    const bufOrPromise = this.decoded.get(id) ?? this.loadBuffer(id, def!);
    Promise.resolve(bufOrPromise)
      .then((buf) => {
        if (handle.cancelled) return;
        this.startSourceForHandle(handle, ctx, buf, def!, opts, forceLoop);
      })
      .catch((err) => {
        console.warn(`[audio] play("${id}") decode failed:`, err);
        handle.markEnded();
      });
    return handle;
  }

  /**
   * Render-or-cache-hit a procedural recipe's buffer. Stashes the
   * promise in the existing decode cache so concurrent `play()` calls
   * for the same recipe share one render. Returns `null` on failure
   * (logged inside) so the caller can mark the handle ended.
   */
  private async loadRecipeBuffer(
    id: string,
    ctx: AudioContext,
  ): Promise<AudioBuffer | null> {
    const store = this.recipeStore;
    if (!store) return null;
    const existing = this.decoded.get(id);
    if (existing) return Promise.resolve(existing);
    const promise = store.loadBuffer(id, ctx).then((buf) => {
      if (buf) this.decoded.set(id, buf);
      return buf;
    });
    // Cast: the decode cache type covers AudioBuffer | Promise<AudioBuffer>.
    // A null resolution from the recipe store leaves the cache empty.
    this.decoded.set(id, promise as Promise<AudioBuffer>);
    const result = await promise;
    if (!result) {
      // Don't leave the failed promise in the cache — a retry should
      // reattempt the render.
      this.decoded.delete(id);
    }
    return result;
  }

  /**
   * Wire up a `BufferSource → perPlayGain → groupGain` fragment for
   * a handle whose buffer has just resolved. Splits out from
   * `startPlay` so the sync (cache-hit) + async (lazy decode) paths
   * share the same code.
   */
  private startSourceForHandle(
    handle: HandleImpl,
    ctx: AudioContext,
    buf: AudioBuffer,
    def: SoundDef,
    opts: PlayOpts | undefined,
    forceLoop: boolean,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts?.pitch !== undefined) src.playbackRate.value = opts.pitch;
    if (opts?.detune !== undefined) src.detune.value = opts.detune;
    src.loop = forceLoop || (def.loop ?? false);

    const perPlay = ctx.createGain();
    perPlay.gain.value = (def.volume ?? 1) * (opts?.volume ?? 1);

    const groupGain = this.groupGains?.get(handle.group);
    if (!groupGain) {
      console.warn(`[audio] unknown group "${handle.group}"; routing to master`);
    }
    src.connect(perPlay);
    perPlay.connect(groupGain ?? this.masterGain!);

    handle.bind(src, perPlay, ctx);
    src.onended = () => handle.markEnded();
    src.start();
  }

  /**
   * Fetch + decode a sound. Stashes the in-flight promise so
   * concurrent `play()` calls share one decode.
   */
  private loadBuffer(id: string, def: SoundDef): Promise<AudioBuffer> {
    const existing = this.decoded.get(id);
    if (existing) return Promise.resolve(existing);
    const ctx = this.ensureContext();
    const promise = (async () => {
      const bytes = await this.pack.binaryBlob(def.file);
      const buf = await ctx.decodeAudioData(bytes);
      this.decoded.set(id, buf);
      return buf;
    })();
    this.decoded.set(id, promise);
    return promise;
  }

  /**
   * Mirror a `groupVolume.set(...)` call into the active gain node
   * if the graph has been built. No-op when audio is still dormant —
   * the next `ensureContext()` reads the latest CONFIG value.
   */
  private applyGroupVolumeToGraph(group: SoundGroup, v: number): void {
    if (!this.groupGains) return;
    const node = this.groupGains.get(group);
    if (!node) return;
    node.gain.value = v;
  }

  /**
   * Push the latest CONFIG audio values into the live gain nodes.
   * Called by the engine each frame (cheap — five assignments) so
   * Settings-slider updates reflect even when the writer is the
   * settings JSON import path rather than `groupVolume.set`.
   */
  syncFromConfig(): void {
    if (!this.groupGains) return;
    for (const g of ["master", "sfx", "music", "ambient", "voice"] as const) {
      const node = this.groupGains.get(g);
      if (!node) continue;
      const target = readGroupVolumeFromConfig(g);
      if (node.gain.value !== target) node.gain.value = target;
    }
  }
}

/**
 * Per-playback handle. Lifecycle:
 *   construct → bind() → eventually markEnded() (BufferSource ended
 *   OR explicit stop()) → removed from the live set.
 *
 * Calls before `bind()` (the buffer is still decoding) buffer into the
 * `cancelled` flag — once decode completes the registry checks the
 * flag and skips wiring up the source if the caller has already
 * stopped this handle.
 */
class HandleImpl implements AudioHandle {
  readonly id: string;
  readonly group: SoundGroup;
  cancelled = false;

  private src: AudioBufferSourceNode | null = null;
  private perPlay: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private ended = false;

  constructor(
    id: string,
    group: SoundGroup,
    private readonly liveSet: Set<HandleImpl>,
    private readonly lastBy: Map<string, HandleImpl>,
  ) {
    this.id = id;
    this.group = group;
  }

  bind(src: AudioBufferSourceNode, perPlay: GainNode, ctx: AudioContext): void {
    this.src = src;
    this.perPlay = perPlay;
    this.ctx = ctx;
  }

  isPlaying(): boolean {
    return !this.ended && !this.cancelled;
  }

  setVolume(v: number): void {
    if (this.ended || !this.perPlay) return;
    this.perPlay.gain.value = v;
  }

  setPitch(p: number): void {
    if (this.ended || !this.src) return;
    this.src.playbackRate.value = p;
  }

  stop(seconds = 0): void {
    if (this.ended) return;
    this.cancelled = true;
    if (!this.src || !this.perPlay || !this.ctx) {
      // Bind hasn't happened yet — the cancelled flag will short-
      // circuit it. Move straight to ended bookkeeping.
      this.markEnded();
      return;
    }
    if (seconds > 0) {
      const now = this.ctx.currentTime;
      this.perPlay.gain.cancelScheduledValues(now);
      this.perPlay.gain.setValueAtTime(this.perPlay.gain.value, now);
      this.perPlay.gain.linearRampToValueAtTime(0, now + seconds);
      try {
        this.src.stop(now + seconds);
      } catch {
        /* already stopped */
      }
    } else {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
      this.markEnded();
    }
  }

  markEnded(): void {
    if (this.ended) return;
    this.ended = true;
    this.liveSet.delete(this);
    if (this.lastBy.get(this.id) === this) this.lastBy.delete(this.id);
  }
}

/**
 * Sentinel handle returned when `play(id)` references a missing sound.
 * Lets caller code stay simple (`api.audio.play(...).stop()` is always
 * safe) without forcing a null check at every call site.
 */
function makeInertHandle(id: string, group: SoundGroup): AudioHandle {
  return {
    id,
    group,
    isPlaying: () => false,
    setVolume: () => {},
    setPitch: () => {},
    stop: () => {},
  };
}

/**
 * Default eager-preload rule per AUDIO.md §5.5: sfx + voice eager,
 * music + ambient lazy. The pack can override per sound via
 * `preload: true` / `preload: false`.
 */
function shouldPreload(def: SoundDef): boolean {
  if (def.preload !== undefined) return def.preload;
  const group = def.group ?? "sfx";
  return group === "sfx" || group === "voice";
}

function readGroupVolumeFromConfig(group: SoundGroup): number {
  const a = CONFIG.audio;
  switch (group) {
    case "master": return clamp01(a.masterVolume);
    case "sfx": return clamp01(a.sfxVolume);
    case "music": return clamp01(a.musicVolume);
    case "ambient": return clamp01(a.ambientVolume);
    case "voice": return clamp01(a.voiceVolume);
  }
}

function writeGroupVolumeToConfig(group: SoundGroup, v: number): void {
  // Mutating CONFIG directly is the same approach the existing engine
  // takes for live-updated fields (see `Settings.ts` flow via
  // `applyConfigOverride`); the registry's `groupVolume.set` is the
  // fast path for slider drag, and the persistence call rides on top
  // via the pack-side settings system that ALSO mutates this field
  // through `applyConfigOverride`.
  const a = CONFIG.audio;
  switch (group) {
    case "master": a.masterVolume = v; return;
    case "sfx": a.sfxVolume = v; return;
    case "music": a.musicVolume = v; return;
    case "ambient": a.ambientVolume = v; return;
    case "voice": a.voiceVolume = v; return;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
