import type { World } from "ECS";
import { Aim, Camera, Facing, Position, Shader, Sprite } from "Components";
import { CONFIG } from "GameConfig";
import type { SceneRenderer, SpriteDrawRequest } from "Renderers/SceneRenderer";

/**
 * ECS-side adapter for the renderer's sprite pass. Queries every entity
 * with `Position + Sprite`, packs a `SpriteDrawRequest` per entity, and
 * hands the batch to whichever backend is plugged in. The renderer owns
 * the projection math, image storage, and z-clipping against the wall
 * depth buffer — this system just bridges ECS state to that pass.
 *
 * Must run after the world pass (renderer.drawWorld) so per-column wall
 * depth captured during that pass is available for occlusion.
 */
export default class SpriteRenderSystem {
  /** Reused per-frame buffer; resized as the sprite count grows. */
  private readonly requests: SpriteDrawRequest[] = [];

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

    this.requests.length = 0;
    world.each(Position, Sprite, (entity, position, sprite) => {
      // Per-entity shader-variant lookup (M1 of MATERIALS.md). Entities
      // without a `Shader` component, or carrying one not registered
      // as a variant at scene-load, get variant 0 — the pack default.
      // Renderers that don't implement variants (canvas2d) ignore the
      // field entirely.
      const shaderData = Shader.get(entity);
      const shaderVariant = renderer.spriteVariantIdFor?.(shaderData) ?? 0;
      this.requests.push({
        x: position.x,
        y: position.y,
        imageId: sprite.imageId,
        worldHeight: sprite.worldHeight,
        yOffset: sprite.yOffset,
        shaderVariant,
      });
    });

    if (this.requests.length === 0) return;
    renderer.drawSprites(this.requests, camPos, facing, camera, horizonOffset);
  }
}
