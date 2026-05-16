import { main, type GameState } from "@two_5_d/engine";
import { bootForEditor } from "./src/boot-editor";

/**
 * HMR-aware bootstrap.
 *
 * Each module reload disposes the previous `Game` (cancelling the engine,
 * detaching input listeners) and starts a new one — but the previous
 * state snapshot is handed forward so the player stays in place.
 *
 * `main()` is async now (it awaits the asset pack download); the
 * top-level `await` is supported in ES modules and Bun's bundler.
 *
 * P1 of `docs/plans/PACK_CHAIN.md` §3: the URL accepts multiple
 * `?pack=` params (`?pack=A&pack=B`) treated as an explicit chain in
 * declaration order — the LAST one is the root passed to `Game`,
 * earlier ones become prepended dependencies once the resolver walks
 * their `requires` graphs. A single `?pack=URL` stays as-before.
 *
 * I1 of `docs/plans/EDITOR_IFRAME.md` §4: the URL also accepts
 * `?source=editor&projectId=<id>`, which branches into an
 * IDB-backed pack served from the editor's `two_5_d_editor`
 * database. The branch is detected here so the standard `?pack=`
 * code path stays untouched.
 */
let previousState: Partial<GameState> | undefined;

if (import.meta.hot && import.meta.hot.data.state) {
  previousState = import.meta.hot.data.state as Partial<GameState>;
}

const params = new URLSearchParams(window.location.search);

let game;
if (params.get("source") === "editor") {
  // Editor-embedded mode (EDITOR_IFRAME.md §4). The project id is
  // mandatory; without it we'd have nothing to read from IDB.
  const projectId = params.get("projectId");
  if (!projectId) {
    throw new Error("?source=editor requires a ?projectId=<id> parameter");
  }
  game = await bootForEditor(projectId, params.get("scene"), previousState);
} else {
  // Standard zip-pack flow — `?pack=URL` (or empty → DEFAULT_PACK_URL).
  const packUrls = params.getAll("pack").filter((u) => u.length > 0);
  game = await main(previousState, packUrls);
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = game.snapshot();
    game.stop();
  });
  import.meta.hot.accept();
}
