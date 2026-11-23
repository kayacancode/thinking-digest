import { describe, it, expect } from 'vitest';
import { renderShifts, rewriteRate } from '../src/shifts';
import type { Ledger, MetricsRow, Position, ShiftsModel } from '../src/types';

const pos = (id: string, text: string, extra: Partial<Position> = {}): Position => ({
  id,
  topic: 'Agents',
  text,
  sources: [],
  since: '2026-11-01',
  tensionWith: [],
  ...extra,
});

const ledger: Ledger = {
  topics: ['Agents'],
  positions: [
    pos('pos-1111', 'Personal AI is a feature, not a company.', { supersededBy: { id: 'pos-2222', date: '2026-11-20' } }),
    pos('pos-2222', 'Personal AI can be a company if it owns memory.', { sources: ['Thinking/Takes/2026-11-20 - memory'] }),
    pos('pos-3333', 'Agents need a gate.', { tensionWith: ['pos-4444'] }),
    pos('pos-4444', 'Agents should act without asking.', { tensionWith: ['pos-3333'] }),
  ],
};

const ctx = { positionsPath: 'Thinking/Positions', ledger, rate: { week: null, prior: null } };
const empty: ShiftsModel = { moved: [], tension: [], sparks: [] };

describe('renderShifts', () => {
  it('renders moved positions with strike-through, links and sources', () => {
    const md = renderShifts({ ...empty, moved: [{ from: 'pos-1111', to: 'pos-2222', line: 'memory changed my mind' }] }, ctx);
    expect(md).toContain('## Shifts this week');
    expect(md).toContain('### Moved');
    expect(md).toContain(
      '- ~~Personal AI is a feature, not a company.~~ [[Thinking/Positions#^pos-1111]] → Personal AI can be a company if it owns memory. [[Thinking/Positions#^pos-2222]]: memory changed my mind',
    );
    expect(md).toContain('[[Thinking/Takes/2026-11-20 - memory]]');
    expect(md).not.toContain('### Unresolved tension');
  });

  it('drops moved and tension entries whose ids are not in the ledger', () => {
    const md = renderShifts(
      {
        moved: [{ from: 'pos-1111', to: 'pos-9999', line: 'ghost' }],
        tension: [
          { a: 'pos-3333', b: 'pos-4444', line: 'gate vs autonomy' },
          { a: 'pos-dead', b: 'pos-3333', line: 'ghost tension' },
        ],
        sparks: [],
      },
      ctx,
    );
    expect(md).not.toContain('### Moved');
    expect(md).not.toContain('ghost');
    expect(md).toContain('### Unresolved tension');
    expect(md).toContain('gate vs autonomy');
  });

  it('returns an empty string when every entry is dropped and there is no rate', () => {
    expect(renderShifts({ ...empty, moved: [{ from: 'pos-aaaa', to: 'pos-bbbb', line: 'x' }] }, ctx)).toBe('');
    expect(renderShifts(empty, ctx)).toBe('');
  });

  it('renders sparks with their evidence links', () => {
    const md = renderShifts(
      { ...empty, sparks: [{ spark: 'Thinking/Sparks/memory', evidence: ['Thinking/Takes/a', 'Thinking/Takes/b'], line: 'two takes back it' }] },
      ctx,
    );
    expect(md).toContain('### Sparks with new evidence');
    expect(md).toContain('- [[Thinking/Sparks/memory]]: two takes back it');
    expect(md).toContain('[[Thinking/Takes/a]], [[Thinking/Takes/b]]');
  });

  it('shows the drift check as percentages, with n/a for a missing side', () => {
    const md = renderShifts(empty, { ...ctx, rate: { week: 0.25, prior: null } });
    expect(md).toContain('### Drift check');
    expect(md).toContain('25% this week vs n/a over the prior 4 weeks');
  });
});

describe('rewriteRate', () => {
  const row = (date: string, kept: number, rewrote: number, answered = 0): MetricsRow => ({
    date,
    kept,
    rewrote,
    answered,
    rejected: 3,
    skipped: 2,
  });

  it('is rewrote / (kept + rewrote) over rows inside the inclusive range', () => {
    const metrics = [row('2026-11-15', 9, 9), row('2026-11-16', 1, 1), row('2026-11-20', 2, 0, 5), row('2026-11-22', 0, 0), row('2026-11-23', 9, 0)];
    expect(rewriteRate(metrics, '2026-11-16', '2026-11-22')).toBe(0.25);
  });

  it('is null when nothing was kept or rewritten', () => {
    expect(rewriteRate([row('2026-11-18', 0, 0, 4)], '2026-11-16', '2026-11-22')).toBeNull();
    expect(rewriteRate([], '2026-11-16', '2026-11-22')).toBeNull();
    expect(rewriteRate([row('2026-11-01', 1, 1)], '2026-11-16', '2026-11-22')).toBeNull();
  });
});
