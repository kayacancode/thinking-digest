import { describe, it, expect } from 'vitest';
import {
  applyClaims,
  findRetractions,
  livePositions,
  parseLedger,
  renderLedger,
} from '../src/positions';
import { normalizeKey } from '../src/types';
import type { ExtractedClaim, Ledger } from '../src/types';

function sampleLedger(): Ledger {
  return {
    topics: ['Agents', 'Startups', 'Writing'],
    positions: [
      {
        id: 'pos-7f3a',
        topic: 'Agents',
        text: 'Agents need a gate more than they need more tools.',
        sources: ['Writing/Substack/2026-03-02 - your agent doesnt need more tools', 'Thinking/Sparks/Gates'],
        since: '2026-03-02',
        tensionWith: ['pos-b001'],
      },
      {
        id: 'pos-19c2',
        topic: 'Agents',
        text: 'Personal AI is a feature, not a company.',
        sources: ['Pondering/Personal AI'],
        since: '2026-01-10',
        supersededBy: { id: 'pos-a210', date: '2026-11-20' },
        tensionWith: [],
      },
      {
        id: 'pos-a210',
        topic: 'Agents',
        text: 'Personal AI can be a company if it owns the memory.',
        sources: ['Thinking/Takes/2026-11-20 - Memory'],
        since: '2026-11-20',
        tensionWith: [],
      },
      {
        id: 'pos-b001',
        topic: 'Startups',
        text: 'Early teams should buy tools, not build gates.',
        sources: [],
        since: '2026-05-01',
        tensionWith: ['pos-7f3a'],
      },
    ],
  };
}

function idsFrom(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('test ran out of ids');
    return id;
  };
}

function claim(partial: Partial<ExtractedClaim> & Pick<ExtractedClaim, 'text'>): ExtractedClaim {
  return { topic: 'Agents', source: 'Writing/Substack/new post', relation: 'new', target: null, ...partial };
}

/** Removes an entry line and its indented sub-bullets from a rendered ledger. */
function cutBlock(md: string, id: string): { rest: string; block: string } {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.endsWith(`^${id}`));
  let end = start + 1;
  while (lines[end]?.startsWith('\t')) end++;
  const block = lines.slice(start, end).join('\n');
  lines.splice(start, end - start);
  return { rest: lines.join('\n'), block };
}

const noRetractions = { date: '2026-11-22', retracted: [] };

describe('renderLedger / parseLedger', () => {
  it('round-trips a ledger, including superseded, tension and empty-topic entries', () => {
    const ledger = sampleLedger();
    expect(parseLedger(renderLedger(ledger))).toStrictEqual(ledger);
  });

  it('renders the documented note format', () => {
    const md = renderLedger(sampleLedger());
    expect(md.startsWith('# Positions\n\n%% ')).toBe(true);
    expect(md).toContain(
      [
        '## Agents',
        '- Agents need a gate more than they need more tools. ^pos-7f3a',
        '\t- sources: [[Writing/Substack/2026-03-02 - your agent doesnt need more tools]], [[Thinking/Sparks/Gates]]',
        '\t- since: 2026-03-02',
        '\t- tension: [[#^pos-b001]]',
        '- ~~Personal AI is a feature, not a company.~~ ^pos-19c2',
        '\t- sources: [[Pondering/Personal AI]]',
        '\t- since: 2026-01-10',
        '\t- superseded_by: [[#^pos-a210]] (2026-11-20)',
      ].join('\n'),
    );
    expect(md).toContain('## Writing\n');
    expect(renderLedger(parseLedger(md))).toBe(md);
  });

  it('parses the spec example with space indentation and a bare superseded_by id', () => {
    const md = [
      '## Agents',
      '- Agents need a gate more than they need more tools. ^pos-7f3a',
      '  - sources: [[Writing/Substack/2026-03-02 - your agent doesnt need more tools]]',
      '  - since: 2026-03-02',
      '- ~~Personal AI is a feature, not a company.~~ ^pos-19c2',
      '  - superseded_by: ^pos-a210 (2026-11-23)',
    ].join('\n');
    const ledger = parseLedger(md);
    expect(ledger.topics).toEqual(['Agents']);
    expect(ledger.positions[0]).toMatchObject({
      id: 'pos-7f3a',
      sources: ['Writing/Substack/2026-03-02 - your agent doesnt need more tools'],
      since: '2026-03-02',
    });
    expect(ledger.positions[1]).toMatchObject({
      text: 'Personal AI is a feature, not a company.',
      supersededBy: { id: 'pos-a210', date: '2026-11-23' },
    });
  });

  it('keeps her edits: rewritten text, deleted entry, entry moved to another topic', () => {
    const original = sampleLedger();
    let md = renderLedger(original);
    md = md.replace(
      'Agents need a gate more than they need more tools.',
      'Agents need a gate, not more tools.',
    );
    md = cutBlock(md, 'pos-b001').rest;
    const moved = cutBlock(md, 'pos-a210');
    md = moved.rest.replace('## Writing\n', `## Writing\n${moved.block}\n`);

    const edited = parseLedger(md);
    const byId = new Map(edited.positions.map((p) => [p.id, p]));

    expect(byId.get('pos-7f3a')).toMatchObject({
      text: 'Agents need a gate, not more tools.',
      sources: original.positions[0].sources,
      since: '2026-03-02',
    });
    expect(byId.has('pos-b001')).toBe(false);
    expect(byId.get('pos-a210')).toMatchObject({
      topic: 'Writing',
      sources: ['Thinking/Takes/2026-11-20 - Memory'],
    });
    expect(byId.get('pos-19c2')?.supersededBy).toEqual({ id: 'pos-a210', date: '2026-11-20' });

    const known = Object.fromEntries(original.positions.map((p) => [p.id, normalizeKey(p.text)]));
    expect(findRetractions(edited, known)).toEqual([
      { id: 'pos-b001', key: normalizeKey('Early teams should buy tools, not build gates.') },
    ]);

    expect(parseLedger(renderLedger(edited))).toStrictEqual(edited);
  });

  it('keeps her edits through a later applyClaims and re-render', () => {
    let md = renderLedger(sampleLedger());
    md = md.replace('Personal AI can be a company', 'Personal AI can be a business');
    const moved = cutBlock(md, 'pos-7f3a');
    md = moved.rest.replace('## Startups\n', `## Startups\n${moved.block}\n`);

    const { ledger } = applyClaims(
      parseLedger(md),
      [claim({ text: 'Memory is the moat.', topic: 'Agents' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );
    const reparsed = parseLedger(renderLedger(ledger));
    const byId = new Map(reparsed.positions.map((p) => [p.id, p]));

    expect(byId.get('pos-a210')?.text).toBe('Personal AI can be a business if it owns the memory.');
    expect(byId.get('pos-7f3a')?.topic).toBe('Startups');
    expect(byId.get('pos-c0de')?.topic).toBe('Agents');
  });

  it('ignores lines it does not recognize without losing neighbouring entries', () => {
    const md = [
      '# Positions',
      '',
      'Some thinking I scribbled here.',
      '',
      '## Agents',
      '- Agents need a gate. ^pos-7f3a',
      '\t- since: 2026-03-02',
      '\t- note: remember to revisit this',
      '- a loose thought without an id',
      '\t- since: 1999-01-01',
      '\t- sources: [[Wrong]]',
      '- Memory is the moat. ^pos-c0de',
      '\t- sources: [[Pondering/Memory|my memory note]]',
      '### Not a topic',
      '\t- since: 1999-01-01',
    ].join('\n');
    const ledger = parseLedger(md);

    expect(ledger.topics).toEqual(['Agents']);
    expect(ledger.positions).toStrictEqual([
      { id: 'pos-7f3a', topic: 'Agents', text: 'Agents need a gate.', sources: [], since: '2026-03-02', tensionWith: [] },
      { id: 'pos-c0de', topic: 'Agents', text: 'Memory is the moat.', sources: ['Pondering/Memory'], since: '', tensionWith: [] },
    ]);
  });

  it('keeps an entry she put above the first topic instead of treating it as deleted', () => {
    const md = '# Positions\n\n- Taste is a moat. ^pos-0001\n\t- since: 2026-02-02\n\n## Agents\n- Gates win. ^pos-0002\n';
    const ledger = parseLedger(md);
    expect(ledger.positions.map((p) => [p.id, p.topic])).toEqual([
      ['pos-0001', 'Uncategorized'],
      ['pos-0002', 'Agents'],
    ]);
    expect(parseLedger(renderLedger(ledger))).toStrictEqual(ledger);
  });

  it('keeps only the first entry when she duplicates a block id', () => {
    const md = '## A\n- First. ^pos-0001\n\t- since: 2026-01-01\n- Copy. ^pos-0001\n\t- since: 1999-01-01\n';
    expect(parseLedger(md).positions).toStrictEqual([
      { id: 'pos-0001', topic: 'A', text: 'First.', sources: [], since: '2026-01-01', tensionWith: [] },
    ]);
  });
});

describe('applyClaims', () => {
  it('new: adds an entry at the end of its existing topic, matching the topic loosely', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: '  Memory is\nthe moat. ', topic: 'agents' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );

    expect(result.added).toEqual(['pos-c0de']);
    expect(result.ledger.topics).toEqual(['Agents', 'Startups', 'Writing']);
    expect(result.ledger.positions.map((p) => p.id)).toEqual([
      'pos-7f3a',
      'pos-19c2',
      'pos-a210',
      'pos-c0de',
      'pos-b001',
    ]);
    expect(result.ledger.positions[3]).toStrictEqual({
      id: 'pos-c0de',
      topic: 'Agents',
      text: 'Memory is the moat.',
      sources: ['Writing/Substack/new post'],
      since: '2026-11-22',
      tensionWith: [],
    });
    expect(parseLedger(renderLedger(result.ledger))).toStrictEqual(result.ledger);
  });

  it('new: appends a new topic', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'Pricing should follow outcomes.', topic: 'Pricing' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );
    expect(result.ledger.topics).toEqual(['Agents', 'Startups', 'Writing', 'Pricing']);
    expect(result.ledger.positions.at(-1)).toMatchObject({ id: 'pos-c0de', topic: 'Pricing' });
  });

  it('new: merges into an existing entry with the same normalized text instead of duplicating', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'agents need a GATE more than they need more tools', source: 'Pondering/Gates' })],
      { ...noRetractions, newId: idsFrom() },
    );
    expect(result.added).toEqual([]);
    expect(result.ledger.positions).toHaveLength(4);
    expect(result.ledger.positions[0].sources).toEqual([
      'Writing/Substack/2026-03-02 - your agent doesnt need more tools',
      'Thinking/Sparks/Gates',
      'Pondering/Gates',
    ]);
  });

  it('new: merges two identical claims in one batch into one entry with both sources', () => {
    const result = applyClaims(
      sampleLedger(),
      [
        claim({ text: 'Memory is the moat.', source: 'a' }),
        claim({ text: 'Memory is the moat!', source: 'b' }),
      ],
      { ...noRetractions, newId: idsFrom('pos-c0de', 'pos-d00d') },
    );
    expect(result.added).toEqual(['pos-c0de']);
    expect(result.ledger.positions.find((p) => p.id === 'pos-c0de')?.sources).toEqual(['a', 'b']);
  });

  it('same: adds the source to the target once', () => {
    const result = applyClaims(
      sampleLedger(),
      [
        claim({ text: 'Gates over tools.', relation: 'same', target: 'pos-7f3a', source: 'Pondering/Gates' }),
        claim({ text: 'Gates over tools.', relation: 'same', target: 'pos-7f3a', source: 'Pondering/Gates' }),
        claim({ text: 'Gates over tools.', relation: 'same', target: 'pos-7f3a', source: 'Thinking/Sparks/Gates' }),
      ],
      { ...noRetractions, newId: idsFrom() },
    );
    expect(result.added).toEqual([]);
    expect(result.ledger.positions[0].text).toBe('Agents need a gate more than they need more tools.');
    expect(result.ledger.positions[0].sources).toEqual([
      'Writing/Substack/2026-03-02 - your agent doesnt need more tools',
      'Thinking/Sparks/Gates',
      'Pondering/Gates',
    ]);
  });

  it('updates: adds the new entry and strikes through the old one', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'Agents need memory before gates.', relation: 'updates', target: 'pos-7f3a' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );
    const old = result.ledger.positions.find((p) => p.id === 'pos-7f3a');

    expect(result.added).toEqual(['pos-c0de']);
    expect(result.superseded).toEqual([{ from: 'pos-7f3a', to: 'pos-c0de' }]);
    expect(old?.supersededBy).toEqual({ id: 'pos-c0de', date: '2026-11-22' });
    expect(livePositions(result.ledger).map((p) => p.id)).toEqual(['pos-a210', 'pos-c0de', 'pos-b001']);

    const md = renderLedger(result.ledger);
    expect(md).toContain('- ~~Agents need a gate more than they need more tools.~~ ^pos-7f3a');
    expect(md).toContain('\t- superseded_by: [[#^pos-c0de]] (2026-11-22)');
    expect(parseLedger(md)).toStrictEqual(result.ledger);
  });

  it('updates: re-extracting the same update does not duplicate or re-report it', () => {
    const update = claim({ text: 'Agents need memory before gates.', relation: 'updates', target: 'pos-7f3a' });
    const first = applyClaims(sampleLedger(), [update], { ...noRetractions, newId: idsFrom('pos-c0de') });
    const second = applyClaims(first.ledger, [update], { ...noRetractions, newId: idsFrom() });
    expect(second.ledger).toStrictEqual(first.ledger);
    expect(second.superseded).toEqual([]);
  });

  it('tension: adds the new entry and links both ways', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'Personal AI will be bundled into the OS.', relation: 'tension', target: 'pos-a210' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );
    const byId = new Map(result.ledger.positions.map((p) => [p.id, p]));

    expect(result.added).toEqual(['pos-c0de']);
    expect(result.tensions).toEqual([{ a: 'pos-a210', b: 'pos-c0de' }]);
    expect(byId.get('pos-a210')?.tensionWith).toEqual(['pos-c0de']);
    expect(byId.get('pos-c0de')?.tensionWith).toEqual(['pos-a210']);
    expect(byId.get('pos-a210')?.supersededBy).toBeUndefined();
    expect(parseLedger(renderLedger(result.ledger))).toStrictEqual(result.ledger);
  });

  it('treats a claim whose target no longer exists as new', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'Memory is the moat.', relation: 'updates', target: 'pos-ffff' })],
      { ...noRetractions, newId: idsFrom('pos-c0de') },
    );
    expect(result.added).toEqual(['pos-c0de']);
    expect(result.superseded).toEqual([]);
  });

  it('honors retractions: same text or a retracted target is never re-added', () => {
    const retracted = [{ id: 'pos-dead', key: normalizeKey('Agents are just scripts.') }];
    const result = applyClaims(
      sampleLedger(),
      [
        claim({ text: 'AGENTS are just scripts!' }),
        claim({ text: 'Agents are scripts with a loop.', relation: 'same', target: 'pos-dead' }),
        claim({ text: 'Agents are mostly scripts.', relation: 'updates', target: 'pos-dead' }),
      ],
      { date: '2026-11-22', retracted, newId: idsFrom() },
    );
    expect(result.added).toEqual([]);
    expect(result.ledger).toStrictEqual(sampleLedger());
  });

  it('never assigns an id that is already used or was retracted', () => {
    const result = applyClaims(
      sampleLedger(),
      [claim({ text: 'Memory is the moat.' })],
      {
        date: '2026-11-22',
        retracted: [{ id: 'pos-dead', key: 'something else' }],
        newId: idsFrom('pos-7f3a', 'pos-dead', 'pos-c0de'),
      },
    );
    expect(result.added).toEqual(['pos-c0de']);
  });

  it('does not mutate the input ledger', () => {
    const ledger = sampleLedger();
    applyClaims(
      ledger,
      [
        claim({ text: 'Memory is the moat.' }),
        claim({ text: 'x', relation: 'same', target: 'pos-7f3a', source: 'Pondering/Gates' }),
        claim({ text: 'Gates are overrated.', relation: 'updates', target: 'pos-7f3a' }),
        claim({ text: 'Tools first.', relation: 'tension', target: 'pos-a210' }),
        claim({ text: 'Pricing follows outcomes.', topic: 'Pricing' }),
      ],
      { ...noRetractions, newId: idsFrom('pos-0001', 'pos-0002', 'pos-0003', 'pos-0004') },
    );
    expect(ledger).toStrictEqual(sampleLedger());
  });
});

describe('livePositions', () => {
  it('excludes superseded entries', () => {
    expect(livePositions(sampleLedger()).map((p) => p.id)).toEqual(['pos-7f3a', 'pos-a210', 'pos-b001']);
  });
});
