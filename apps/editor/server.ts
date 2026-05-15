/// <reference types="bun" />
import index from "./index.html";

const PUBLIC_DIR = `${import.meta.dir}/public`;

const server = Bun.serve({
  port: 3001,
  routes: {
    "/": index,
    "/*": async (req) => {
      const { pathname } = new URL(req.url);
      const file = Bun.file(`${PUBLIC_DIR}${pathname}`);
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
