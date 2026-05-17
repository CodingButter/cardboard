import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Input, Label } from "../components/ui";
import { ALLOWED_ANGLES } from "../lib/animationBaker";
import {
  applyFbxRenderConfig,
  buildFbxScene,
  defaultFbxBakeConfig,
  DEFAULT_FBX_RENDER_CONFIG,
  fbxConfigToMeta,
  planFbxBake,
  buildFbxSpriteState,
  type FbxBakeConfig,
  type FbxAnimConfig,
  type FbxRenderConfig,
  type LoadedFbx,
} from "../lib/fbxBaker";
import {
  EditorProjectStore,
  type SpriteSourceMeta,
} from "../lib/EditorProjectStore";
import { saveBakedSprite } from "../lib/animationBaker";
import type { SpriteAngleCount } from "@two_5_d/engine/AssetPack";
import { cn } from "../lib/cn";

/**
 * AE2 — Path B FBX importer. Surfaced as a modal-overlay from the
 * AnimationEditor's left rail "+ New" submenu. Owns the lazy-load of
 * `three` + `FBXLoader` (the editor's main bundle stays free of
 * Three.js for users who never bake an FBX sprite).
 *
 * Layout (per ANIMATION_EDITOR.md §6 visualization):
 *   ┌─ Animations rail ─┬─ Three.js viewport ─┬─ Config panel ─┐
 *   │  clip list +      │  live preview +     │  angle/frames  │
 *   │  rename + frames  │  orbit controls +   │  cell-size +   │
 *   │                   │  rotation knobs     │  Bake button   │
 *   └───────────────────┴─────────────────────┴────────────────┘
 *
 * The DOM-bound parts (Three.js scene, viewport canvas, AnimationMixer
 * scrubber) live here. The pure logic (plan, manifest writer) lives
 * in `lib/fbxBaker.ts` so the smoke test can exercise it without a
 * WebGL context.
 */

export interface FbxImporterProps {
  projectId: string;
  /** Pre-loaded FBX bytes (so the modal can re-open from IDB). */
  initialBlob?: Blob;
  /** Pre-existing config to restore (re-edit mode). */
  initialConfig?: FbxBakeConfig;
  /** Existing sprite id (re-edit mode) — pre-fills the spriteId input. */
  initialSpriteId?: string;
  onCancel: () => void;
  onBaked: (spriteId: string) => void;
}

// Re-export of `three` plus the FBXLoader module — dynamic-imported so
// it ends up in its own chunk under Bun's bundler.
interface ThreeBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: typeof import("three");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  FBXLoader: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OrbitControls: any;
}

async function loadThreeBundle(): Promise<ThreeBundle> {
  // The two `import("...")` calls here run in parallel and each
  // becomes its own deferred chunk under `bun build --splitting`.
  // Three.js (~600 KB) + FBXLoader (~80 KB) load once on first
  // invocation and are cached by the browser thereafter.
  const [THREE, fbxMod, orbitMod] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/FBXLoader.js"),
    import("three/examples/jsm/controls/OrbitControls.js"),
  ]);
  return {
    THREE,
    FBXLoader: (fbxMod as { FBXLoader: unknown }).FBXLoader,
    OrbitControls: (orbitMod as { OrbitControls: unknown }).OrbitControls,
  };
}

interface PreviewState {
  bundle: ThreeBundle;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scene: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  camera: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controls: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mixer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentAction: any | null;
  clips: LoadedFbx["clips"];
  rafId: number;
  /** Refs to lights so render-config sliders can mutate live. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ambient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  key: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fill: any;
}

export function FbxImporter({
  projectId,
  initialBlob,
  initialConfig,
  initialSpriteId,
  onCancel,
  onBaked,
}: FbxImporterProps) {
  // ── Source FBX state ───────────────────────────────────────────
  const [fbxBlob, setFbxBlob] = useState<Blob | null>(initialBlob ?? null);
  const [spriteId, setSpriteId] = useState(initialSpriteId ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);

  // ── Live bake config ───────────────────────────────────────────
  const [config, setConfig] = useState<FbxBakeConfig | null>(
    initialConfig ?? null,
  );

  // ── Viewport scrubber state ────────────────────────────────────
  const [activeClipIdx, setActiveClipIdx] = useState(0);
  const [scrubT, setScrubT] = useState(0); // 0..1 within current clip
  const [autoPlay, setAutoPlay] = useState(true);

  // ── Bake state ─────────────────────────────────────────────────
  const [baking, setBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeTotal, setBakeTotal] = useState(0);
  const [bakeError, setBakeError] = useState<string | null>(null);

  // ── Three.js + viewport refs ──────────────────────────────────
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<PreviewState | null>(null);

  // ─────────────────────────────────────────────────────────────
  //  FBX load + scene init
  // ─────────────────────────────────────────────────────────────

  const initScene = useCallback(
    async (blob: Blob) => {
      setLoadingMsg("Loading three.js (~600 KB)…");
      let bundle: ThreeBundle;
      try {
        bundle = await loadThreeBundle();
      } catch (err) {
        setLoadError(`Failed to load three.js: ${(err as Error).message}`);
        setLoadingMsg(null);
        return;
      }
      setLoadingMsg("Parsing FBX…");
      const { THREE, FBXLoader, OrbitControls } = bundle;

      let group;
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const loader = new FBXLoader();
        group = loader.parse(arrayBuffer, "");
      } catch (err) {
        setLoadError(`Failed to parse FBX: ${(err as Error).message}`);
        setLoadingMsg(null);
        return;
      }

      // Build the live-preview scene via the SHARED builder used by
      // `bakeFbxOffscreen` — guarantees the spritesheet output matches
      // the viewport pixel-for-pixel (modulo camera).
      //
      // Note: the preview always overrides the scene's clear color to
      // a dark zinc tone so the viewport doesn't show through; the
      // builder uses the configured background (transparent → null) so
      // the offscreen bake gets the alpha behaviour the author chose.
      const initialRender =
        initialConfig?.render ?? DEFAULT_FBX_RENDER_CONFIG;
      const sceneRefs = buildFbxScene(THREE, group, initialRender);
      const scene = sceneRefs.scene;
      if (initialRender.background.kind === "transparent") {
        scene.background = new THREE.Color(0x18181b);
      }

      // Fit camera.
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
      const radius = maxDim * 2.5;

      const viewportEl = viewportRef.current!;
      const w = viewportEl.clientWidth || 480;
      const h = viewportEl.clientHeight || 320;
      const aspect = w / h;
      const frustum = maxDim * 1.4;
      const camera = new THREE.OrthographicCamera(
        (-frustum * aspect) / 2,
        (frustum * aspect) / 2,
        frustum / 2,
        -frustum / 2,
        0.1,
        radius * 4,
      );
      camera.position.set(
        center.x + radius * 0.7,
        center.y + radius * 0.4,
        center.z + radius * 0.7,
      );
      camera.lookAt(center);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (initialRender.shadow) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      viewportEl.innerHTML = "";
      viewportEl.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = true;
      controls.update();

      // Extract clips + create mixer.
      const fbxAny = group as { animations?: unknown[] };
      const animations = (fbxAny.animations ?? []) as Array<{
        name: string;
        duration: number;
      }>;
      const clips: LoadedFbx["clips"] = animations.map((c) => ({
        name: c.name,
        duration: c.duration,
        clip: c,
      }));

      const mixer = new THREE.AnimationMixer(group);
      let currentAction: ReturnType<typeof mixer.clipAction> | null = null;
      if (animations.length > 0) {
        currentAction = mixer.clipAction(
          animations[0] as unknown as InstanceType<
            typeof THREE.AnimationClip
          >,
        );
        currentAction.play();
      }

      // Synthesize initial config if not provided.
      if (!initialConfig) {
        const sid =
          initialSpriteId ||
          spriteId ||
          deriveSpriteIdFromBlob(blob) ||
          "sprite";
        setSpriteId(sid);
        setConfig(defaultFbxBakeConfig(sid, clips));
      }

      // Apply author rotation if config preloaded.
      if (initialConfig) {
        group.rotation.set(
          initialConfig.forwardRotation.x,
          initialConfig.forwardRotation.y,
          initialConfig.forwardRotation.z,
        );
      }

      const state: PreviewState = {
        bundle,
        scene,
        camera,
        renderer,
        controls,
        root: group,
        mixer,
        currentAction,
        clips,
        rafId: 0,
        ambient: sceneRefs.ambient,
        key: sceneRefs.key,
        fill: sceneRefs.fill,
      };
      previewRef.current = state;

      // Render loop — drives orbit damping + animation playback.
      let last = performance.now();
      const loop = () => {
        const s = previewRef.current;
        if (!s) return;
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        s.controls.update();
        if (autoPlay && s.currentAction) {
          s.mixer.update(dt);
        }
        s.renderer.render(s.scene, s.camera);
        s.rafId = requestAnimationFrame(loop);
      };
      state.rafId = requestAnimationFrame(loop);

      setLoadingMsg(null);
    },
    [autoPlay, initialConfig, initialSpriteId, spriteId],
  );

  // Re-init scene whenever the blob changes.
  useEffect(() => {
    if (!fbxBlob || !viewportRef.current) return;
    initScene(fbxBlob).catch((err) => {
      setLoadError(`Init failed: ${(err as Error).message}`);
    });
    return () => {
      const s = previewRef.current;
      if (s) {
        cancelAnimationFrame(s.rafId);
        s.renderer.dispose();
        s.controls.dispose();
        previewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fbxBlob]);

  // ─────────────────────────────────────────────────────────────
  //  React → Three.js bridges (rotation, active clip, scrub)
  // ─────────────────────────────────────────────────────────────

  // Sync forward rotation to the model.
  useEffect(() => {
    const s = previewRef.current;
    if (!s || !config) return;
    s.root.rotation.set(
      config.forwardRotation.x,
      config.forwardRotation.y,
      config.forwardRotation.z,
    );
  }, [config?.forwardRotation.x, config?.forwardRotation.y, config?.forwardRotation.z, config]);

  // Sync active clip.
  useEffect(() => {
    const s = previewRef.current;
    if (!s || !config) return;
    const anim = config.animations[activeClipIdx];
    if (!anim) return;
    const clipDesc = s.clips.find((c) => c.name === anim.fbxClipName);
    if (!clipDesc) return;
    s.mixer.stopAllAction();
    s.currentAction = s.mixer.clipAction(clipDesc.clip);
    s.currentAction.reset();
    s.currentAction.play();
  }, [activeClipIdx, config]);

  // Manual scrub when paused.
  useEffect(() => {
    const s = previewRef.current;
    if (!s || autoPlay || !config) return;
    const anim = config.animations[activeClipIdx];
    if (!anim) return;
    s.mixer.setTime(scrubT * anim.clipDurationSec);
  }, [scrubT, autoPlay, activeClipIdx, config]);

  // Live-apply render config (lighting, tone, background, shadow) so
  // dragging any slider in the Render panel updates the viewport on
  // the next frame. The bake uses the same render config — output =
  // what you see.
  useEffect(() => {
    const s = previewRef.current;
    if (!s || !config) return;
    applyFbxRenderConfig(
      s.bundle.THREE,
      { scene: s.scene, ambient: s.ambient, key: s.key, fill: s.fill },
      s.root,
      config.render,
    );
    // Preview keeps a dark zinc background when the bake is configured
    // for transparent so the viewport isn't pure black; the offscreen
    // bake honours the actual transparent setting via the renderer's
    // clear color.
    if (config.render.background.kind === "transparent") {
      s.scene.background = new s.bundle.THREE.Color(0x18181b);
    }
    s.renderer.shadowMap.enabled = config.render.shadow;
  }, [
    config?.render.ambient,
    config?.render.keyIntensity,
    config?.render.keyDirection,
    config?.render.fillIntensity,
    config?.render.tone,
    config?.render.shadow,
    config?.render.background.kind,
    config?.render.background.kind === "solid"
      ? config.render.background.color
      : null,
    config,
  ]);

  // Live-apply render config (lighting, tone, background, shadow) so
  // dragging any slider in the Render panel updates the viewport on
  // the next frame. The bake uses the same render config — output =
  // what you see.
  useEffect(() => {
    const s = previewRef.current;
    if (!s || !config) return;
    applyFbxRenderConfig(
      s.bundle.THREE,
      { scene: s.scene, ambient: s.ambient, key: s.key, fill: s.fill },
      s.root,
      config.render,
    );
    // Preview keeps a dark zinc background when the bake is configured
    // for transparent so the viewport isn't pure black; the offscreen
    // bake honours the actual transparent setting via the renderer's
    // clear color.
    if (config.render.background.kind === "transparent") {
      s.scene.background = new s.bundle.THREE.Color(0x18181b);
    }
    s.renderer.shadowMap.enabled = config.render.shadow;
  }, [
    config?.render.ambient,
    config?.render.keyIntensity,
    config?.render.keyDirection,
    config?.render.fillIntensity,
    config?.render.tone,
    config?.render.shadow,
    config?.render.background.kind,
    config?.render.background.kind === "solid"
      ? config.render.background.color
      : null,
    config,
  ]);

  // ─────────────────────────────────────────────────────────────
  //  File picker (modal opened without a blob)
  // ─────────────────────────────────────────────────────────────

  const handlePickFile = useCallback(
    async (file: File) => {
      setLoadError(null);
      setFbxBlob(file);
      if (!spriteId) {
        const derived = deriveSpriteIdFromFile(file);
        if (derived) setSpriteId(derived);
      }
    },
    [spriteId],
  );

  // ─────────────────────────────────────────────────────────────
  //  Bake button — runs the offscreen render loop
  // ─────────────────────────────────────────────────────────────

  const plan = useMemo(() => (config ? planFbxBake(config) : null), [config]);
  const bakeTimeEstSec = useMemo(() => {
    if (!plan) return 0;
    // ~6 ms per capture on mid-range hardware (1 render + readback +
    // composite). Add 200 ms FBX-init overhead.
    return Math.max(0.5, plan.captures.length * 0.006 + 0.2);
  }, [plan]);

  const handleBake = useCallback(async () => {
    if (!fbxBlob || !config) return;
    if (!/^[a-z0-9_]+$/.test(spriteId)) {
      setBakeError(
        "Sprite id must be lowercase letters, digits, or underscores.",
      );
      return;
    }
    const s = previewRef.current;
    if (!s) {
      setBakeError("Three.js scene not initialised.");
      return;
    }
    setBaking(true);
    setBakeError(null);
    setBakeProgress(0);
    try {
      // Persist the source FBX to IDB under `_source/<id>.fbx` so
      // re-opening the sprite restores the bake without re-upload.
      const sourcePath = `_source/${spriteId}.fbx`;
      await EditorProjectStore.saveAsset(projectId, sourcePath, fbxBlob);

      // Run the bake — dynamic-imports three, builds a fresh scene
      // for offscreen capture (separate from the live preview), and
      // produces the canonical PNG blob.
      const { bakeFbxOffscreen } = await import("../lib/fbxBaker");
      // Fresh load of the FBX for the bake so the live preview's
      // mixers + rotations aren't disturbed. The offscreen bake takes
      // ownership of its own copy.
      const bakeBundle = await loadThreeBundle();
      const arrayBuffer = await fbxBlob.arrayBuffer();
      const bakeLoader = new bakeBundle.FBXLoader();
      const bakeGroup = bakeLoader.parse(arrayBuffer, "");
      const bakeAnims = (bakeGroup as { animations?: unknown[] }).animations ?? [];
      const bakeClips: LoadedFbx["clips"] = (bakeAnims as Array<{
        name: string;
        duration: number;
      }>).map((c) => ({
        name: c.name,
        duration: c.duration,
        clip: c as unknown,
      }));
      setBakeTotal(plan?.captures.length ?? 0);
      const { png, plan: outPlan } = await bakeFbxOffscreen(
        { group: bakeGroup, clips: bakeClips },
        config,
        (done, total) => {
          setBakeProgress(done);
          setBakeTotal(total);
        },
      );

      // Build the editor state through the shared path so the manifest
      // writer is identical to AE1's.
      const state = buildFbxSpriteState(config, outPlan, sourcePath);
      const { manifest } = await saveBakedSprite(projectId, state, png);

      // Persist the FBX-specific meta block so re-open restores config.
      const meta: SpriteSourceMeta = {
        projectId,
        spriteId,
        kind: "fbx",
        sourcePath,
        grid: {
          frameWidth: config.cellSize,
          frameHeight: config.cellSize,
          cols: outPlan.outCols,
          rows: outPlan.outRows,
          padding: 0,
          offsetX: 0,
          offsetY: 0,
        },
        angles: config.angleCount,
        cellMappings: state.cellMappings,
        animationsMeta: state.animationsMeta,
        animationOrder: state.animationOrder,
        bakedAt: Date.now(),
        fbx: fbxConfigToMeta(config),
      };
      await EditorProjectStore.saveSpriteSource(projectId, spriteId, meta);

      // Manifest is already updated by `saveBakedSprite`.
      void manifest;
      onBaked(spriteId);
    } catch (err) {
      setBakeError((err as Error).message);
    } finally {
      setBaking(false);
    }
  }, [fbxBlob, config, spriteId, projectId, plan, onBaked]);

  // ─────────────────────────────────────────────────────────────
  //  Config mutators
  // ─────────────────────────────────────────────────────────────

  const updateConfig = useCallback(
    (mut: (c: FbxBakeConfig) => FbxBakeConfig) => {
      setConfig((c) => (c ? mut(c) : c));
    },
    [],
  );

  const updateAnim = useCallback(
    (idx: number, mut: (a: FbxAnimConfig) => FbxAnimConfig) => {
      updateConfig((c) => ({
        ...c,
        animations: c.animations.map((a, i) => (i === idx ? mut(a) : a)),
      }));
    },
    [updateConfig],
  );

  // ─────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-[95vw] h-[90vh] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              FBX → Spritesheet (Path B)
            </h2>
            <p className="text-xs text-zinc-500">
              Drop a rigged FBX; pick angles + frames; bake a Doom-style
              multi-angle sheet.
            </p>
          </div>
          <Button variant="ghost" onClick={onCancel}>
            Close
          </Button>
        </header>

        {/* No FBX yet — file-picker state */}
        {!fbxBlob ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="space-y-3 max-w-md w-full px-6">
              <Label htmlFor="fbx-file">FBX file</Label>
              <input
                id="fbx-file"
                type="file"
                accept=".fbx,application/octet-stream"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePickFile(f);
                }}
                className="block w-full text-xs text-zinc-300"
              />
              <p className="text-xs text-zinc-500">
                Mixamo / Sketchfab / Asset Store FBXs supported. The
                file stays in IDB under <code>_source/&lt;id&gt;.fbx</code>{" "}
                and isn't shipped in your <code>.apg</code> by default.
              </p>
              {loadError ? (
                <p className="text-xs text-red-300">{loadError}</p>
              ) : null}
            </div>
          </div>
        ) : (
          // Loaded — main 3-panel layout
          <div className="flex-1 flex min-h-0">
            {/* Left rail: animations list */}
            <aside className="w-60 border-r border-zinc-800 bg-zinc-950/60 overflow-auto">
              <div className="px-3 py-2 border-b border-zinc-800">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Animations
                </p>
              </div>
              {config?.animations.length === 0 ? (
                <p className="px-3 py-3 text-xs text-zinc-500">
                  FBX has no clips. Bake will produce a static-pose
                  sheet (one frame per angle).
                </p>
              ) : null}
              <ul className="divide-y divide-zinc-800">
                {config?.animations.map((anim, idx) => (
                  <li
                    key={anim.fbxClipName + idx}
                    onClick={() => setActiveClipIdx(idx)}
                    className={cn(
                      "px-3 py-2 cursor-pointer hover:bg-zinc-800/40",
                      activeClipIdx === idx && "bg-zinc-800/60",
                    )}
                  >
                    <div className="text-xs text-zinc-400 truncate">
                      {anim.fbxClipName}
                    </div>
                    <div className="text-sm text-zinc-100 truncate">
                      → {anim.outputName}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {anim.frameCount}f · {anim.clipDurationSec.toFixed(2)}s
                    </div>
                  </li>
                ))}
              </ul>
            </aside>

            {/* Center: Three.js viewport */}
            <section className="flex-1 flex flex-col bg-zinc-950/40 min-w-0">
              <div className="border-b border-zinc-800 px-3 py-2 flex items-center gap-2 text-xs text-zinc-400">
                {loadingMsg ? (
                  <span className="text-amber-300">{loadingMsg}</span>
                ) : config && config.animations[activeClipIdx] ? (
                  <>
                    <span>
                      Playing:{" "}
                      <strong className="text-zinc-200">
                        {config.animations[activeClipIdx]!.fbxClipName}
                      </strong>
                    </span>
                    <span>·</span>
                    <span>
                      Frames: {config.animations[activeClipIdx]!.frameCount}
                    </span>
                  </>
                ) : (
                  <span>No active clip</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAutoPlay((p) => !p)}
                  >
                    {autoPlay ? "Pause" : "Play"}
                  </Button>
                </div>
              </div>
              <div ref={viewportRef} className="flex-1 min-h-0 relative" />
              <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
                {!autoPlay && config && config.animations[activeClipIdx] ? (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={scrubT}
                    onChange={(e) => setScrubT(Number(e.target.value))}
                    className="w-full"
                  />
                ) : null}
                <p className="text-[11px] text-zinc-500">
                  Drag to orbit · scroll to zoom · use rotation knobs on
                  the right to align "forward" with the camera angle 0
                  direction.
                </p>
              </div>
            </section>

            {/* Right: config panel */}
            <aside className="w-96 border-l border-zinc-800 bg-zinc-950/60 overflow-auto">
              {config ? (
                <div className="p-4 space-y-4">
                  {/* Sprite id */}
                  <section>
                    <Label htmlFor="fbx-sprite-id">Sprite id</Label>
                    <Input
                      id="fbx-sprite-id"
                      value={spriteId}
                      disabled={!!initialSpriteId}
                      onChange={(e) => setSpriteId(e.target.value)}
                      placeholder="player"
                      className="mt-1"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Manifest key + output filename stem.
                    </p>
                  </section>

                  {/* Output dims */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Output
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="cellSize"
                        value={config.cellSize}
                        min={8}
                        max={512}
                        onChange={(v) =>
                          updateConfig((c) => ({ ...c, cellSize: v }))
                        }
                      />
                      <label className="flex flex-col text-xs">
                        <span className="text-zinc-500">angles</span>
                        <select
                          value={config.angleCount}
                          onChange={(e) =>
                            updateConfig((c) => ({
                              ...c,
                              angleCount: Number(
                                e.target.value,
                              ) as SpriteAngleCount,
                            }))
                          }
                          className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2 mt-0.5 text-zinc-100"
                        >
                          {ALLOWED_ANGLES.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {plan ? (
                      <p className="text-xs text-zinc-500 mt-1">
                        Sheet: {plan.outCols}×{plan.outRows} cells ={" "}
                        {plan.outWidth}×{plan.outHeight}px · {" "}
                        {plan.captures.length} renders · est{" "}
                        {bakeTimeEstSec.toFixed(1)}s
                      </p>
                    ) : null}
                  </section>

                  {/* Forward rotation */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Model rotation (rad)
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      <Field
                        label="X"
                        value={config.forwardRotation.x}
                        step={0.05}
                        onChange={(v) =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { ...c.forwardRotation, x: v },
                          }))
                        }
                      />
                      <Field
                        label="Y"
                        value={config.forwardRotation.y}
                        step={0.05}
                        onChange={(v) =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { ...c.forwardRotation, y: v },
                          }))
                        }
                      />
                      <Field
                        label="Z"
                        value={config.forwardRotation.z}
                        step={0.05}
                        onChange={(v) =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { ...c.forwardRotation, z: v },
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { x: 0, y: 0, z: 0 },
                          }))
                        }
                      >
                        +Z
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { x: 0, y: Math.PI / 2, z: 0 },
                          }))
                        }
                      >
                        +X
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateConfig((c) => ({
                            ...c,
                            forwardRotation: { x: 0, y: Math.PI, z: 0 },
                          }))
                        }
                      >
                        −Z
                      </Button>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Rotate the model so its intuitive "front" faces
                      the live camera at the default orbit. Angle 0 of
                      the bake captures this direction.
                    </p>
                  </section>

                  {/* Camera elevation */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Camera elevation
                    </h3>
                    <input
                      type="range"
                      min={-Math.PI / 4}
                      max={Math.PI / 4}
                      step={0.02}
                      value={config.cameraElevation}
                      onChange={(e) =>
                        updateConfig((c) => ({
                          ...c,
                          cameraElevation: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      {((config.cameraElevation * 180) / Math.PI).toFixed(1)}°
                      above horizon. Default 8° (Doom 3/4-view).
                    </p>
                  </section>

                  {/* Render controls — drives both preview + bake. */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Render
                    </h3>
                    <div className="space-y-3">
                      {/* Ambient intensity */}
                      <SliderField
                        label="Ambient"
                        value={config.render.ambient}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({ ...r, ambient: v }))
                        }
                      />
                      {/* Key intensity */}
                      <SliderField
                        label="Key intensity"
                        value={config.render.keyIntensity}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({
                            ...r,
                            keyIntensity: v,
                          }))
                        }
                      />
                      {/* Key direction preset */}
                      <div>
                        <span className="text-zinc-500 text-xs">
                          Key direction
                        </span>
                        <div className="grid grid-cols-4 gap-1 mt-1">
                          {(["front", "side", "back", "overhead"] as const).map(
                            (dir) => (
                              <Button
                                key={dir}
                                variant={
                                  config.render.keyDirection === dir
                                    ? "primary"
                                    : "ghost"
                                }
                                size="sm"
                                onClick={() =>
                                  updateRender(updateConfig, (r) => ({
                                    ...r,
                                    keyDirection: dir,
                                  }))
                                }
                              >
                                {dir}
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                      {/* Fill intensity */}
                      <SliderField
                        label="Fill"
                        value={config.render.fillIntensity}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({
                            ...r,
                            fillIntensity: v,
                          }))
                        }
                      />
                      {/* Background */}
                      <div>
                        <span className="text-zinc-500 text-xs">
                          Background
                        </span>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          <Button
                            variant={
                              config.render.background.kind === "transparent"
                                ? "primary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: { kind: "transparent" },
                              }))
                            }
                          >
                            transparent
                          </Button>
                          <Button
                            variant={
                              config.render.background.kind === "solid"
                                ? "primary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: {
                                  kind: "solid",
                                  color:
                                    r.background.kind === "solid"
                                      ? r.background.color
                                      : "#18181b",
                                },
                              }))
                            }
                          >
                            solid
                          </Button>
                        </div>
                        {config.render.background.kind === "solid" ? (
                          <input
                            type="color"
                            value={config.render.background.color}
                            onChange={(e) =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: {
                                  kind: "solid",
                                  color: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 h-6 w-full bg-transparent border border-zinc-700 rounded"
                          />
                        ) : null}
                      </div>
                      {/* Tone */}
                      <div>
                        <span className="text-zinc-500 text-xs">Tone</span>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          {(["lit", "flat"] as const).map((t) => (
                            <Button
                              key={t}
                              variant={
                                config.render.tone === t ? "primary" : "ghost"
                              }
                              size="sm"
                              onClick={() =>
                                updateRender(updateConfig, (r) => ({
                                  ...r,
                                  tone: t,
                                }))
                              }
                            >
                              {t}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-1">
                          "Lit" uses the FBX materials with phong/standard
                          shading. "Flat" swaps to MeshBasicMaterial for a
                          retro unlit look.
                        </p>
                      </div>
                      {/* Shadow */}
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={config.render.shadow}
                          onChange={(e) =>
                            updateRender(updateConfig, (r) => ({
                              ...r,
                              shadow: e.target.checked,
                            }))
                          }
                        />
                        <span className="text-zinc-300">Cast / receive shadows</span>
                      </label>
                    </div>
                  </section>

                  {/* Render controls — drives both preview + bake. */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Render
                    </h3>
                    <div className="space-y-3">
                      {/* Ambient intensity */}
                      <SliderField
                        label="Ambient"
                        value={config.render.ambient}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({ ...r, ambient: v }))
                        }
                      />
                      {/* Key intensity */}
                      <SliderField
                        label="Key intensity"
                        value={config.render.keyIntensity}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({
                            ...r,
                            keyIntensity: v,
                          }))
                        }
                      />
                      {/* Key direction preset */}
                      <div>
                        <span className="text-zinc-500 text-xs">
                          Key direction
                        </span>
                        <div className="grid grid-cols-4 gap-1 mt-1">
                          {(["front", "side", "back", "overhead"] as const).map(
                            (dir) => (
                              <Button
                                key={dir}
                                variant={
                                  config.render.keyDirection === dir
                                    ? "primary"
                                    : "ghost"
                                }
                                size="sm"
                                onClick={() =>
                                  updateRender(updateConfig, (r) => ({
                                    ...r,
                                    keyDirection: dir,
                                  }))
                                }
                              >
                                {dir}
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                      {/* Fill intensity */}
                      <SliderField
                        label="Fill"
                        value={config.render.fillIntensity}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(v) =>
                          updateRender(updateConfig, (r) => ({
                            ...r,
                            fillIntensity: v,
                          }))
                        }
                      />
                      {/* Background */}
                      <div>
                        <span className="text-zinc-500 text-xs">
                          Background
                        </span>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          <Button
                            variant={
                              config.render.background.kind === "transparent"
                                ? "primary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: { kind: "transparent" },
                              }))
                            }
                          >
                            transparent
                          </Button>
                          <Button
                            variant={
                              config.render.background.kind === "solid"
                                ? "primary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: {
                                  kind: "solid",
                                  color:
                                    r.background.kind === "solid"
                                      ? r.background.color
                                      : "#18181b",
                                },
                              }))
                            }
                          >
                            solid
                          </Button>
                        </div>
                        {config.render.background.kind === "solid" ? (
                          <input
                            type="color"
                            value={config.render.background.color}
                            onChange={(e) =>
                              updateRender(updateConfig, (r) => ({
                                ...r,
                                background: {
                                  kind: "solid",
                                  color: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 h-6 w-full bg-transparent border border-zinc-700 rounded"
                          />
                        ) : null}
                      </div>
                      {/* Tone */}
                      <div>
                        <span className="text-zinc-500 text-xs">Tone</span>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          {(["lit", "flat"] as const).map((t) => (
                            <Button
                              key={t}
                              variant={
                                config.render.tone === t ? "primary" : "ghost"
                              }
                              size="sm"
                              onClick={() =>
                                updateRender(updateConfig, (r) => ({
                                  ...r,
                                  tone: t,
                                }))
                              }
                            >
                              {t}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-1">
                          "Lit" uses the FBX materials with phong/standard
                          shading. "Flat" swaps to MeshBasicMaterial for a
                          retro unlit look.
                        </p>
                      </div>
                      {/* Shadow */}
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={config.render.shadow}
                          onChange={(e) =>
                            updateRender(updateConfig, (r) => ({
                              ...r,
                              shadow: e.target.checked,
                            }))
                          }
                        />
                        <span className="text-zinc-300">Cast / receive shadows</span>
                      </label>
                    </div>
                  </section>

                  {/* Per-clip config */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                      Per-clip
                    </h3>
                    <ul className="space-y-2">
                      {config.animations.map((anim, idx) => (
                        <li
                          key={anim.fbxClipName + idx}
                          className={cn(
                            "rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-2",
                            activeClipIdx === idx && "border-amber-500/60",
                          )}
                        >
                          <div className="text-[11px] text-zinc-500 truncate">
                            {anim.fbxClipName}
                          </div>
                          <Input
                            value={anim.outputName}
                            onChange={(e) =>
                              updateAnim(idx, (a) => ({
                                ...a,
                                outputName: e.target.value,
                              }))
                            }
                            placeholder="idle"
                            className="h-7 text-xs"
                          />
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <Field
                              label="frames"
                              value={anim.frameCount}
                              min={1}
                              max={64}
                              onChange={(v) =>
                                updateAnim(idx, (a) => ({
                                  ...a,
                                  frameCount: v,
                                  // Auto-adjust per-frame duration so the
                                  // baked playback matches the source clip
                                  // wall-clock.
                                  frameDuration:
                                    a.clipDurationSec > 0
                                      ? a.clipDurationSec / Math.max(1, v)
                                      : a.frameDuration,
                                }))
                              }
                            />
                            <Field
                              label="frameDuration"
                              value={anim.frameDuration}
                              step={0.01}
                              min={0.01}
                              onChange={(v) =>
                                updateAnim(idx, (a) => ({
                                  ...a,
                                  frameDuration: v,
                                }))
                              }
                            />
                            <label className="flex items-center gap-1 col-span-2">
                              <input
                                type="checkbox"
                                checked={anim.loop}
                                onChange={(e) =>
                                  updateAnim(idx, (a) => ({
                                    ...a,
                                    loop: e.target.checked,
                                  }))
                                }
                              />
                              <span className="text-zinc-500">loop</span>
                            </label>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {/* Bake button */}
                  <section className="space-y-2 border-t border-zinc-800 pt-3">
                    <Button
                      variant="primary"
                      className="w-full"
                      disabled={baking || !plan || plan.captures.length === 0}
                      onClick={handleBake}
                    >
                      {baking
                        ? `Baking… ${bakeProgress}/${bakeTotal}`
                        : `Bake (≈ ${bakeTimeEstSec.toFixed(1)}s)`}
                    </Button>
                    {bakeError ? (
                      <p className="text-xs text-red-300">{bakeError}</p>
                    ) : null}
                    {baking && bakeTotal > 0 ? (
                      <div className="h-1 bg-zinc-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-amber-500"
                          style={{
                            width: `${(bakeProgress / bakeTotal) * 100}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : (
                <p className="p-4 text-sm text-zinc-500">
                  {loadingMsg ?? "Loading…"}
                </p>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Internals
// ─────────────────────────────────────────────────────────────────────

function deriveSpriteIdFromFile(file: File): string | null {
  const name = file.name.replace(/\.[^.]+$/, "");
  const clean = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return clean || null;
}

function deriveSpriteIdFromBlob(blob: Blob): string | null {
  // Blob has no name; caller passes spriteId explicitly for re-edits.
  void blob;
  return null;
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-zinc-950 border border-zinc-700 rounded h-7 px-2 mt-0.5 text-zinc-100"
      />
    </label>
  );
}

/**
 * Slider + numeric readout — used by the Render panel. The numeric
 * value lives next to the slider so the author can dial in precise
 * values without dragging.
 */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      <div className="flex justify-between">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400 tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

/**
 * Convenience mutator for the render sub-block — avoids spreading
 * `c.render` through every onChange in the Render panel.
 */
function updateRender(
  updateConfig: (mut: (c: FbxBakeConfig) => FbxBakeConfig) => void,
  mut: (r: FbxRenderConfig) => FbxRenderConfig,
) {
  updateConfig((c) => ({ ...c, render: mut(c.render) }));
}

/**
 * Slider + numeric readout — used by the Render panel. The numeric
 * value lives next to the slider so the author can dial in precise
 * values without dragging.
 */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      <div className="flex justify-between">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400 tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

/**
 * Convenience mutator for the render sub-block — avoids spreading
 * `c.render` through every onChange in the Render panel.
 */
function updateRender(
  updateConfig: (mut: (c: FbxBakeConfig) => FbxBakeConfig) => void,
  mut: (r: FbxRenderConfig) => FbxRenderConfig,
) {
  updateConfig((c) => ({ ...c, render: mut(c.render) }));
}
