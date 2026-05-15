/**
 * Default pack — MinimapRenderSystem.
 *
 * Player-centered circular minimap overlay drawn on the HUD phase.
 *
 * - Fixed-size circle in the top-left, with a radial alpha fade.
 * - `viewRadiusTiles` (read from `api.config.minimap.viewRadiusTiles`
 *   each frame) controls zoom — ±N tiles around the player on each
 *   axis.
 * - Walls inside the visible window are filled; minimap markers
 *   (entities with `MinimapMarker`) draw as colored dots, with an
 *   optional forward-direction ray cast via `api.raycast.castRayToWall`.
 *
 * Composited through an offscreen buffer so the `destination-in`
 * radial-gradient mask doesn't have to interact with anything else on
 * the HUD canvas.
 */
export default (api) => {
  const C = api.components;
  const Vec2 = api.Vec2;

  // Lazy-init offscreen buffer (sized to match the minimap rect).
  const buffer = document.createElement("canvas");
  const bufferCtx = buffer.getContext("2d");
  if (!bufferCtx) throw new Error("minimap-render: failed to get 2D context");

  const scale = () => {
    const s = api.config.minimap.scale;
    // `1 / ASPECT_RATIO` (16/9) on x keeps it square despite the wide
    // canvas. Engine's ASPECT_RATIO = 16/9 ≈ 1.7778.
    const ASPECT_RATIO = 16 / 9;
    return new Vec2(s / ASPECT_RATIO, s);
  };

  // Style — sourced from config so settings sliders propagate live.
  const styleNow = () => {
    const s = api.config.minimap.style;
    return {
      background: s.background,
      outline: s.outline,
      wall: s.wall,
      ray: s.ray,
      strokeWidthPx: s.strokeWidthPx,
    };
  };

  const drawLine = (ctx, p1, p2) => {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.closePath();
  };

  const drawCircle = (ctx, center, radius) => {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.closePath();
  };

  api.registerRendererSystem((renderer, world) => {
    const playerEntity = world.first(C.PlayerInput, C.Position);
    if (playerEntity === undefined) return;
    const playerPos = C.Position.getOrThrow(playerEntity);
    const scene = api.scene;

    const ctx = renderer.ctx;
    const sc = scale();
    const w = Math.max(1, Math.floor(ctx.canvas.width * sc.x));
    const h = Math.max(1, Math.floor(ctx.canvas.height * sc.y));
    const left = 0;
    const top = 0;

    if (buffer.width !== w || buffer.height !== h) {
      buffer.width = w;
      buffer.height = h;
    }

    const style = styleNow();
    const bctx = bufferCtx;
    bctx.clearRect(0, 0, w, h);

    bctx.fillStyle = style.background;
    bctx.fillRect(0, 0, w, h);

    const viewRadius = api.config.minimap.viewRadiusTiles;
    const minSide = Math.min(w, h);
    const tileSize = minSide / (viewRadius * 2);
    const strokeTileWidth = style.strokeWidthPx / tileSize;
    const cx = w / 2;
    const cy = h / 2;

    bctx.save();
    bctx.translate(cx, cy);
    bctx.scale(tileSize, tileSize);
    bctx.translate(-playerPos.x, -playerPos.y);

    // Walls inside the visible window.
    {
      const minX = Math.max(0, Math.floor(playerPos.x - viewRadius));
      const maxX = Math.min(scene.size.x - 1, Math.ceil(playerPos.x + viewRadius));
      const minY = Math.max(0, Math.floor(playerPos.y - viewRadius));
      const maxY = Math.min(scene.size.y - 1, Math.ceil(playerPos.y + viewRadius));
      bctx.fillStyle = style.wall;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (scene.isWall(x, y)) bctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // Scene outline.
    bctx.lineWidth = strokeTileWidth;
    bctx.strokeStyle = style.outline;
    bctx.strokeRect(0, 0, scene.size.x, scene.size.y);

    // Markers — one per entity with `MinimapMarker`.
    world.each(C.MinimapMarker, C.Position, (entity, marker, position) => {
      if (marker.drawForwardRay) {
        const facing = C.Facing.get(entity);
        if (facing !== undefined) {
          const dir = Vec2.fromAngle(facing);
          const hit = api.raycast.castRayToWall(
            scene,
            position,
            dir,
            Math.ceil(scene.size.length()),
          );
          const distance = hit ? hit.perpDistance : scene.size.length();
          const endPoint = position.add(dir.scale(distance));
          bctx.lineWidth = strokeTileWidth;
          bctx.strokeStyle = style.ray;
          drawLine(bctx, position, endPoint);
        }
      }
      bctx.fillStyle = marker.color;
      drawCircle(bctx, position, marker.radius);
    });

    bctx.restore();

    // Radial fade — `destination-in` keeps only where the gradient has
    // alpha, so the circle's edge feathers cleanly into the page.
    bctx.globalCompositeOperation = "destination-in";
    const radius = minSide / 2;
    const grad = bctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.75, "rgba(255, 255, 255, 1)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, w, h);
    bctx.globalCompositeOperation = "source-over";

    ctx.drawImage(buffer, left, top);
  }, "hud");
};
