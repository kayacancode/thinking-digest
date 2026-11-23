import { describe, it, expect } from 'vitest';
import {
  buildDigestPrompt,
  buildExtractionPrompt,
  buildShiftsPrompt,
  buildVoicePrompt,
  parseDigestResponse,
  parseExtractionResponse,
  parseShiftsResponse,
  parseVoiceResponse,
} from '../src/prompts';
import type { Position } from '../src/types';

const digestJson = JSON.stringify({
  items: [
    {
      source: 'Granola notes/2026-11-21, Stasht',
      title: 'Stasht: what stays defensible',
      whatsNew: 'They pitched a social layer.',
      claims: ['They say models will organize saved content better every quarter.'],
      take: 'the social layer is the only part that compounds.',
      question: 'Is a social layer an accumulating asset?',
      groundedIn: ['pos-7f3a'],
      tension: [{ target: 'pos-19c2', why: 'contradicts my feature-not-company view', kind: 'tension' }],
    },
  ],
  alsoNew: [{ source: 'Clippings/foo', line: 'a pricing post' }],
});

describe('parseDigestResponse', () => {
  it('parses JSON inside a ```json fence', () => {
    const model = parseDigestResponse('```json\n' + digestJson + '\n```');
    expect(model.items[0].groundedIn).toEqual(['pos-7f3a']);
    expect(model.items[0].tension[0].kind).toBe('tension');
    expect(model.alsoNew).toEqual([{ source: 'Clippings/foo', line: 'a pricing post' }]);
  });

  it('parses JSON wrapped in prose', () => {
    const model = parseDigestResponse(`Here is the digest:\n${digestJson}\nLet me know if you want changes.`);
    expect(model.items).toHaveLength(1);
    expect(model.items[0].take).toBe('the social layer is the only part that compounds.');
  });

  it('defaults optional fields for a question-mode item', () => {
    const model = parseDigestResponse(
      JSON.stringify({ items: [{ source: 'a', title: 'A', take: null, question: 'why?' }] }),
    );
    expect(model.items[0]).toEqual({
      source: 'a',
      title: 'A',
      whatsNew: '',
      claims: [],
      take: null,
      question: 'why?',
      groundedIn: [],
      tension: [],
    });
    expect(model.alsoNew).toEqual([]);
  });

  it('names the failing field on an invalid tension kind', () => {
    const bad = JSON.stringify({
      items: [{ source: 'a', title: 'A', tension: [{ target: 'pos-1234', why: 'x', kind: 'contradicts' }] }],
    });
    expect(() => parseDigestResponse(bad)).toThrow(/items\.0\.tension\.0\.kind/);
  });

  it('names a missing required field', () => {
    expect(() => parseDigestResponse(JSON.stringify({ items: [{ title: 'A' }] }))).toThrow(/items\.0\.source/);
  });

  it('throws when there is no JSON at all', () => {
    expect(() => parseDigestResponse('sorry, I cannot help with that')).toThrow(/no JSON/);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseDigestResponse('{"items": [}')).toThrow(/digest response/);
  });
});

describe('parseExtractionResponse', () => {
  it('parses fenced claims and defaults a missing target to null', () => {
    const claims = parseExtractionResponse(
      '```\n{"claims":[{"text":"Agents need a gate.","topic":"Agents","source":"Writing/x","relation":"new"}]}\n```',
    );
    expect(claims).toEqual([
      { text: 'Agents need a gate.', topic: 'Agents', source: 'Writing/x', relation: 'new', target: null },
    ]);
  });

  it('names the relation field when it is not allowed', () => {
    const bad = '{"claims":[{"text":"t","topic":"T","source":"s","relation":"contradicts","target":null}]}';
    expect(() => parseExtractionResponse(bad)).toThrow(/claims\.0\.relation/);
  });

  it('names the claims field when it is missing', () => {
    expect(() => parseExtractionResponse('Result: {"positions": []}')).toThrow(/claims/);
  });
});

describe('parseVoiceResponse', () => {
  it('accepts the empty default from prose-wrapped output', () => {
    expect(parseVoiceResponse('No repeated pattern, so: {"rules": []}')).toEqual([]);
  });

  it('names learnedFrom when it is not an array', () => {
    expect(() => parseVoiceResponse('{"rules":[{"text":"Lead with the position.","learnedFrom":"Thinking/Takes/a"}]}')).toThrow(
      /rules\.0\.learnedFrom/,
    );
  });
});

describe('parseShiftsResponse', () => {
  it('defaults missing lists and spark evidence', () => {
    const model = parseShiftsResponse('```json\n{"sparks":[{"spark":"Thinking/Sparks/s","line":"more evidence"}]}\n```');
    expect(model).toEqual({ moved: [], tension: [], sparks: [{ spark: 'Thinking/Sparks/s', evidence: [], line: 'more evidence' }] });
  });

  it('names the failing field', () => {
    expect(() => parseShiftsResponse('{"moved":[{"from":"pos-aaaa","line":"x"}]}')).toThrow(/moved\.0\.to/);
  });
});

describe('prompt builders', () => {
  it('puts voice rules, positions with ids and prior paths in the digest system prompt', () => {
    const { system, user } = buildDigestPrompt({
      date: '2026-11-23',
      cap: 3,
      candidates: [
        { path: 'Granola notes/2026-11-21, Stasht', title: 'Stasht', created: '2026-11-21T10:00:00Z', kind: 'meeting', excerpt: 'they pitched' },
      ],
      priors: {
        voiceRules: ['Lead with the position, then the reason.'],
        positions: [{ id: 'pos-7f3a', topic: 'Agents', text: 'Agents need a gate.' }],
        notes: [{ path: 'Writing/Substack/2026-03-02 - gates', title: 'gates', kind: 'post', body: 'body' }],
      },
    });
    expect(system).toContain('Lead with the position, then the reason.');
    expect(system).toContain('pos-7f3a');
    expect(system).toContain('Writing/Substack/2026-03-02 - gates');
    expect(system).toContain('at most 3');
    expect(user).toContain('Granola notes/2026-11-21, Stasht');
    expect(user).toContain('they pitched');
  });

  it('lists existing topics and positions in the extraction prompt', () => {
    const { system, user } = buildExtractionPrompt({
      sources: [{ path: 'Thinking/Takes/t', title: 't', kind: 'take', body: 'my take body' }],
      positions: [{ id: 'pos-19c2', topic: 'Personal AI', text: 'Personal AI is a feature.' }],
    });
    expect(system).toContain('Existing topics: Personal AI');
    expect(system).toContain('pos-19c2');
    expect(user).toContain('Thinking/Takes/t');
  });

  it('includes both sides of every rewrite pair in the voice prompt', () => {
    const { system, user } = buildVoicePrompt({
      pairs: [{ draft: 'I think that maybe', final: 'no.', takeTitle: 'T', takePath: 'Thinking/Takes/2026-11-24 - T' }],
      rules: ['Lowercase is fine.'],
    });
    expect(system).toContain('Lowercase is fine.');
    expect(user).toContain('I think that maybe');
    expect(user).toContain('no.');
    expect(user).toContain('Thinking/Takes/2026-11-24 - T');
  });

  it('includes moved and tension position ids in the shifts prompt', () => {
    const pos = (id: string, text: string): Position => ({ id, topic: 'T', text, sources: [], since: '2026-01-01', tensionWith: [] });
    const { user } = buildShiftsPrompt({
      takes: [],
      moved: [{ from: pos('pos-aaaa', 'old view'), to: pos('pos-bbbb', 'new view') }],
      tensions: [{ a: pos('pos-cccc', 'x'), b: pos('pos-dddd', 'y') }],
      sparks: [],
    });
    for (const id of ['pos-aaaa', 'pos-bbbb', 'pos-cccc', 'pos-dddd']) expect(user).toContain(id);
  });
});
