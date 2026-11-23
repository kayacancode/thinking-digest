import { parseDigest, targetLink } from './digest';
import type { DraftRecord, HarvestResult, MetricsRow, ParsedDigestItem, TakeOut, Verdict } from './types';

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

function judge(draft: DraftRecord, parsed: ParsedDigestItem | undefined): { verdict: Verdict; final: string } {
  if (!parsed) return { verdict: 'rejected', final: '' };
  if (draft.take !== null) {
    if (parsed.take === null || parsed.take.trim() === '') return { verdict: 'rejected', final: '' };
    const collapse = /\s+/g;
    const same = parsed.take.replace(collapse, ' ').trim() === draft.take.replace(collapse, ' ').trim();
    return { verdict: same ? 'kept' : 'rewrote', final: parsed.take };
  }
  if (parsed.answer !== null) return { verdict: 'answered', final: parsed.answer };
  return { verdict: 'skipped', final: '' };
}

export function harvestDigest(date: string, md: string, drafts: Record<string, DraftRecord>): HarvestResult {
  const parsed = new Map(parseDigest(md).map((p) => [p.id, p]));
  const metrics: MetricsRow = { date, kept: 0, rewrote: 0, answered: 0, rejected: 0, skipped: 0 };
  const result: HarvestResult = { takes: [], rejected: [], rewritePairs: [], metrics };

  for (const [id, draft] of Object.entries(drafts)) {
    const { verdict, final } = judge(draft, parsed.get(id));
    metrics[verdict]++;
    if (verdict === 'rejected') {
      result.rejected.push({ date, source: draft.source });
    } else if (verdict !== 'skipped') {
      result.takes.push({
        date,
        title: draft.title,
        source: draft.source,
        verdict,
        final,
        original: draft.take ?? draft.question ?? '',
        groundedIn: draft.groundedIn,
        tension: draft.tension,
      });
      if (verdict === 'rewrote') {
        result.rewritePairs.push({ draft: draft.take ?? '', final, takeTitle: draft.title });
      }
    }
  }
  return result;
}

export function takeNoteName(take: TakeOut): string {
  const title = take.title.replace(ILLEGAL_NAME_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return `${take.date} - ${title || 'Untitled'}`;
}

export function renderTake(take: TakeOut, opts: { positionsPath: string; digestFolder: string }): string {
  const draft = take.original.replace(/%(?=%)/g, '%\\');
  const yamlLinks = (targets: string[]) =>
    `[${targets.map((t) => JSON.stringify(targetLink(t, opts.positionsPath))).join(', ')}]`;
  return [
    '---',
    'type: take',
    `date: ${take.date}`,
    `source: ${JSON.stringify(`[[${take.source}]]`)}`,
    `verdict: ${take.verdict}`,
    `digest: ${JSON.stringify(`[[${opts.digestFolder}/${take.date}]]`)}`,
    `grounded_in: ${yamlLinks(take.groundedIn)}`,
    `updates: ${yamlLinks(take.tension.map((t) => t.target))}`,
    '---',
    take.final.trim(),
    '',
    `%% draft: ${draft} %%`,
    '',
  ].join('\n');
}
