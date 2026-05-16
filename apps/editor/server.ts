/// <reference types="bun" />
import index from "./index.html";

const PUBLIC_DIR = `${import.meta.dir}/public`;

const server = Bun.serve({
  port: 3001,
  routes: {
    "/": index,
    "/*": async (req) => {
      const { pathname } = new URL(req.url);
      // Try the path as an exact file first.
      let file = Bun.file(`${PUBLIC_DIR}${pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
      // Fall back to directory-index lookup so `/play/` resolves to
      // `public/play/index.html` (the staged game-runner iframe used
      // by EditorViewport in Play mode).
      const indexPath = pathname.endsWith("/")
        ? `${pathname}index.html`
        : `${pathname}/index.html`;
      file = Bun.file(`${PUBLIC_DIR}${indexPath}`);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not Found", { status: 404 });
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Listening on ${server.url}`);
