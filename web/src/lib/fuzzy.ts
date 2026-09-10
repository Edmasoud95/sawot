// Small fuzzy matcher for the model pickers: every query character must
// appear in order; contiguous runs and word-start hits score higher.

export interface FuzzyHit { score: number; indices: number[] }

const isBoundary = (text: string, i: number) => i === 0 || /[^a-z0-9]/i.test(text[i - 1]);

export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0, from = 0;
  for (const ch of q) {
    // Prefer a word-start occurrence when one exists ahead; else the nearest.
    let at = -1;
    for (let i = from; i < t.length; i++) {
      if (t[i] === ch && isBoundary(text, i)) { at = i; break; }
    }
    const nearest = t.indexOf(ch, from);
    if (nearest < 0) return null;
    if (at < 0 || at - nearest > 6) at = nearest;
    const prev = indices[indices.length - 1];
    if (prev !== undefined && at === prev + 1) score += 3;   // contiguous
    else if (isBoundary(text, at)) score += 2;               // word start
    else score += 1;
    score -= (at - from) * .02;                              // gaps cost a little
    indices.push(at);
    from = at + 1;
  }
  if (indices[0] === 0) score += 1.5;                        // prefix bonus
  score -= text.length * .005;                               // shorter names first on ties
  return { score, indices };
}

export interface ProviderLike { id: string; name: string; models: string[]; state?: string; error?: string }
export interface RankedItem { value: string; model: string; indices: number[]; score: number }
export interface RankedGroup { id: string; name: string; state: string; error?: string; items: RankedItem[] }

/** Provider groups with their matching models ordered by score. Groups with
 *  no hits drop out, except providers still loading, which stay so the user
 *  knows more may arrive. */
export function rankModels(query: string, providers: ProviderLike[]): RankedGroup[] {
  const groups: RankedGroup[] = [];
  for (const p of providers) {
    const items: RankedItem[] = [];
    for (const model of p.models) {
      const hit = fuzzyMatch(query, model);
      if (hit) items.push({ value: `${p.id}::${model}`, model, indices: hit.indices, score: hit.score });
    }
    if (query.trim()) items.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
    const state = p.state ?? (p.error ? "error" : "ready");
    if (items.length || state === "pending" || !query.trim()) {
      groups.push({ id: p.id, name: p.name, state, ...(p.error ? { error: p.error } : {}), items });
    }
  }
  return groups;
}
