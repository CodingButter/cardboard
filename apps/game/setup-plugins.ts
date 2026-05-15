import type { BunPlugin } from "bun";

const glsl: BunPlugin = {
  name: "glsl",
  setup(build) {
    build.onLoad({ filter: /\.(vert|frag|glsl|wgsl|vs|fs)$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
      loader: "js",
    }));
  },
};

export default glsl;
