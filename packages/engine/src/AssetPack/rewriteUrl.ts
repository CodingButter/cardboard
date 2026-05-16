/**
 * Rewrite CORS-hostile pack URLs to CORS-friendly equivalents.
 *
 * `github.com/.../blob/...` and `.../raw/...` 302-redirect to
 * `raw.githubusercontent.com`, which DOES send
 * `Access-Control-Allow-Origin: *`. But browsers enforce CORS on the
 * initial hop (github.com, no CORS header) and block before they ever
 * see the redirect. Rewriting the URL client-side before the fetch
 * skips the bad hop entirely.
 *
 * Returns the URL unchanged when no rewrite applies — safe to call on
 * every pack-load.
 *
 * Future hosts to handle here: GitLab, Bitbucket, GitHub Gist.
 */
export function rewriteCorsHostileUrl(url: string): string {
  // github.com/USER/REPO/(blob|raw)/[refs/heads/]BRANCH/PATH
  //   → raw.githubusercontent.com/USER/REPO/BRANCH/PATH
  const gh = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(?:refs\/heads\/)?(.+)$/,
  );
  if (gh) {
    return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  }
  return url;
}
