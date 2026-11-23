import type { DigestItemModel, DigestModel, ExtractedClaim } from './types';

const POS_ID = /^pos-[0-9a-f]{4}$/;

interface DigestContext {
  paths: Set<string>;
  positionIds: Set<string>;
  candidates: Set<string>;
}

function checkItem(item: DigestItemModel, ctx: DigestContext): DigestItemModel {
  const isValid = (target: string) => (POS_ID.test(target) ? ctx.positionIds.has(target) : ctx.paths.has(target));
  const groundedIn = [...new Set(item.groundedIn)].filter(isValid);
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
  return { items, alsoNew };
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
