/**
 * Where the game runner lives in this deployment.
 *
 * Three shapes the editor supports (EDITOR_IFRAME.md §11):
 *  1. Editor staged into the docs site under `/cardboard/editor/`
 *     → game runner lives at `/cardboard/play/`.
 *  2. Editor dev server (`bun --hot server.ts`) on its own port
 *     → game runner expected at `<editor-origin>/play/` (proxied by
 *     the editor's dev server, or pre-staged into the editor's
 *     `public/play/` directory).
 *  3. Editor static build served standalone (no docs basePath)
 *     → game runner at `/play/`.
 *
 * Same origin is mandatory — the iframe needs IndexedDB access to
 * `two_5_d_editor`, which is per-origin.
 *
 * The runtime check looks at `location.pathname` rather than a
 * build-time env var so the same editor bundle works in both prod
 * (Pages) and dev (localhost) without rebuild.
 */
export const GAME_RUNNER_URL: string = (() => {
  if (typeof window === "undefined") return "/play/";
  return window.location.pathname.startsWith("/cardboard/")
    ? "/cardboard/play/"
    : "/play/";
})();
