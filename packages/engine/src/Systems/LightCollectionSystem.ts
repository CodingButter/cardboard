import type { World } from "ECS";
import { Light, Position } from "Components";
import type { LightInstance, SceneRenderer } from "Renderers/SceneRenderer";

/**
 * ECS-side adapter for the renderer's dynamic-light pass. Queries every
 * entity carrying `Light + Position`, builds a per-frame `LightInstance`
 * list, and hands it to whichever backend is plugged in via
 * `renderer.setDynamicLights(...)`. The renderer caps the list internally
 * for perf (TwoD: 4, WebGL: 8) so we hand the whole thing over without
 * pre-culling — radius-based attenuation drops far-away contributions to
 * near zero anyway. See LIGHTING_OVERHAUL.md § 5.3 / § 6.
 *
 * Must run BEFORE `renderer.drawWorld(...)` so the world pass and the
 * sprite pass see the same set of lights.
 */
export default class LightCollectionSystem {
  /** Reused per-frame buffer; resized as the dynamic-light count grows. */
  private readonly instances: LightInstance[] = [];

  render(renderer: SceneRenderer, world: World): void {
    this.instances.length = 0;
    world.each(Light, Position, (_entity, data, position) => {
      this.instances.push({
        x: position.x,
        y: position.y,
        z: data.z ?? 0.5,
        color: data.color,
        intensity: data.intensity,
        radius: data.radius,
      });
    });
    renderer.setDynamicLights(this.instances);
  }
}
