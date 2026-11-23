import type {
  DigestItem,
  DraftRecord,
  Ledger,
  PluginState,
  Position,
  Post,
  Settings,
  TakeOut,
} from './types';
import { hashText, normalizeKey } from './types';
import type { Env } from './io';
import { stripFrontmatter } from './io';
import { askJson, createCliLlm, createLlm, type Llm } from './anthropic';
import { parseRss, parseExportZip, postNotePath, renderPostNote } from './substack';
import { applyClaims, findRetractions, livePositions, parseLedger, renderLedger } from './positions';
import { acceptProposals, activeRuleTexts, findDeletedRules, parseVoiceRules, renderVoiceRules } from './voice';
import { parseDigest, renderDigest, renderFailedDigest } from './digest';
import { harvestDigest, renderTake, takeNoteName } from './harvest';
import { checkClaims, checkDigest } from './citations';
import {
  buildDigestPrompt,
  buildExtractionPrompt,
  buildShiftsPrompt,
  buildVoicePrompt,
  parseDigestResponse,
  parseExtractionResponse,
  parseShiftsResponse,
  parseVoiceResponse,
} from './prompts';
import { renderShifts, rewriteRate } from './shifts';
import { isShiftsDay, localDate, weekRange } from './scheduler';
import { buildPriors, inFolder, listCandidates, ownWritingNotes } from './sources';

const EXTRACT_BATCH = 5;
const EXTRACT_BODY_CHARS = 12_000;
const VOICE_WINDOW_DAYS = 14;
const DRAFT_RETENTION_DAYS = 30;
const FAILED_MARKER = 'Digest failed:';

export interface Ctx {
  env: Env;
  state: PluginState;
  save: () => Promise<void>;
}

function settingsOf(ctx: Ctx): Settings {
  return ctx.state.settings;
}

function llmOf(ctx: Ctx): Llm {
  const s = settingsOf(ctx);
  if (s.provider === 'cli') {
    if (!ctx.env.exec || !ctx.env.cliPath) {
      throw new Error('Claude Code CLI not found. Set its path in Settings → Thinking Digest, or switch to an API key.');
    }
    return createCliLlm(ctx.env.exec, ctx.env.cliPath, s.model);
  }
  if (!s.apiKey) throw new Error('Add your Anthropic API key in Settings → Thinking Digest.');
  return createLlm(ctx.env.http, s.apiKey, s.model);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function uniqueId(prefix: string, len: number, taken: Set<string>, newHex: (n: number) => string): string {
  for (;;) {
    const id = `${prefix}-${newHex(len)}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

function digestPath(s: Settings, date: string): string {
  return `${s.digestFolder}/${date}`;
}

/** A digest file that only holds a failure notice doesn't count as today's digest. */
export async function digestExists(ctx: Ctx, date: string): Promise<boolean> {
  const md = await ctx.env.vault.read(digestPath(settingsOf(ctx), date));
  return md !== null && !md.includes(FAILED_MARKER);
}

/* ─── Substack ─────────────────────────────────────────────────────────── */

export interface ImportReport {
  written: number;
  unchanged: number;
  keptEdits: string[];
}

async function importPosts(ctx: Ctx, posts: Post[]): Promise<ImportReport> {
  const s = settingsOf(ctx);
  const report: ImportReport = { written: 0, unchanged: 0, keptEdits: [] };
  for (const post of posts) {
    const record = ctx.state.imports[post.url];
    const path = record?.path ?? postNotePath(post, s.writingFolder);
    const content = renderPostNote(post, ctx.env.toMarkdown);
    const current = await ctx.env.vault.read(path);
    if (current !== null) {
      // Her edits win: only overwrite a note that still matches what we last wrote.
      if (!record || hashText(current) !== record.hash) {
        if (current !== content) report.keptEdits.push(path);
        else report.unchanged++;
        continue;
      }
      if (current === content) {
        report.unchanged++;
        continue;
      }
    }
    await ctx.env.vault.write(path, content);
    ctx.state.imports[post.url] = { path, hash: hashText(content) };
    report.written++;
  }
  await ctx.save();
  return report;
}

export async function importSubstackRss(ctx: Ctx): Promise<ImportReport> {
  const base = settingsOf(ctx).substackUrl.replace(/\/+$/, '');
  const res = await ctx.env.http({ url: `${base}/feed` });
  if (res.status !== 200) throw new Error(`Substack feed HTTP ${res.status}`);
  return importPosts(ctx, parseRss(res.text));
}

export async function importSubstackZip(ctx: Ctx, bytes: Uint8Array): Promise<ImportReport> {
  const base = settingsOf(ctx).substackUrl.replace(/\/+$/, '');
  return importPosts(ctx, parseExportZip(bytes, base));
}

/* ─── Positions ────────────────────────────────────────────────────────── */

async function readLedger(ctx: Ctx): Promise<Ledger> {
  const md = await ctx.env.vault.read(settingsOf(ctx).positionsPath);
  return md ? parseLedger(md) : { topics: [], positions: [] };
}

interface ExtractSource {
  path: string;
  title: string;
  kind: string;
  body: string;
  hash: string;
}

async function extractionSources(ctx: Ctx, all: boolean): Promise<ExtractSource[]> {
  const s = settingsOf(ctx);
  const out: ExtractSource[] = [];
  for (const meta of ownWritingNotes(ctx.env.vault, s)) {
    const raw = await ctx.env.vault.read(meta.path);
    if (!raw) continue;
    const body = stripFrontmatter(raw).replace(/%%[\s\S]*?%%/g, '').trim();
    if (!body) continue;
    const hash = hashText(body);
    if (!all && ctx.state.extracted[meta.path] === hash) continue;
    const title = typeof meta.frontmatter?.['title'] === 'string' ? (meta.frontmatter['title'] as string) : meta.path.split('/').pop() ?? meta.path;
    const kind = inFolder(meta.path, s.writingFolder) ? 'published post' : inFolder(meta.path, s.takesFolder) ? 'take' : 'note';
    out.push({ path: meta.path, title, kind, body: body.slice(0, EXTRACT_BODY_CHARS), hash });
  }
  return out;
}

export interface ExtractReport {
  sources: number;
  added: number;
  superseded: number;
  tensions: number;
  failedBatches: number;
}

/**
 * Pull Kaya's own claims into the ledger. `dryRun` starts from an empty ledger
 * over every source and writes a scratch note instead of the real one.
 */
export async function extractPositions(ctx: Ctx, opts: { dryRun: boolean }): Promise<ExtractReport> {
  const s = settingsOf(ctx);
  const llm = llmOf(ctx);
  const today = localDate(ctx.env.now());
  let ledger: Ledger = opts.dryRun ? { topics: [], positions: [] } : await readLedger(ctx);

  if (!opts.dryRun) {
    for (const r of findRetractions(ledger, ctx.state.knownPositions)) {
      if (!ctx.state.retractedPositions.some((x) => x.id === r.id)) ctx.state.retractedPositions.push(r);
    }
  }

  const sources = await extractionSources(ctx, opts.dryRun);
  const report: ExtractReport = { sources: sources.length, added: 0, superseded: 0, tensions: 0, failedBatches: 0 };
  const taken = new Set([...ledger.positions.map((p) => p.id), ...Object.keys(ctx.state.knownPositions)]);

  for (let i = 0; i < sources.length; i += EXTRACT_BATCH) {
    const batch = sources.slice(i, i + EXTRACT_BATCH);
    try {
      const live = livePositions(ledger).map((p) => ({ id: p.id, topic: p.topic, text: p.text }));
      const claims = await askJson(llm, buildExtractionPrompt({ sources: batch, positions: live }), parseExtractionResponse);
      const checked = checkClaims(claims, {
        sources: new Set(batch.map((b) => b.path)),
        positionIds: new Set(ledger.positions.map((p) => p.id)),
      });
      const result = applyClaims(ledger, checked, {
        date: today,
        retracted: opts.dryRun ? [] : ctx.state.retractedPositions,
        newId: () => uniqueId('pos', 4, taken, ctx.env.newHex),
      });
      ledger = result.ledger;
      report.added += result.added.length;
      report.superseded += result.superseded.length;
      report.tensions += result.tensions.length;
      if (!opts.dryRun) for (const b of batch) ctx.state.extracted[b.path] = b.hash;
    } catch (err) {
      report.failedBatches++;
      ctx.env.log('extraction batch failed', { paths: batch.map((b) => b.path), error: (err as Error).message });
    }
  }

  const target = opts.dryRun ? `${s.positionsPath} (dry run)` : s.positionsPath;
  if (opts.dryRun || report.added || report.superseded || report.tensions) {
    await ctx.env.vault.write(target, renderLedger(ledger));
  }
  if (!opts.dryRun) {
    for (const p of ledger.positions) ctx.state.knownPositions[p.id] = normalizeKey(p.text);
    await ctx.save();
  }
  return report;
}

/* ─── Harvest ──────────────────────────────────────────────────────────── */

export interface HarvestReport {
  digests: number;
  takes: number;
  rejected: number;
  rewrote: number;
}

async function uniqueNotePath(ctx: Ctx, base: string): Promise<string> {
  if (!ctx.env.vault.exists(base)) return base;
  for (let n = 2; ; n++) if (!ctx.env.vault.exists(`${base} ${n}`)) return `${base} ${n}`;
}

async function writeTake(ctx: Ctx, take: TakeOut): Promise<string> {
  const s = settingsOf(ctx);
  const path = await uniqueNotePath(ctx, `${s.takesFolder}/${takeNoteName(take)}`);
  await ctx.env.vault.write(path, renderTake(take, { positionsPath: s.positionsPath, digestFolder: s.digestFolder }));
  return path;
}

export async function harvestAll(ctx: Ctx): Promise<HarvestReport> {
  const s = settingsOf(ctx);
  const today = localDate(ctx.env.now());
  const report: HarvestReport = { digests: 0, takes: 0, rejected: 0, rewrote: 0 };
  const due = Object.keys(ctx.state.drafts)
    .filter((d) => d < today && !ctx.state.harvested.includes(d))
    .sort();

  for (const date of due) {
    try {
      const md = await ctx.env.vault.read(digestPath(s, date));
      if (md === null) {
        ctx.env.log('digest note missing; skipping harvest', { date });
      } else {
        const result = harvestDigest(date, md, ctx.state.drafts[date]);
        for (const take of result.takes) await writeTake(ctx, take);
        ctx.state.rejections.push(...result.rejected);
        ctx.state.metrics.push(result.metrics);
        report.takes += result.takes.length;
        report.rejected += result.rejected.length;
        report.rewrote += result.metrics.rewrote;
      }
      ctx.state.harvested.push(date);
      report.digests++;
    } catch (err) {
      ctx.env.log('harvest failed for digest', { date, error: (err as Error).message });
    }
  }

  const oldest = addDays(today, -DRAFT_RETENTION_DAYS);
  for (const date of Object.keys(ctx.state.drafts)) {
    if (date < oldest && ctx.state.harvested.includes(date)) delete ctx.state.drafts[date];
  }
  await ctx.save();
  return report;
}

/* ─── Voice rules ──────────────────────────────────────────────────────── */

function draftFromTake(md: string): { final: string; draft: string } | null {
  const body = stripFrontmatter(md);
  const m = body.match(/%% draft: ([\s\S]*?) %%\s*$/);
  if (!m) return null;
  const draft = m[1].replace(/%\\%/g, '%%').trim();
  const final = body.slice(0, m.index).trim();
  return draft && final ? { draft, final } : null;
}

export async function learnVoice(ctx: Ctx): Promise<number> {
  const s = settingsOf(ctx);
  const today = localDate(ctx.env.now());
  const since = addDays(today, -VOICE_WINDOW_DAYS);
  const pairs: { draft: string; final: string; takeTitle: string; takePath: string }[] = [];
  for (const meta of ctx.env.vault.list()) {
    if (!inFolder(meta.path, s.takesFolder) || meta.frontmatter?.['verdict'] !== 'rewrote') continue;
    const date = String(meta.frontmatter?.['date'] ?? '');
    if (date < since) continue;
    const md = await ctx.env.vault.read(meta.path);
    const pair = md ? draftFromTake(md) : null;
    if (pair) pairs.push({ ...pair, takeTitle: meta.path.split('/').pop() ?? meta.path, takePath: meta.path });
  }
  if (pairs.length < 2) return 0;

  const md = await ctx.env.vault.read(s.voiceRulesPath);
  let rules = md ? parseVoiceRules(md) : [];
  for (const key of findDeletedRules(rules, ctx.state.knownRules)) {
    if (!ctx.state.rejectedRulePatterns.includes(key)) ctx.state.rejectedRulePatterns.push(key);
  }

  const proposals = await askJson(
    llmOf(ctx),
    buildVoicePrompt({ pairs, rules: activeRuleTexts(rules, s.maxActiveRules) }),
    parseVoiceResponse,
  );
  const validPaths = new Set(pairs.map((p) => p.takePath));
  const grounded = proposals.map((p) => ({ ...p, learnedFrom: p.learnedFrom.filter((x) => validPaths.has(x)) }));
  const taken = new Set([...rules.map((r) => r.id), ...Object.keys(ctx.state.knownRules)]);
  const before = rules.length;
  rules = acceptProposals(rules, grounded, {
    rejectedKeys: ctx.state.rejectedRulePatterns,
    newId: () => uniqueId('vr', 4, taken, ctx.env.newHex),
  });
  const added = rules.length - before;
  if (added > 0 || !md) await ctx.env.vault.write(s.voiceRulesPath, renderVoiceRules(rules, s.maxActiveRules));
  for (const r of rules) ctx.state.knownRules[r.id] = normalizeKey(r.text);
  await ctx.save();
  return added;
}

/* ─── Shifts ───────────────────────────────────────────────────────────── */

async function buildShiftsSection(ctx: Ctx, ledger: Ledger, llm: Llm): Promise<string> {
  const s = settingsOf(ctx);
  const { from, to } = weekRange(ctx.env.now());
  const inWeek = (d: string | undefined) => !!d && d >= from && d <= to;

  const takes: { path: string; text: string }[] = [];
  const sparks: { path: string; body: string }[] = [];
  for (const meta of ctx.env.vault.list()) {
    if (inFolder(meta.path, s.takesFolder) && inWeek(String(meta.frontmatter?.['date'] ?? ''))) {
      const md = await ctx.env.vault.read(meta.path);
      if (md) takes.push({ path: meta.path, text: stripFrontmatter(md).replace(/%%[\s\S]*?%%/g, '').trim() });
    } else if (inFolder(meta.path, 'Thinking/Sparks') && meta.frontmatter?.['status'] !== 'archived') {
      const md = await ctx.env.vault.read(meta.path);
      if (md) sparks.push({ path: meta.path, body: stripFrontmatter(md).slice(0, 1500) });
    }
  }

  const byId = new Map(ledger.positions.map((p) => [p.id, p]));
  const moved = ledger.positions
    .filter((p) => p.supersededBy && inWeek(p.supersededBy.date) && byId.has(p.supersededBy.id))
    .map((p) => ({ from: p, to: byId.get(p.supersededBy!.id) as Position }));
  const tensions: { a: Position; b: Position }[] = [];
  for (const p of ledger.positions) {
    if (!inWeek(p.since)) continue;
    for (const other of p.tensionWith) {
      const b = byId.get(other);
      if (b && !tensions.some((t) => (t.a.id === b.id && t.b.id === p.id) || (t.a.id === p.id && t.b.id === b.id))) {
        tensions.push({ a: p, b });
      }
    }
  }
  if (!takes.length && !moved.length && !tensions.length) return '';

  const model = await askJson(llm, buildShiftsPrompt({ takes, moved, tensions, sparks }), parseShiftsResponse);
  const rate = {
    week: rewriteRate(ctx.state.metrics, from, to),
    prior: rewriteRate(ctx.state.metrics, addDays(from, -28), addDays(from, -1)),
  };
  return renderShifts(model, { positionsPath: s.positionsPath, ledger, rate });
}

/* ─── Digest ───────────────────────────────────────────────────────────── */

export interface DigestReport {
  path: string | null;
  items: number;
  alsoNew: number;
  message: string;
}

export async function generateDigest(ctx: Ctx, opts: { dryRun: boolean }): Promise<DigestReport> {
  const s = settingsOf(ctx);
  const now = ctx.env.now();
  const today = localDate(now);
  const target = opts.dryRun ? `${s.digestFolder}/Dry run ${today}` : digestPath(s, today);

  if (!opts.dryRun && (await digestExists(ctx, today))) {
    return { path: target, items: 0, alsoNew: 0, message: "Today's digest already exists." };
  }

  const llm = llmOf(ctx);
  const { candidates, overflow } = await listCandidates(ctx.env.vault, s, ctx.state, now);
  if (!candidates.length) {
    if (!opts.dryRun) {
      ctx.state.lastRunDate = today;
      await ctx.save();
    }
    return { path: null, items: 0, alsoNew: 0, message: 'Nothing new since the last digest.' };
  }

  try {
    const ledger = await readLedger(ctx);
    const rulesMd = await ctx.env.vault.read(s.voiceRulesPath);
    const rules = rulesMd ? activeRuleTexts(parseVoiceRules(rulesMd), s.maxActiveRules) : [];
    const live = livePositions(ledger).map((p) => ({ id: p.id, topic: p.topic, text: p.text }));
    const priors = await buildPriors(ctx.env.vault, s, live, rules);

    const raw = await askJson(llm, buildDigestPrompt({ date: today, candidates, priors, cap: s.dailyCap }), parseDigestResponse);
    const checked = checkDigest(raw, {
      paths: new Set(ctx.env.vault.list().map((n) => n.path)),
      positionIds: new Set(ledger.positions.map((p) => p.id)),
      candidates: new Set(candidates.map((c) => c.path)),
    });

    const taken = new Set<string>();
    const items: DigestItem[] = checked.items.slice(0, s.dailyCap).map((i) => ({
      id: uniqueId('td', 6, taken, ctx.env.newHex),
      title: i.title,
      source: i.source,
      whatsNew: i.whatsNew,
      claims: i.claims,
      take: i.take,
      question: i.question,
      groundedIn: i.groundedIn,
      tension: i.tension,
    }));

    let shifts = '';
    if (isShiftsDay(now, s)) {
      try {
        shifts = await buildShiftsSection(ctx, ledger, llm);
      } catch (err) {
        ctx.env.log('shifts failed; digest continues without it', { error: (err as Error).message });
      }
    }

    const md = renderDigest({ date: today, items, alsoNew: checked.alsoNew, shifts, positionsPath: s.positionsPath });
    await ctx.env.vault.write(target, md);

    if (!opts.dryRun) {
      const drafts: Record<string, DraftRecord> = {};
      for (const { id, whatsNew: _w, ...draft } of items) drafts[id] = draft;
      ctx.state.drafts[today] = drafts;
      for (const c of candidates) ctx.state.handled[c.path] = today;
      for (const p of overflow) ctx.state.handled[p] = today;
      ctx.state.cutoff = now.toISOString();
      ctx.state.lastRunDate = today;
      await ctx.save();
    }
    return {
      path: target,
      items: items.length,
      alsoNew: checked.alsoNew.length,
      message: `${opts.dryRun ? 'Dry run' : 'Digest'} ready: ${items.length} item(s), ${checked.alsoNew.length} also new.`,
    };
  } catch (err) {
    const reason = (err as Error).message;
    if (!opts.dryRun) await ctx.env.vault.write(target, renderFailedDigest(today, reason));
    throw err;
  }
}

/* ─── The daily run ────────────────────────────────────────────────────── */

export async function runDaily(ctx: Ctx): Promise<string> {
  const notes: string[] = [];
  const step = async (name: string, fn: () => Promise<string | null>) => {
    try {
      const line = await fn();
      if (line) notes.push(line);
    } catch (err) {
      ctx.env.log(`${name} failed`, { error: (err as Error).message });
      notes.push(`${name} failed: ${(err as Error).message}`);
    }
  };

  await step('Substack import', async () => {
    const r = await importSubstackRss(ctx);
    return r.written ? `Imported ${r.written} post(s).` : null;
  });
  await step('Harvest', async () => {
    const r = await harvestAll(ctx);
    return r.digests ? `Harvested ${r.takes} take(s) from ${r.digests} digest(s).` : null;
  });
  await step('Positions', async () => {
    const r = await extractPositions(ctx, { dryRun: false });
    return r.added || r.superseded ? `Positions: +${r.added}, ${r.superseded} updated.` : null;
  });
  await step('Voice rules', async () => {
    const n = await learnVoice(ctx);
    return n ? `${n} voice rule(s) proposed.` : null;
  });

  const digest = await generateDigest(ctx, { dryRun: false });
  notes.push(digest.message);
  return notes.join(' ');
}

export { parseDigest };
