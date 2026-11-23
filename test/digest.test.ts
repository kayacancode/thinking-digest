import { describe, it, expect } from 'vitest';
import { parseDigest, renderDigest, renderFailedDigest } from '../src/digest';
import type { DigestItem } from '../src/types';

const takeItem: DigestItem = {
  id: 'td-a1b2c3',
  title: 'Stasht: what stays defensible',
  source: 'Granola notes/2026-11-21, Stasht',
  whatsNew: 'They pitched the social layer.',
  claims: ['Models will organize content better every quarter.', 'Their edge is the social layer.'],
  take: 'The social layer is riding the models.\nIt does not accumulate.',
  question: 'Is the social layer an asset?',
  groundedIn: ['pos-7f3a', 'Writing/Substack/2026-10-01 - Does it get smarter'],
  tension: [{ target: 'pos-19c2', why: 'I said distribution was the moat', kind: 'tension' }],
};

const questionItem: DigestItem = {
  id: 'td-d4e5f6',
  title: 'Clipping on agents',
  source: 'Clippings/Agents are the new apps',
  whatsNew: '',
  claims: [],
  take: null,
  question: 'Do agents replace apps, or wrap them?',
  groundedIn: [],
  tension: [],
};

function render(items: DigestItem[], shifts = ''): string {
  return renderDigest({
    date: '2026-11-23',
    items,
    alsoNew: [{ source: 'Granola notes/standup', line: 'Logistics only.' }],
    shifts,
    positionsPath: 'Thinking/Positions',
  });
}

describe('renderDigest', () => {
  it('renders frontmatter, a UTC-safe weekday heading, and position links', () => {
    const md = render([takeItem, questionItem]);
    expect(md.startsWith('---\ntype: digest\ndate: 2026-11-23\nitems: 2\n---\n')).toBe(true);
    expect(md).toContain('# Digest: Monday 23 Nov');
    expect(md).toContain('## Stasht: what stays defensible ^td-a1b2c3');
    expect(md).toContain('**Source:** [[Granola notes/2026-11-21, Stasht]]');
    expect(md).toContain(
      '**Grounded in:** [[Thinking/Positions#^pos-7f3a]] · [[Writing/Substack/2026-10-01 - Does it get smarter]]',
    );
    expect(md).toContain('**Updates / in tension with:** [[Thinking/Positions#^pos-19c2]]: I said distribution was the moat');
    expect(md).toContain('> [!question] What do you think?\n> Do agents replace apps, or wrap them?\n\n**My answer:**\n');
    expect(md).toContain('## Also new\n- [[Granola notes/standup]]: Logistics only.');
  });

  it('limits claims to 4 and omits the claims block when there are none', () => {
    const many = { ...takeItem, claims: ['a', 'b', 'c', 'd', 'e'] };
    const md = render([many, questionItem]);
    expect(md).toContain('- d');
    expect(md).not.toContain('- e');
    expect(md.match(/\*\*What they claim\*\*/g)).toHaveLength(1);
  });

  it('omits Also new when empty and appends shifts verbatim', () => {
    const md = renderDigest({
      date: '2026-11-27',
      items: [takeItem],
      alsoNew: [],
      shifts: '## Shifts this week\n\n### Moved\n- x',
      positionsPath: 'P',
    });
    expect(md).not.toContain('## Also new');
    expect(md).toContain('# Digest: Friday 27 Nov');
    expect(md.trimEnd().endsWith('## Shifts this week\n\n### Moved\n- x')).toBe(true);
  });
});

describe('parseDigest', () => {
  it('round-trips take mode and question mode', () => {
    expect(parseDigest(render([takeItem, questionItem]))).toEqual([
      { id: 'td-a1b2c3', take: takeItem.take, answer: null },
      { id: 'td-d4e5f6', take: null, answer: null },
    ]);
  });

  it('reads her multi-line rewrite inside the callout, including blank lines', () => {
    const md = render([takeItem]).replace(
      '> The social layer is riding the models.\n> It does not accumulate.',
      '> Actually the social layer could compound.\n>\n> Network effects are not model-dependent,\n\n> and that is the whole point.',
    );
    expect(parseDigest(md)[0].take).toBe(
      'Actually the social layer could compound.\n\nNetwork effects are not model-dependent,\n\nand that is the whole point.',
    );
  });

  it('reads an answer that spans blank lines and stops at the next item', () => {
    const md = render([questionItem, takeItem]).replace(
      '**My answer:**\n',
      '**My answer:**\nThey wrap them for now.\n\nLater they replace the UI entirely.\n',
    );
    const parsed = parseDigest(md);
    expect(parsed[0].answer).toBe('They wrap them for now.\n\nLater they replace the UI entirely.');
    expect(parsed[1]).toEqual({ id: 'td-a1b2c3', take: takeItem.take, answer: null });
  });

  it('stops the answer at Also new and at a bold line', () => {
    const atAlsoNew = render([questionItem]).replace('**My answer:**\n', '**My answer:** Wrap.\n');
    expect(parseDigest(atAlsoNew)[0].answer).toBe('Wrap.');
    const atBold = render([questionItem]).replace('**My answer:**\n', '**My answer:**\nWrap.\n**Note:** later\n');
    expect(parseDigest(atBold)[0].answer).toBe('Wrap.');
  });

  it('drops a deleted item and still parses the rest', () => {
    const md = render([takeItem, questionItem]);
    const start = md.indexOf('## Stasht');
    const end = md.indexOf('## Clipping');
    const parsed = parseDigest(md.slice(0, start) + md.slice(end));
    expect(parsed.map((p) => p.id)).toEqual(['td-d4e5f6']);
  });

  it('returns an empty take when she clears the callout', () => {
    const md = render([takeItem]).replace('> The social layer is riding the models.\n> It does not accumulate.\n', '');
    expect(parseDigest(md)[0].take).toBe('');
  });

  it('survives a retitled heading and CRLF line endings', () => {
    const md = render([takeItem]).replace('Stasht: what stays defensible', 'Stasht, revisited').replace(/\n/g, '\r\n');
    expect(parseDigest(md)[0]).toEqual({ id: 'td-a1b2c3', take: takeItem.take, answer: null });
  });
});

describe('renderFailedDigest', () => {
  it('writes only the warning callout', () => {
    expect(renderFailedDigest('2026-11-23', 'API returned 529.')).toBe(
      '> [!warning] Digest failed: API returned 529. Run "Generate today\'s digest" to retry.\n',
    );
  });
});
