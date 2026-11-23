import { describe, it, expect } from 'vitest';
import {
  acceptProposals,
  activeRuleTexts,
  findDeletedRules,
  parseVoiceRules,
  renderVoiceRules,
} from '../src/voice';
import { normalizeKey } from '../src/types';
import type { VoiceRule } from '../src/types';

function sampleRules(): VoiceRule[] {
  return [
    {
      id: 'vr-0a01',
      text: 'Lead with the position, then the reason. No warm-up.',
      learnedFrom: ['Thinking/Takes/2026-11-24 - Gates', 'Thinking/Takes/2026-11-26 - Memory'],
      status: 'active',
    },
    { id: 'vr-0a02', text: "Lowercase is fine; don't add exclamation marks.", learnedFrom: [], status: 'active' },
    {
      id: 'vr-0b01',
      text: 'Cut hedges like "I think".',
      learnedFrom: ['Thinking/Takes/2026-11-20 - Pricing', 'Thinking/Takes/2026-11-21 - Agents'],
      status: 'proposed',
    },
  ];
}

function idsFrom(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('test ran out of ids');
    return id;
  };
}

/** Removes a rule line and its indented sub-bullets from a rendered note. */
function cutBlock(md: string, id: string): { rest: string; block: string } {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.endsWith(`^${id}`));
  let end = start + 1;
  while (lines[end]?.startsWith('\t')) end++;
  const block = lines.slice(start, end).join('\n');
  lines.splice(start, end - start);
  return { rest: lines.join('\n'), block };
}

describe('renderVoiceRules / parseVoiceRules', () => {
  it('round-trips active and proposed rules', () => {
    const rules = sampleRules();
    expect(parseVoiceRules(renderVoiceRules(rules, 25))).toStrictEqual(rules);
  });

  it('renders active rules above the Proposed heading', () => {
    const md = renderVoiceRules(sampleRules(), 25);
    expect(md.startsWith('# Voice rules\n\n%% ')).toBe(true);
    expect(md).toContain(
      [
        '- Lead with the position, then the reason. No warm-up. ^vr-0a01',
        '\t- learned from: [[Thinking/Takes/2026-11-24 - Gates]], [[Thinking/Takes/2026-11-26 - Memory]]',
        "- Lowercase is fine; don't add exclamation marks. ^vr-0a02",
        '',
        '## Proposed',
        '',
        '- Cut hedges like "I think". ^vr-0b01',
      ].join('\n'),
    );
  });

  it('keeps the Proposed heading when nothing is proposed', () => {
    const active = sampleRules().slice(0, 2);
    const md = renderVoiceRules(active, 25);
    expect(md).toMatch(/^## Proposed$/m);
    expect(parseVoiceRules(md)).toStrictEqual(active);
  });

  it('parses the spec example with two-character ids and space indentation', () => {
    const md = [
      '- Lead with the position, then the reason. No warm-up. ^vr-01',
      '  - learned from: [[Thinking/Takes/2026-11-24 a]], [[Thinking/Takes/2026-11-26 b]]',
      "- Lowercase is fine; don't add exclamation marks. ^vr-02",
    ].join('\n');
    expect(parseVoiceRules(md)).toStrictEqual([
      {
        id: 'vr-01',
        text: 'Lead with the position, then the reason. No warm-up.',
        learnedFrom: ['Thinking/Takes/2026-11-24 a', 'Thinking/Takes/2026-11-26 b'],
        status: 'active',
      },
      { id: 'vr-02', text: "Lowercase is fine; don't add exclamation marks.", learnedFrom: [], status: 'active' },
    ]);
  });

  it('activates a proposed rule she moves above the Proposed heading', () => {
    const md = renderVoiceRules(sampleRules(), 25);
    const { rest, block } = cutBlock(md, 'vr-0b01');
    const edited = rest.replace(/^## Proposed$/m, `${block}\n\n## Proposed`);

    const rules = parseVoiceRules(edited);
    expect(rules.find((r) => r.id === 'vr-0b01')).toMatchObject({
      status: 'active',
      learnedFrom: ['Thinking/Takes/2026-11-20 - Pricing', 'Thinking/Takes/2026-11-21 - Agents'],
    });
    expect(activeRuleTexts(rules, 25)).toContain('Cut hedges like "I think".');
  });

  it('keeps her rewritten text and reports only the deleted rule', () => {
    const original = sampleRules();
    let md = renderVoiceRules(original, 25);
    md = md.replace('No warm-up.', 'Never warm up.');
    md = cutBlock(md, 'vr-0a02').rest;

    const rules = parseVoiceRules(md);
    expect(rules.map((r) => r.id)).toEqual(['vr-0a01', 'vr-0b01']);
    expect(rules[0].text).toBe('Lead with the position, then the reason. Never warm up.');
    expect(rules[0].learnedFrom).toHaveLength(2);

    const known = Object.fromEntries(original.map((r) => [r.id, normalizeKey(r.text)]));
    expect(findDeletedRules(rules, known)).toEqual([normalizeKey("Lowercase is fine; don't add exclamation marks.")]);
    expect(parseVoiceRules(renderVoiceRules(rules, 25))).toStrictEqual(rules);
  });

  it('keeps a rule she typed without a block id, with a stable id across re-renders', () => {
    const md = renderVoiceRules(sampleRules(), 25).replace(/^## Proposed$/m, '- Never use em dashes.\n\n## Proposed');
    const rules = parseVoiceRules(md);
    const typed = rules.find((r) => r.text === 'Never use em dashes.');

    expect(typed).toMatchObject({ status: 'active', learnedFrom: [] });
    expect(typed?.id).toMatch(/^vr-[0-9a-f]{4}$/);
    expect(parseVoiceRules(renderVoiceRules(rules, 25))).toStrictEqual(rules);
    expect(activeRuleTexts(rules, 25)).toContain('Never use em dashes.');
  });

  it('ignores the cap notice, comments and stray indented bullets', () => {
    const md = [
      '# Voice rules',
      '%% notes to self %%',
      '- Be blunt. ^vr-0001',
      '\t- an aside that is not a rule',
      '\t- learned from: [[a]], [[b]]',
      '## Proposed',
      '> Cap of 1 active rules reached: archive one before activating another.',
      '- Be brief. ^vr-0002',
    ].join('\n');
    expect(parseVoiceRules(md)).toStrictEqual([
      { id: 'vr-0001', text: 'Be blunt.', learnedFrom: ['a', 'b'], status: 'active' },
      { id: 'vr-0002', text: 'Be brief.', learnedFrom: [], status: 'proposed' },
    ]);
  });
});

describe('cap notice', () => {
  const notice = '> Cap of 2 active rules reached: archive one before activating another.';

  it('shows the notice under Proposed when the cap is reached and proposals wait', () => {
    const md = renderVoiceRules(sampleRules(), 2);
    expect(md).toContain(`## Proposed\n\n${notice}\n\n- Cut hedges`);
    expect(parseVoiceRules(md)).toStrictEqual(sampleRules());
  });

  it('omits the notice below the cap or with nothing proposed', () => {
    expect(renderVoiceRules(sampleRules(), 3)).not.toContain('Cap of');
    expect(renderVoiceRules(sampleRules().slice(0, 2), 2)).not.toContain('Cap of');
  });
});

describe('activeRuleTexts', () => {
  it('returns only active rules, in order, up to the cap', () => {
    const rules = sampleRules();
    expect(activeRuleTexts(rules, 25)).toEqual([
      'Lead with the position, then the reason. No warm-up.',
      "Lowercase is fine; don't add exclamation marks.",
    ]);
    expect(activeRuleTexts(rules, 1)).toEqual(['Lead with the position, then the reason. No warm-up.']);
  });
});

describe('acceptProposals', () => {
  const opts = { rejectedKeys: [] as string[] };

  it('appends a proposal backed by two distinct takes as proposed, never active', () => {
    const rules = acceptProposals(
      sampleRules(),
      [{ text: '  Prefer short\nsentences. ', learnedFrom: ['t/a', 't/b', 't/a'] }],
      { ...opts, newId: idsFrom('vr-0c01') },
    );
    expect(rules.slice(0, 3)).toStrictEqual(sampleRules());
    expect(rules[3]).toStrictEqual({
      id: 'vr-0c01',
      text: 'Prefer short sentences.',
      learnedFrom: ['t/a', 't/b'],
      status: 'proposed',
    });
    expect(activeRuleTexts(rules, 25)).not.toContain('Prefer short sentences.');
  });

  it('drops proposals without two distinct sources', () => {
    const rules = acceptProposals(
      sampleRules(),
      [
        { text: 'One take only.', learnedFrom: ['t/a'] },
        { text: 'Same take twice.', learnedFrom: ['t/a', 't/a'] },
        { text: 'Blank source.', learnedFrom: ['t/a', '  '] },
      ],
      { ...opts, newId: idsFrom() },
    );
    expect(rules).toStrictEqual(sampleRules());
  });

  it('drops duplicates of existing rules and of earlier proposals in the batch', () => {
    const rules = acceptProposals(
      sampleRules(),
      [
        { text: 'lead with the position then the reason no warm up', learnedFrom: ['t/a', 't/b'] },
        { text: 'cut hedges like I think', learnedFrom: ['t/c', 't/d'] },
        { text: 'Prefer short sentences.', learnedFrom: ['t/a', 't/b'] },
        { text: 'Prefer SHORT sentences!', learnedFrom: ['t/c', 't/d'] },
      ],
      { ...opts, newId: idsFrom('vr-0c01', 'vr-0c02') },
    );
    expect(rules.map((r) => r.id)).toEqual(['vr-0a01', 'vr-0a02', 'vr-0b01', 'vr-0c01']);
  });

  it('never re-proposes a rule she deleted', () => {
    const deleted = findDeletedRules(sampleRules().slice(1), {
      'vr-0a01': normalizeKey('Never open with a question.'),
    });
    const rules = acceptProposals(
      sampleRules().slice(1),
      [{ text: 'Never open with a question!', learnedFrom: ['t/a', 't/b'] }],
      { rejectedKeys: deleted, newId: idsFrom() },
    );
    expect(rules).toStrictEqual(sampleRules().slice(1));
  });

  it('skips ids already in use', () => {
    const rules = acceptProposals(
      sampleRules(),
      [{ text: 'Prefer short sentences.', learnedFrom: ['t/a', 't/b'] }],
      { ...opts, newId: idsFrom('vr-0a01', 'vr-0c01') },
    );
    expect(rules[3].id).toBe('vr-0c01');
  });

  it('does not mutate the input rules', () => {
    const input = sampleRules();
    acceptProposals(input, [{ text: 'Prefer short sentences.', learnedFrom: ['t/a', 't/b'] }], {
      ...opts,
      newId: idsFrom('vr-0c01'),
    });
    expect(input).toStrictEqual(sampleRules());
  });

  it('writes accepted proposals under Proposed with the cap notice when the cap is full', () => {
    const rules = acceptProposals(
      sampleRules().slice(0, 2),
      [{ text: 'Prefer short sentences.', learnedFrom: ['t/a', 't/b'] }],
      { ...opts, newId: idsFrom('vr-0c01') },
    );
    const md = renderVoiceRules(rules, 2);
    expect(md).toContain('> Cap of 2 active rules reached');
    expect(md.indexOf('Prefer short sentences.')).toBeGreaterThan(md.indexOf('\n## Proposed\n'));
  });
});
