import type { World } from "ECS";
import { Aim, Animation, Camera, Facing, Position, Shader, Sprite } from "Components";
import type { AssetPack } from "AssetPack";
import { CONFIG } from "GameConfig";
import type { SceneRenderer, SpriteDrawRequest } from "Renderers/SceneRenderer";
import { resolveSpriteRegion } from "Libs/SpriteAtlas";

/**
 * ECS-side adapter for the renderer's sprite pass. Queries every entity
 * with `Position + Sprite`, packs a `SpriteDrawRequest` per entity, and
 * hands the batch to whichever backend is plugged in. The renderer owns
 * the projection math, image storage, and z-clipping against the wall
 * depth buffer — this system just bridges ECS state to that pass.
 *
 * Must run after the world pass (renderer.drawWorld) so per-column wall
 * depth captured during that pass is available for occlusion.
 *
 * A1 of `docs/plans/ANIMATIONS.md` — reads the entity's `Animation` +
 * `Facing` components to compute the UV region for the current frame +
 * camera angle, and forwards that as `uvOffset` / `uvScale` on the draw
 * request. Entities without `Animation` get the full-layer region
 * (`{0,0} + {1,1}`), preserving the pre-A1 single-image draw path.
 */
export default class SpriteRenderSystem {
  /** Reused per-frame buffer; resized as the sprite count grows. */
  private readonly requests: SpriteDrawRequest[] = [];

  /**
   * Pack to read manifest sprite/animation defs from. Set by `Game`
   * after pack scripts have run. When unset every sprite renders with
   * the full-layer region (same as today's single-image path).
   */
  pack: AssetPack | undefined;

  render(renderer: SceneRenderer, world: World): void {
    const cameraEntity = world.first(Camera, Position, Facing);
    if (cameraEntity === undefined) return;
    const camera = Camera.getOrThrow(cameraEntity);
    const camPos = Position.getOrThrow(cameraEntity);
    const facing = Facing.getOrThrow(cameraEntity);
    // Match drawWorld's horizon offset so sprite vertical placement
    // lines up with the (possibly pitched) world.
    const a = Aim.get(cameraEntity);
    const horizonOffset = a ? -a.screenY * CONFIG.camera.pitchFraction : 0;
    const pack = this.pack;

    this.requests.length = 0;
    world.each(Position, Sprite, (entity, position, sprite) => {
      // Per-entity shader-variant lookup (M1 of materials plan — see git log). Entities
      // without a `Shader` component, or carrying one not registered
      // as a variant at scene-load, get variant 0 — the pack default.
      // Renderers that don't implement variants (canvas2d) ignore the
      // field entirely.
      const shaderData = Shader.get(entity);
      const shaderVariant = renderer.spriteVariantIdFor?.(shaderData) ?? 0;

      // A1 of ANIMATIONS.md — resolve the atlas UV region from the
      // entity's animation + facing + sprite-manifest grid. Sprites
      // without animation data get the full-layer region (default
      // `uvOffset`/`uvScale` left undefined here are interpreted by
      // the renderer as `{0,0}` / `{1,1}`).
      const spriteDef = pack?.manifest.sprites?.[sprite.imageId];
      let uvOffset: { x: number; y: number } | undefined;
      let uvScale: { x: number; y: number } | undefined;
      if (spriteDef && spriteDef.cols && spriteDef.rows) {
        const animData = Animation.get(entity);
        const entityFacing = Facing.get(entity);
        const region = resolveSpriteRegion(
          spriteDef,
          animData,
          position.x,
          position.y,
          entityFacing,
          camPos.x,
          camPos.y,
        );
        uvOffset = region.uvOffset;
        uvScale = region.uvScale;
      }

      this.requests.push({
        x: position.x,
        y: position.y,
        imageId: sprite.imageId,
        worldHeight: sprite.worldHeight,
        yOffset: sprite.yOffset,
        shaderVariant,
        uvOffset,
        uvScale,
      });
    });

    if (this.requests.length === 0) return;
    renderer.drawSprites(this.requests, camPos, facing, camera, horizonOffset);
  }
}
