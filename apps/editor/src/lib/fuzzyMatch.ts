/**
 * Tiny fuzzy scorer — no external dependencies.
 *
 * Returns null when the query doesn't subsequence-match the target.
 * Otherwise returns a positive `score` and the indices of `target`
 * that were matched (used by the palette to render the bold highlight
 * over those characters).
 *
 * Scoring heuristic (informal):
 *   +1   base point per matched char
 *   +2   bonus when the match starts the string (prefix)
 *   +1   bonus when the match falls on a word boundary
 *        (after a separator: space, dot, slash, dash, underscore)
 *   +2   bonus per consecutive match streak character (after the first)
 *   +3   when the entire query exactly equals the target (case-insensitive)
 *
 * The scorer is case-insensitive. Empty queries return a tiny positive
 * score with an empty match list so callers can pass everything through
 * without a special case.
 */

export interface FuzzyResult {
  score: number;
  matches: number[];
}

const SEPARATORS = new Set([" ", ".", "/", "-", "_", "\\", ":", "(", ")"]);

export function fuzzyScore(
  query: string,
  target: string,
): FuzzyResult | null {
  if (!query) return { score: 0.001, matches: [] };
  if (!target) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Quick exact-match bypass.
  if (q === t) {
    const matches: number[] = [];
    for (let i = 0; i < t.length; i++) matches.push(i);
    return { score: 1000 + t.length, matches };
  }

  // Greedy subsequence walk. For each query char, find the next
  // occurrence in target, awarding bonuses for prefix / boundary /
  // streak. This isn't optimal (a DP solution like Smith-Waterman
  // would find the best subsequence path) but is fast and good
  // enough for command-palette ranking on small N.
  const matches: number[] = [];
  let score = 0;
  let ti = 0;
  let streak = 0;
  let lastMatched = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]!;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === qc) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return null;

    matches.push(found);
    score += 1;

    if (found === 0) score += 2;
    else if (SEPARATORS.has(t[found - 1]!)) score += 1;

    if (found === lastMatched + 1) {
      streak += 1;
      score += 2;
    } else {
      streak = 0;
    }
    lastMatched = found;
  }

  // A short query that matches the start of the target should rank
  // higher than the same query matching late. Bias by inverse of the
  // first-match position to break ties.
  if (matches.length > 0) {
    score += Math.max(0, 5 - matches[0]!) * 0.1;
  }

  return { score, matches };
}

/** Convenience — sort an array by fuzzy score (descending), keeping
 *  only items that match. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  target: (item: T) => string,
): Array<{ item: T; score: number; matches: number[] }> {
  const out: Array<{ item: T; score: number; matches: number[] }> = [];
  for (const item of items) {
    const res = fuzzyScore(query, target(item));
    if (res) out.push({ item, score: res.score, matches: res.matches });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
