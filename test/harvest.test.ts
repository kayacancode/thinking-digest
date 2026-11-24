import { describe, it, expect } from 'vitest';
import { renderDigest } from '../src/digest';
import { harvestDigest, renderTake, takeNoteName } from '../src/harvest';
import type { DigestItem, DraftRecord, TakeOut } from '../src/types';

const DATE = '2026-11-23';

function item(id: string, title: string, take: string | null, question: string | null = 'What do you think?'): DigestItem {
  return {
    id,
    title,
    source: `Granola notes/${title}`,
    whatsNew: '',
    claims: ['They claim a thing.'],
    take,
    question,
    groundedIn: take ? ['pos-7f3a'] : [],
    tension: take ? [{ target: 'pos-19c2', why: 'contradicts', kind: 'updates' }] : [],
  };
}

const items = [
  item('td-000001', 'Kept one', 'Distribution beats product.\nEvery time.'),
  item('td-000002', 'Rewrote one', 'Models will eat this.'),
  item('td-000003', 'Answered one', null, 'Is this a moat?'),
  item('td-000004', 'Skipped one', null, 'Does this matter?'),
  item('td-000005', 'Deleted one', 'Something she hated.'),
  item('td-000006', 'Emptied one', 'Something she cleared.'),
];

function drafts(): Record<string, DraftRecord> {
  return Object.fromEntries(items.map(({ id, whatsNew: _w, ...draft }) => [id, draft]));
}

function editedDigest(): string {
  let md = renderDigest({ date: DATE, prep: '', items, alsoNew: [], shifts: '', positionsPath: 'Thinking/Positions' });
  md = md.replace('> Distribution beats product.\n> Every time.', '>   Distribution  beats product. Every\n> time.  ');
  md = md.replace('> Models will eat this.', '> Models will not eat this,\n> because the data is hers.');
  md = md.replace('> Is this a moat?\n\n**My answer:**\n', '> Is this a moat?\n\n**My answer:**\nOnly if it compounds.\n\nIt does not.\n');
  md = md.replace('> Something she cleared.\n', '');
  const start = md.indexOf('## Deleted one');
  return md.slice(0, start) + md.slice(md.indexOf('## Emptied one'));
}

describe('harvestDigest', () => {
  const result = harvestDigest(DATE, editedDigest(), drafts());
  const byTitle = Object.fromEntries(result.takes.map((t) => [t.title, t]));

  it('assigns every verdict and counts them', () => {
    expect(result.metrics).toEqual({ date: DATE, kept: 1, rewrote: 1, answered: 1, rejected: 2, skipped: 1 });
    expect(result.takes.map((t) => [t.title, t.verdict])).toEqual([
      ['Kept one', 'kept'],
      ['Rewrote one', 'rewrote'],
      ['Answered one', 'answered'],
    ]);
  });

  it('treats whitespace-only changes as kept and keeps her text as written', () => {
    expect(byTitle['Kept one'].final).toBe('Distribution  beats product. Every\ntime.');
  });

  it('records a rewrite pair only for rewrites', () => {
    expect(result.rewritePairs).toEqual([
      {
        draft: 'Models will eat this.',
        final: 'Models will not eat this,\nbecause the data is hers.',
        takeTitle: 'Rewrote one',
      },
    ]);
  });

  it('uses her answer as the final text and the question as the original', () => {
    expect(byTitle['Answered one'].final).toBe('Only if it compounds.\n\nIt does not.');
    expect(byTitle['Answered one'].original).toBe('Is this a moat?');
  });

  it('rejects deleted items and emptied take callouts', () => {
    expect(result.rejected).toEqual([
      { date: DATE, source: 'Granola notes/Deleted one' },
      { date: DATE, source: 'Granola notes/Emptied one' },
    ]);
  });

  it('carries citations from the draft onto the take', () => {
    expect(byTitle['Rewrote one'].groundedIn).toEqual(['pos-7f3a']);
    expect(byTitle['Rewrote one'].tension[0].target).toBe('pos-19c2');
  });
});

const take: TakeOut = {
  date: DATE,
  title: 'Stasht: what "stays" [defensible]? #1',
  source: 'Granola notes/2026-11-21, Stasht',
  verdict: 'rewrote',
  final: 'My final words.\n',
  original: 'Draft with %% a comment closer %%% inside',
  groundedIn: ['pos-7f3a', 'Writing/Substack/Post'],
  tension: [{ target: 'pos-19c2', why: 'w', kind: 'updates' }],
};

describe('takeNoteName', () => {
  it('strips illegal characters and caps the title at 80 chars', () => {
    expect(takeNoteName(take)).toBe(`${DATE} - Stasht what stays defensible 1`);
    const long = takeNoteName({ ...take, title: 'x'.repeat(200) });
    expect(long).toBe(`${DATE} - ${'x'.repeat(80)}`);
  });
});

describe('renderTake', () => {
  const md = renderTake(take, { positionsPath: 'Thinking/Positions', digestFolder: 'Thinking/Digests' });

  it('writes quoted wikilinks in frontmatter with lists for citations', () => {
    expect(md).toContain('---\ntype: take\ndate: 2026-11-23\nsource: "[[Granola notes/2026-11-21, Stasht]]"\nverdict: rewrote\n');
    expect(md).toContain('digest: "[[Thinking/Digests/2026-11-23]]"');
    expect(md).toContain('grounded_in: ["[[Thinking/Positions#^pos-7f3a]]", "[[Writing/Substack/Post]]"]');
    expect(md).toContain('updates: ["[[Thinking/Positions#^pos-19c2]]"]');
    expect(md).toContain('---\nMy final words.\n\n%% draft: ');
  });

  it('escapes %% inside the draft so the comment closes only once', () => {
    const comment = md.slice(md.indexOf('%% draft: '));
    expect(comment.trimEnd().endsWith(' %%')).toBe(true);
    const inner = comment.trimEnd().slice('%% draft: '.length, -' %%'.length);
    expect(inner).not.toContain('%%');
    expect(inner.replace(/\\/g, '')).toBe(take.original);
  });

  it('writes empty lists when there are no citations', () => {
    const answered = renderTake({ ...take, groundedIn: [], tension: [] }, { positionsPath: 'P', digestFolder: 'D' });
    expect(answered).toContain('grounded_in: []\nupdates: []');
  });
});
