// R4/S1 smoke test — simplest possible body. Should render the whole
// world as flat opaque blue. If you see purple/anything else, the
// problem is in the pipeline (header injection, FBO blending, post
// state), not the shader math.
void main() {
  outColor = vec4(0.2, 0.4, 0.9, 1.0);
}
