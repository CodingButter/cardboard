// R4/S4 smoke test — CRT scanlines + subtle barrel distortion.
//
// Post-process pass per ENGINE_PACK_SHADERS.md §4 (Mode 2). Receives
// the engine's color-buffer output via u_color, applies a CRT-style
// effect, writes the result. HUD overlays draw on top, untouched.
//
// Inputs from the auto-injected header (§5.5):
//   uniform sampler2D u_color;     // previous pass output
//   uniform vec2      u_resolution;
//   uniform float     u_time;      // seconds since start
//   uniform float     u_frame;     // monotonic frame counter
//   in vec2           v_uv;        // [0,1] screen UV
//   out vec4          outColor;

void main() {
  // Subtle barrel distortion: pull edges inward.
  vec2 centered = v_uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  vec2 warped = (centered * (1.0 + 0.04 * r2)) * 0.5 + 0.5;

  // Out-of-screen after warp -> black border (the CRT bezel look).
  if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = texture(u_color, warped).rgb;

  // Horizontal scanlines: dim every other row.
  float scanline = 1.0 - 0.18 * mod(floor(warped.y * u_resolution.y), 2.0);

  // Vignette so the edges feel rolled-off.
  float vignette = 1.0 - smoothstep(0.5, 1.1, length(centered));

  outColor = vec4(col * scanline * vignette, 1.0);
}
