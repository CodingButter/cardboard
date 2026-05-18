import { assetUrl } from "./assetUrl";

/**
 * Where the game runner lives in this deployment.
 *
 * Resolves to `<BASE>/play/` where `<BASE>` is the editor's deploy
 * prefix:
 *
 *  1. Dev server (`bun --hot server.ts`) on port 3001
 *     → `/play/` (proxied by `apps/editor/server.ts` to
 *     `apps/game/dist/`).
 *
 *  2. Static build served standalone (`bunx serve dist`)
 *     → `/play/` (the deploy workflow flattens `apps/game/dist/` into
 *     `apps/editor/dist/play/`).
 *
 *  3. GitHub Pages at `/cardboard/`
 *     → `/cardboard/play/` (same flatten, served under the repo
 *     subpath).
 *
 * Same origin is mandatory — the iframe needs IndexedDB access to
 * `two_5_d_editor`, which is per-origin.
 */
export const GAME_RUNNER_URL: string = assetUrl("/play/");
