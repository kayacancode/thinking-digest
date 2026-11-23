import type { Ledger, MetricsRow, Position, ShiftsModel } from './types';

interface ShiftsContext {
  positionsPath: string;
  ledger: Ledger;
  rate: { week: number | null; prior: number | null };
}

function wikilinks(paths: string[]): string {
  return paths.map((p) => `[[${p}]]`).join(', ');
}

function positionLink(ctx: ShiftsContext, id: string): string {
  return `[[${ctx.positionsPath}#^${id}]]`;
}

function renderMoved(model: ShiftsModel, ctx: ShiftsContext, byId: Map<string, Position>): string[] {
  const lines: string[] = [];
  for (const m of model.moved) {
    const from = byId.get(m.from);
    const to = byId.get(m.to);
    if (!from || !to) continue;
    lines.push(`- ~~${from.text}~~ ${positionLink(ctx, from.id)} → ${to.text} ${positionLink(ctx, to.id)}: ${m.line}`);
    if (to.sources.length > 0) lines.push(`\t- sources: ${wikilinks(to.sources)}`);
  }
  return lines;
}

function renderTension(model: ShiftsModel, ctx: ShiftsContext, byId: Map<string, Position>): string[] {
  return model.tension.flatMap((t) => {
    const a = byId.get(t.a);
    const b = byId.get(t.b);
    if (!a || !b) return [];
    return [`- ${a.text} ${positionLink(ctx, a.id)} ↔ ${b.text} ${positionLink(ctx, b.id)}: ${t.line}`];
  });
}

function renderSparks(model: ShiftsModel): string[] {
  return model.sparks
    .filter((s) => s.spark.trim() !== '')
    .flatMap((s) => {
      const head = `- [[${s.spark}]]: ${s.line}`;
      return s.evidence.length > 0 ? [head, `\t- evidence: ${wikilinks(s.evidence)}`] : [head];
    });
}

function renderDrift(rate: ShiftsContext['rate']): string[] {
  if (rate.week === null && rate.prior === null) return [];
  const [week, prior] = [rate.week, rate.prior].map((r) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`));
  return [`Rewrite rate: ${week} this week vs ${prior} over the prior 4 weeks.`];
}

export function renderShifts(model: ShiftsModel, ctx: ShiftsContext): string {
  const byId = new Map(ctx.ledger.positions.map((p) => [p.id, p]));
  const sections: [string, string[]][] = [
    ['Moved', renderMoved(model, ctx, byId)],
    ['Unresolved tension', renderTension(model, ctx, byId)],
    ['Sparks with new evidence', renderSparks(model)],
    ['Drift check', renderDrift(ctx.rate)],
  ];
  const body = sections
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => `### ${heading}\n${lines.join('\n')}`);
  if (body.length === 0) return '';
  return `## Shifts this week\n\n${body.join('\n\n')}\n`;
}

export function rewriteRate(metrics: MetricsRow[], from: string, to: string): number | null {
  let kept = 0;
  let rewrote = 0;
  for (const row of metrics) {
    if (row.date < from || row.date > to) continue;
    kept += row.kept;
    rewrote += row.rewrote;
  }
  const taken = kept + rewrote;
  return taken === 0 ? null : rewrote / taken;
}
