/// <reference types="bun" />
import index from "./index.html";

const PUBLIC_DIR = `${import.meta.dir}/public`;

/**
 * Resolve a content-type for files Bun.file might not infer correctly.
 * Most things are fine (it sniffs from the extension), but the PWA
 * manifest needs to be served as JSON and the service worker as JS —
 * both with no-store so future deploys actually update on the client.
 */
function pwaHeaders(pathname: string): HeadersInit | undefined {
  if (pathname === "/manifest.webmanifest") {
    return {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-cache",
    };
  }
  if (pathname === "/sw.js") {
    return {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache",
      // Allow the SW to control the whole origin even if the file moves.
      "service-worker-allowed": "/",
    };
  }
  return undefined;
}

const server = Bun.serve({
  routes: {
    "/": index,
    "/*": async (req) => {
      const { pathname } = new URL(req.url);
      const file = Bun.file(`${PUBLIC_DIR}${pathname}`);
      if (await file.exists()) {
        const extra = pwaHeaders(pathname);
        if (extra) return new Response(file, { headers: extra });
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
