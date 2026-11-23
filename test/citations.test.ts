import { describe, it, expect } from 'vitest';
import { checkClaims, checkDigest } from '../src/citations';
import type { DigestItemModel, ExtractedClaim } from '../src/types';

const ctx = {
  paths: new Set(['Writing/Substack/Real post', 'Granola notes/A', 'Clippings/B', 'Clippings/C']),
  positionIds: new Set(['pos-7f3a', 'pos-19c2']),
  candidates: new Set(['Granola notes/A', 'Clippings/B', 'Clippings/C']),
};

function item(overrides: Partial<DigestItemModel>): DigestItemModel {
  return {
    source: 'Granola notes/A',
    title: 'Meeting A',
    whatsNew: 'new',
    claims: ['c1'],
    take: 'I think so.',
    question: 'Do you?',
    groundedIn: ['pos-7f3a'],
    tension: [],
    ...overrides,
  };
}

describe('checkDigest', () => {
  it('drops invented paths and position ids from citations', () => {
    const out = checkDigest(
      {
        items: [
          item({
            groundedIn: ['pos-7f3a', 'pos-dead', 'Writing/Substack/Real post', 'Writing/Substack/Invented post'],
            tension: [
              { target: 'pos-19c2', why: 'real', kind: 'tension' },
              { target: 'pos-beef', why: 'invented', kind: 'updates' },
              { target: 'Nowhere/Note', why: 'invented', kind: 'tension' },
            ],
          }),
        ],
        alsoNew: [],
      },
      ctx,
    );
    expect(out.items[0].groundedIn).toEqual(['pos-7f3a', 'Writing/Substack/Real post']);
    expect(out.items[0].tension.map((t) => t.target)).toEqual(['pos-19c2']);
    expect(out.items[0].take).toBe('I think so.');
  });

  it('downgrades to question mode when no grounding survives, keeping the model question', () => {
    const out = checkDigest({ items: [item({ groundedIn: ['pos-0000', 'Made/Up'] })], alsoNew: [] }, ctx);
    expect(out.items[0]).toMatchObject({ take: null, question: 'Do you?', groundedIn: [] });
  });

  it('uses the fallback question when downgrading without a question', () => {
    const out = checkDigest({ items: [item({ groundedIn: [], question: null })], alsoNew: [] }, ctx);
    expect(out.items[0]).toMatchObject({ take: null, question: 'What do you make of "Meeting A"?' });
  });

  it('fills a missing question for an item that arrived in question mode', () => {
    const out = checkDigest({ items: [item({ take: null, question: '  ', groundedIn: [] })], alsoNew: [] }, ctx);
    expect(out.items[0].question).toBe('What do you make of "Meeting A"?');
  });

  it('drops non-candidate sources, dedupes by source, and caps claims at 4', () => {
    const out = checkDigest(
      {
        items: [
          item({ claims: ['1', '2', '3', '4', '5'] }),
          item({ title: 'Duplicate' }),
          item({ source: 'Writing/Substack/Real post', title: 'Not a candidate' }),
          item({ source: 'Clippings/B', title: 'B' }),
        ],
        alsoNew: [
          { source: 'Clippings/C', line: 'c' },
          { source: 'Invented/Source', line: 'x' },
          { source: 'Granola notes/A', line: 'already an item' },
          { source: 'Clippings/C', line: 'dupe' },
        ],
      },
      ctx,
    );
    expect(out.items.map((i) => i.title)).toEqual(['Meeting A', 'B']);
    expect(out.items[0].claims).toEqual(['1', '2', '3', '4']);
    expect(out.alsoNew).toEqual([{ source: 'Clippings/C', line: 'c' }]);
  });
});

describe('checkClaims', () => {
  const claimCtx = { sources: new Set(['Thinking/Takes/T']), positionIds: new Set(['pos-7f3a']) };
  const claim = (c: Partial<ExtractedClaim>): ExtractedClaim => ({
    text: 'Moats compound.',
    topic: 'Moats',
    source: 'Thinking/Takes/T',
    relation: 'same',
    target: 'pos-7f3a',
    ...c,
  });

  it('keeps valid claims, converts invalid targets to new, and drops bad sources or empty text', () => {
    const out = checkClaims(
      [
        claim({}),
        claim({ relation: 'updates', target: 'pos-ffff' }),
        claim({ relation: 'tension', target: null }),
        claim({ source: 'Invented/Source' }),
        claim({ text: '   ' }),
      ],
      claimCtx,
    );
    expect(out).toEqual([
      claim({}),
      claim({ relation: 'new', target: null }),
      claim({ relation: 'new', target: null }),
    ]);
  });
});
