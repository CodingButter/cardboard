---
name: project-raycaster-billboard-prefabs
description: "Cardboard is a Wolfenstein-style raycaster. Prefabs are billboard sprites (2D quads always facing the camera), NOT 3D meshes. Don't render cubes/spheres for entities."
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "this is a raycast engine so its weird to see so much 3D stuff. prefabs are usually billboard sprites. just something to keep in mind in the future".

**Why:** Cardboard is built on a Wolfenstein-style raycaster (`packages/engine/`). In raycaster engines:
- The world is a 2D grid with vertical walls of variable height.
- Enemies, items, triggers, and decor are **billboard sprites** — 2D textured quads that always face the camera plane.
- Lights are POINT lights but visually represented as billboard sprite glyphs (torch flame, lantern, orb, etc.).
- There are NO 3D meshes for entities. The only "geometry" is wall slabs + floor/ceiling planes.

**How to apply:**

1. **EntityPreviewPanel and similar previews must show sprites, not cubes/spheres.** Render a single textured quad that billboards toward the camera. Even the placeholder should be a flat quad with a Lucide icon textured onto it OR a procedural sprite (e.g. an additive glow disc for "light" entities, a humanoid silhouette for "actor" entities).
2. **The MapCanvas placeholder geometry of "walls" is fine** — walls ARE 3D in a raycaster, just constrained to grid cells.
3. **The 3D PreviewPanel on the Scene page** is showing the world from a perspective camera — that's allowed because it's a 3D PREVIEW of how the raycaster RESULT looks. But entity-specific previews (in the Prefabs page) should show the sprite asset, not a 3D mesh.
4. **COMPONENT_SCHEMAS hints already reflect this**: the Sprite component has `scale`, `fade`, `billboard` fields — those are sprite-renderer concepts. The Light component is a POINT light (no directional/spot meshing needed for raycaster).
5. **When building entity-rendering surfaces** (EntityPreview, MinimapPanel entity dots, Tilepreset thumbnails): default to sprite-thinking unless explicitly working on the 3D Scene Preview.

**Direct implication for current state:**

`apps/editor/src/views/prefabs/panels/EntityPreviewPanel.tsx` (Wave-2 build) currently renders 3D cubes/spheres. This is wrong for the engine. Replace with a billboard sprite: a single PlaneGeometry textured with the entity's sprite asset (or a procedural placeholder — additive glow for light, silhouette for actor), with the plane's rotation locked to face the camera via `mesh.quaternion.copy(camera.quaternion)` in the render loop. Keep the orbit camera so the user can verify the billboard always faces them.

**Engine API reference:** see `packages/engine/` for the actual raycaster + sprite rendering pipeline. Wave 3 wires real sprite assets.
