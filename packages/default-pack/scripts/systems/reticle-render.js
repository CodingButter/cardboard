/**
 * Default pack — ReticleRenderSystem.
 *
 * HUD-phase render system. Stays horizontally centered on the canvas;
 * vertical position is the player's `Aim.screenY`, updated by
 * `player-input.js` from accumulated mouse-Y delta.
 *
 * Rendering modes (in priority order):
 *   1. If `api.config.reticle.imageUrl` is non-empty AND the image has
 *      loaded, blit it via `ctx.drawImage` centered on the aim point.
 *   2. Otherwise, draw a procedural plus-shaped crosshair using
 *      `color`/`size`/`gap`/`lineWidth` knobs.
 *
 * The image is fetched once at script load and cached. Loading is
 * async, so the procedural crosshair shows during the initial fetch.
 */
export default (api) => {
  const C = api.components;

  let image = null;
  const url = api.config.reticle.imageUrl;
  if (url) {
    const img = new Image();
    img.onload = () => { image = img; };
    img.onerror = (err) => {
      console.warn(`Failed to load reticle image ${url}:`, err);
    };
    img.src = url;
  }

  api.registerRendererSystem((renderer, world) => {
    const entity = world.first(C.PlayerInput, C.Aim);
    if (entity === undefined) return;

    const aim = C.Aim.getOrThrow(entity);
    const ctx = renderer.ctx;
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2 + aim.screenY;

    if (image) {
      const size = api.config.reticle.imageSizeFraction * ctx.canvas.height;
      ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
      return;
    }

    // Procedural fallback.
    const { color, size, gap, lineWidth } = api.config.reticle;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "butt";
    ctx.beginPath();
    if (gap > 0) {
      ctx.moveTo(cx - size, cy);  ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy);   ctx.lineTo(cx + size, cy);
      ctx.moveTo(cx, cy - size);  ctx.lineTo(cx, cy - gap);
      ctx.moveTo(cx, cy + gap);   ctx.lineTo(cx, cy + size);
    } else {
      ctx.moveTo(cx - size, cy);  ctx.lineTo(cx + size, cy);
      ctx.moveTo(cx, cy - size);  ctx.lineTo(cx, cy + size);
    }
    ctx.stroke();
    ctx.restore();
  }, "hud");
};
