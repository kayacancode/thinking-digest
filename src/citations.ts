import type { DigestItemModel, DigestModel, ExtractedClaim, ThreadModel } from './types';

const POS_ID = /^pos-[0-9a-f]{4}$/;

interface DigestContext {
  paths: Set<string>;
  positionIds: Set<string>;
  candidates: Set<string>;
  /** Existing Pondering paths; a thread may only extend one of these. */
  ponderings?: Set<string>;
  /**
   * Paths that hold Kaya's own words: her quick notes, posts, takes,
   * ponderings, sparks, and clippings with a first reaction. When given, a
   * take may only be grounded in these (or a position), and every thread
   * bullet needs at least one of them; a meeting or article alone is someone
   * else's thinking.
   */
  ownWords?: Set<string>;
}

/**
 * Keep only bullets with at least one real source (and one of her own, when
 * known). A thread extending an unknown Pondering becomes a new-Pondering
 * proposal, and a new Pondering needs 2+ distinct sources across its bullets
 * (a thought that recurs).
 */
function checkThreads(threads: ThreadModel[], ctx: DigestContext): ThreadModel[] {
  const out: ThreadModel[] = [];
  for (const t of threads) {
    const bullets = t.bullets
      .map((b) => ({ text: b.text.trim(), sources: [...new Set(b.sources)].filter((s) => ctx.paths.has(s)) }))
      .filter((b) => b.text !== '' && b.sources.length > 0 && (!ctx.ownWords || b.sources.some((s) => ctx.ownWords!.has(s))))
      .slice(0, 3);
    if (!bullets.length) continue;
    const pondering = t.pondering && ctx.ponderings?.has(t.pondering) ? t.pondering : null;
    if (pondering === null) {
      const distinct = new Set(bullets.flatMap((b) => b.sources));
      if (distinct.size < 2 || !t.title.trim()) continue;
    }
    out.push({ pondering, title: pondering ? '' : t.title.trim(), bullets });
  }
  return out;
}

function checkItem(item: DigestItemModel, ctx: DigestContext): DigestItemModel {
  const isValid = (target: string) => (POS_ID.test(target) ? ctx.positionIds.has(target) : ctx.paths.has(target));
  const isGround = (target: string) => (POS_ID.test(target) || !ctx.ownWords ? isValid(target) : ctx.ownWords.has(target));
  const groundedIn = [...new Set(item.groundedIn)].filter(isGround);
  const tension = item.tension.filter((t) => isValid(t.target));
  const claims = item.claims.filter((c) => c.trim() !== '').slice(0, 4);
  const take = item.take !== null && item.take.trim() !== '' && groundedIn.length > 0 ? item.take : null;
  let question = item.question?.trim() ? item.question : null;
  if (take === null && question === null) question = `What do you make of "${item.title}"?`;
  return { ...item, claims, take, question, groundedIn, tension };
}

export function checkDigest(model: DigestModel, ctx: DigestContext): DigestModel {
  const used = new Set<string>();
  const items: DigestItemModel[] = [];
  for (const item of model.items) {
    if (!ctx.candidates.has(item.source) || used.has(item.source)) continue;
    used.add(item.source);
    items.push(checkItem(item, ctx));
  }
  const alsoNew = model.alsoNew.filter((entry) => {
    if (!ctx.candidates.has(entry.source) || used.has(entry.source)) return false;
    used.add(entry.source);
    return true;
  });
  return { items, alsoNew, threads: checkThreads(model.threads ?? [], ctx) };
}

export function checkClaims(
  claims: ExtractedClaim[],
  ctx: { sources: Set<string>; positionIds: Set<string> },
): ExtractedClaim[] {
  return claims
    .filter((c) => ctx.sources.has(c.source) && c.text.trim() !== '')
    .map((c): ExtractedClaim => {
      const targetValid = c.target !== null && ctx.positionIds.has(c.target);
      if (c.relation === 'new' || !targetValid) return { ...c, relation: 'new', target: null };
      return c;
    });
}
