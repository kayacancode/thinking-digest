import type {
  DigestItem,
  DraftRecord,
  Ledger,
  PluginState,
  Position,
  Post,
  PriorsPack,
  Settings,
  TakeOut,
  Thought,
  ThreadDraft,
} from './types';
import { hashText, normalizeKey } from './types';
import type { Env } from './io';
import { stripFrontmatter } from './io';
import { askJson, createCliLlm, createLlm, type Llm } from './anthropic';
import { parseRss, parseExportZip, postNotePath, renderPostNote, sanitizeTitle } from './substack';
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
  buildPonderingPrompt,
  buildPrepPrompt,
  buildQuestionPrompt,
  buildSayItPrompt,
  parseDigestResponse,
  parseExtractionResponse,
  parsePonderingResponse,
  parsePrepResponse,
  parseQuestionResponse,
  parseSayItResponse,
  parseShiftsResponse,
  parseVoiceResponse,
  type ExerciseContext,
} from './prompts';
import { renderShifts, rewriteRate } from './shifts';
import { isShiftsDay, localDate, weekRange } from './scheduler';
import { buildPriors, inFolder, listCandidates, listMeetings, listThoughts, ownWritingNotes } from './sources';
import {
  type DueMeeting,
  type MeetingNote,
  type PrepModel,
  addPracticeRow,
  checkPrep,
  checkSayIt,
  fillSayIt,
  meetingsDue,
  newMeetingsSince,
  needsSayIt,
  renderPrep,
  seriesKey,
} from './speaking';
import { addToThread, parseTickedThreads, quickThoughtNote, renderSpark, renderThreads } from './thoughts';
import { type Clip, clipPath, extractPage, isXUrl, parseXOembed, renderClipping, xOembedUrl } from './capture';
import {
  type Round,
  appendQuestion,
  appendReadyNote,
  exerciseNoteName,
  markDone,
  parseExercise,
  ponderingNoteName,
  renderNewExercise,
  renderPondering,
} from './exercise';

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
  threadBullets: number; // ticked thread bullets added to Sparks and Ponderings
  sayIt: number; // "Say it out loud" sections drafted
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

/** Add the thread bullets she ticked in a digest to her Sparks and Ponderings, or start new Sparks. */
async function applyThreads(ctx: Ctx, date: string, md: string): Promise<{ added: number; touched: string[] }> {
  const s = settingsOf(ctx);
  const drafts = ctx.state.threadDrafts[date] ?? {};
  const groups = new Map<string, { draft: ThreadDraft; bullets: { text: string; sources: string[] }[] }>();
  for (const { id, text } of parseTickedThreads(md)) {
    const draft = drafts[id];
    if (!draft) continue;
    const key = draft.target ?? `new:${draft.title}`;
    const group = groups.get(key) ?? { draft, bullets: [] };
    group.bullets.push({ text, sources: draft.sources });
    groups.set(key, group);
  }
  let added = 0;
  const touched: string[] = [];
  for (const { draft, bullets } of groups.values()) {
    if (draft.target) {
      const current = await ctx.env.vault.read(draft.target);
      if (current === null) {
        ctx.env.log('note for thread no longer exists; skipped', { target: draft.target });
        continue;
      }
      await ctx.env.vault.write(draft.target, addToThread(current, bullets, date));
      touched.push(draft.target);
    } else {
      const path = await uniqueNotePath(ctx, `${s.sparksFolder}/${sanitizeTitle(draft.title, 100) || 'Untitled spark'}`);
      await ctx.env.vault.write(path, renderSpark({ title: draft.title, oneLiner: draft.oneLiner, date, bullets }));
      touched.push(path);
    }
    added += bullets.length;
  }
  return { added, touched };
}

export async function harvestAll(ctx: Ctx): Promise<HarvestReport> {
  const s = settingsOf(ctx);
  const today = localDate(ctx.env.now());
  const report: HarvestReport = { digests: 0, takes: 0, rejected: 0, rewrote: 0, threadBullets: 0, sayIt: 0 };
  const touched: string[] = [];
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
        const threads = await applyThreads(ctx, date, md);
        report.threadBullets += threads.added;
        touched.push(...threads.touched);
      }
      ctx.state.harvested.push(date);
      delete ctx.state.threadDrafts[date];
      report.digests++;
    } catch (err) {
      ctx.env.log('harvest failed for digest', { date, error: (err as Error).message });
    }
  }
  report.sayIt = await fillSayItAll(ctx, [...new Set(touched)]);

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
    } else if (inFolder(meta.path, s.sparksFolder) && meta.frontmatter?.['status'] !== 'archived') {
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
  const { thoughts, snapshot } = await listThoughts(ctx.env.vault, s, ctx.state, now);
  const meetingNotes = s.meetingPrep ? listMeetings(ctx.env.vault, s) : [];
  const due = meetingsDue(meetingNotes, today);
  if (!candidates.length && !thoughts.length && !due.length) {
    if (!opts.dryRun) {
      ctx.state.lastRunDate = today;
      ctx.state.thoughtSeen = { ...ctx.state.thoughtSeen, ...snapshot };
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

    const vaultPaths = ctx.env.vault.list().map((n) => n.path);
    const positionIds = new Set(ledger.positions.map((p) => p.id));
    const ownWords = new Set([
      ...ownWritingNotes(ctx.env.vault, s).map((n) => n.path),
      ...thoughts.map((t) => t.path),
      ...candidates.filter((c) => /\[!take\]\s*My first reaction/i.test(c.excerpt)).map((c) => c.path),
    ]);
    const raw =
      candidates.length || thoughts.length
        ? await askJson(llm, buildDigestPrompt({ date: today, candidates, priors, cap: s.dailyCap, thoughts }), parseDigestResponse)
        : { items: [], alsoNew: [], threads: [] };
    const checked = checkDigest(raw, {
      paths: new Set(vaultPaths),
      positionIds,
      candidates: new Set(candidates.map((c) => c.path)),
      threadTargets: new Set(
        ctx.env.vault
          .list()
          .filter((n) => inFolder(n.path, s.ponderingFolder) || (inFolder(n.path, s.sparksFolder) && n.frontmatter?.['status'] !== 'archived'))
          .map((n) => n.path),
      ),
      ownWords,
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

    const threadDrafts: Record<string, ThreadDraft> = {};
    const threadIds = new Set<string>();
    for (const t of checked.threads) {
      for (const b of t.bullets) {
        threadDrafts[uniqueId('th', 4, threadIds, ctx.env.newHex)] = { target: t.target, title: t.title, oneLiner: t.oneLiner, text: b.text, sources: b.sources };
      }
    }

    let prep: PrepModel[] = [];
    if (due.length) {
      try {
        prep = await buildPrep(ctx, llm, due, meetingNotes, priors, thoughts, ownWords, positionIds);
      } catch (err) {
        ctx.env.log('meeting prep failed; digest continues without it', { error: (err as Error).message });
      }
    }
    let shifts = '';
    if (isShiftsDay(now, s)) {
      try {
        shifts = await buildShiftsSection(ctx, ledger, llm);
      } catch (err) {
        ctx.env.log('shifts failed; digest continues without it', { error: (err as Error).message });
      }
    }

    const extras = [renderThreads(threadDrafts), shifts].filter((x) => x.trim() !== '').join('\n\n');
    const md = renderDigest({
      date: today,
      prep: renderPrep(prep, due, { practicePath: s.speakingPracticePath, positionsPath: s.positionsPath }),
      items,
      alsoNew: checked.alsoNew,
      shifts: extras,
      positionsPath: s.positionsPath,
    });
    await ctx.env.vault.write(target, md);

    if (!opts.dryRun) {
      const drafts: Record<string, DraftRecord> = {};
      for (const { id, whatsNew: _w, ...draft } of items) drafts[id] = draft;
      ctx.state.drafts[today] = drafts;
      ctx.state.threadDrafts[today] = threadDrafts;
      if (prep.length) {
        ctx.state.prepped[today] = prep.flatMap((p) => {
          const d = due.find((x) => x.key === p.meeting);
          return d ? [{ key: d.key, title: d.title, keys: d.keys }] : [];
        });
      }
      ctx.state.thoughtSeen = { ...ctx.state.thoughtSeen, ...snapshot };
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
      message: `${opts.dryRun ? 'Dry run' : 'Digest'} ready: ${items.length} item(s), ${checked.alsoNew.length} also new, ${Object.keys(threadDrafts).length} thread bullet(s), ${prep.length} meeting prep(s).`,
    };
  } catch (err) {
    const reason = (err as Error).message;
    if (!opts.dryRun) await ctx.env.vault.write(target, renderFailedDigest(today, reason));
    throw err;
  }
}

const PREP_LAST_CHARS = 1500;
const PREP_NEW_CHARS = 2400; // half from the start (what they do), half from the end (next steps, deadlines)

async function buildPrep(
  ctx: Ctx,
  llm: Llm,
  due: DueMeeting[],
  meetingNotes: MeetingNote[],
  priors: PriorsPack,
  thoughts: Thought[],
  ownWords: Set<string>,
  positionIds: Set<string>,
): Promise<PrepModel[]> {
  const excerpt = async (path: string, chars: number) => {
    // Granola notes end with screenshot embeds; drop them so the tail is the Next Steps.
    const body = stripFrontmatter((await ctx.env.vault.read(path)) ?? '')
      .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return body.length <= chars ? body : `${body.slice(0, chars / 2)}\n[…]\n${body.slice(-chars / 2)}`;
  };
  const today = localDate(ctx.env.now());
  const meetings = [];
  const fresh = new Map<string, Set<string>>();
  for (const d of due) {
    const lastInstances = [];
    for (const path of d.lastPaths) lastInstances.push({ path, excerpt: await excerpt(path, PREP_LAST_CHARS) });
    const newMeetings = [];
    for (const m of newMeetingsSince(meetingNotes, d, today)) newMeetings.push({ ...m, excerpt: await excerpt(m.path, PREP_NEW_CHARS) });
    fresh.set(d.key, new Set(newMeetings.map((m) => m.path)));
    meetings.push({ key: d.key, title: d.title, lastInstances, newMeetings });
  }
  const raw = await askJson(llm, buildPrepPrompt({ meetings, priors, thoughts }), parsePrepResponse);
  return checkPrep(raw.prep, due, ownWords, positionIds, fresh);
}

/* ─── Speaking practice ────────────────────────────────────────────────── */

/** The "Say it out loud for this note" command. */
export async function sayItOutLoud(ctx: Ctx, path: string): Promise<string> {
  const md = await ctx.env.vault.read(path);
  if (md === null) throw new Error(`Can't find ${path}.`);
  if (!needsSayIt(md)) return 'This note already has your talking points; nothing changed.';
  return (await fillSayItIfBlank(ctx, path)) ? 'Drafted "Say it out loud". Edit it freely.' : 'Couldn’t draft talking points for this note.';
}

/**
 * Draft "Say it out loud" for a Spark or Pondering whose points are still
 * blank. Never touches points she's written. Returns true when it wrote.
 */
async function fillSayItIfBlank(ctx: Ctx, path: string): Promise<boolean> {
  const md = await ctx.env.vault.read(path);
  if (md === null || !needsSayIt(md)) return false;
  const s = settingsOf(ctx);
  const rulesMd = await ctx.env.vault.read(s.voiceRulesPath);
  const voiceRules = rulesMd ? activeRuleTexts(parseVoiceRules(rulesMd), s.maxActiveRules) : [];
  const body = stripFrontmatter(md).replace(/%%[\s\S]*?%%/g, '').trim();
  const title = path.split('/').pop() ?? path;
  const say = checkSayIt(await askJson(llmOf(ctx), buildSayItPrompt({ title, body, voiceRules }), parseSayItResponse));
  if (!say) return false;
  // She may have edited while the model ran; only write if the note is unchanged.
  if ((await ctx.env.vault.read(path)) !== md) return false;
  await ctx.env.vault.write(path, fillSayIt(md, say));
  return true;
}

/** Draft "Say it out loud" on each note, logging (not throwing) failures. */
async function fillSayItAll(ctx: Ctx, paths: string[]): Promise<number> {
  let n = 0;
  for (const path of paths) {
    try {
      if (await fillSayItIfBlank(ctx, path)) n++;
    } catch (err) {
      ctx.env.log('say it out loud failed', { path, error: (err as Error).message });
    }
  }
  return n;
}

const PRACTICE_LOG_DAYS = 3;

/**
 * After a prepped meeting happens (its note shows up), add a row for it to the
 * Speaking Practice log, Setting filled in. Prepped meetings with no note after
 * a few days are dropped.
 */
export async function logPractice(ctx: Ctx): Promise<number> {
  const s = settingsOf(ctx);
  const today = localDate(ctx.env.now());
  const dates = Object.keys(ctx.state.prepped).filter((d) => d < today).sort();
  if (!dates.length) return 0;
  const meetings = listMeetings(ctx.env.vault, s);
  let added = 0;
  for (const date of dates) {
    const left: PluginState['prepped'][string] = [];
    for (const p of ctx.state.prepped[date]) {
      const note = meetings
        .filter((m) => m.date === date && p.keys.includes(seriesKey(m.title)))
        .sort((a, b) => a.created.localeCompare(b.created))[0];
      if (!note) {
        left.push(p);
        continue;
      }
      const md = await ctx.env.vault.read(s.speakingPracticePath);
      const next = md === null ? null : addPracticeRow(md, { date, meetingPath: note.path, title: p.title });
      if (next !== null) {
        await ctx.env.vault.write(s.speakingPracticePath, next);
        added++;
      }
    }
    if (left.length && addDays(date, PRACTICE_LOG_DAYS) >= today) ctx.state.prepped[date] = left;
    else delete ctx.state.prepped[date];
  }
  await ctx.save();
  return added;
}

/* ─── Capture ──────────────────────────────────────────────────────────── */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export interface CaptureReport {
  path: string;
  bodyRead: boolean;
}

async function fetchClip(ctx: Ctx, url: string): Promise<Clip> {
  const { hostname, pathname } = new URL(url);
  const title = `${hostname.replace(/^www\./, '')}${pathname.replace(/\/+$/, '').replace(/\//g, ' ')}`;
  const fallback: Clip = { url, title, author: '', site: hostname, published: '', html: '' };
  try {
    if (isXUrl(url)) {
      const res = await ctx.env.http({ url: xOembedUrl(url) });
      return res.status === 200 ? parseXOembed(res.text, url) : fallback;
    }
    const res = await ctx.env.http({ url, headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml' } });
    return res.status < 400 ? extractPage(res.text, url) : fallback;
  } catch (err) {
    ctx.env.log('fetch failed; saving the link only', { url, error: (err as Error).message });
    return fallback;
  }
}

/** Save any URL into the clippings folder; `note` is an optional first reaction. */
export async function addLink(ctx: Ctx, url: string, note: string): Promise<CaptureReport> {
  const clean = url.trim();
  if (!/^https?:\/\/\S+$/i.test(clean)) throw new Error('That doesn’t look like a link (it needs http:// or https://).');
  const clip = await fetchClip(ctx, clean);
  const path = await uniqueNotePath(ctx, clipPath(clip, settingsOf(ctx).clippingsFolder));
  await ctx.env.vault.write(path, renderClipping(clip, ctx.env.toMarkdown, ctx.env.now().toISOString(), note));
  return { path, bodyRead: clip.html !== '' };
}

/* ─── Thinking exercise ────────────────────────────────────────────────── */

const FALLBACK_QUESTION = "what's the actual claim here, and do you buy it?";

async function exerciseContext(ctx: Ctx, sourcePath: string, rounds: Round[]): Promise<ExerciseContext> {
  const s = settingsOf(ctx);
  const md = await ctx.env.vault.read(sourcePath);
  if (md === null) throw new Error(`Can't find ${sourcePath}.`);
  const meta = ctx.env.vault.list().find((n) => n.path === sourcePath);
  const fmTitle = meta?.frontmatter?.['title'];
  const ledger = await readLedger(ctx);
  return {
    title: typeof fmTitle === 'string' && fmTitle.trim() ? fmTitle.trim() : sourcePath.split('/').pop() ?? sourcePath,
    sourcePath,
    excerpt: stripFrontmatter(md).trim().slice(0, s.excerptChars),
    positions: livePositions(ledger).map((p) => ({ id: p.id, topic: p.topic, text: p.text })),
    rounds,
    maxRounds: s.maxRounds,
  };
}

/** Start (or reopen) a thinking exercise about a note. Returns the exercise path. */
export async function startExercise(ctx: Ctx, sourcePath: string): Promise<string> {
  const s = settingsOf(ctx);
  const open = ctx.env.vault
    .list()
    .find(
      (n) =>
        inFolder(n.path, s.exerciseFolder) &&
        n.frontmatter?.['status'] === 'open' &&
        n.frontmatter?.['source'] === `[[${sourcePath}]]`,
    );
  if (open) return open.path;

  const ec = await exerciseContext(ctx, sourcePath, []);
  const first = await askJson(llmOf(ctx), buildQuestionPrompt(ec), parseQuestionResponse);
  const today = localDate(ctx.env.now());
  const path = await uniqueNotePath(ctx, `${s.exerciseFolder}/${exerciseNoteName(ec.title, today)}`);
  await ctx.env.vault.write(
    path,
    renderNewExercise({ source: sourcePath, title: ec.title, date: today, question: first.question ?? FALLBACK_QUESTION }),
  );
  return path;
}

export async function nextQuestion(ctx: Ctx, exercisePath: string): Promise<{ done: boolean }> {
  const md = await ctx.env.vault.read(exercisePath);
  if (md === null) throw new Error(`Can't find ${exercisePath}.`);
  const ex = parseExercise(md);
  if (!ex.source) throw new Error('This note isn’t a thinking exercise.');
  if (ex.status === 'done') throw new Error('This exercise is already finished.');
  const last = ex.rounds[ex.rounds.length - 1];
  if (last && !last.answer) throw new Error('Answer the last question first (write under it).');

  const ec = await exerciseContext(ctx, ex.source, ex.rounds);
  const resp = ex.rounds.length >= ec.maxRounds ? { done: true, question: null } : await askJson(llmOf(ctx), buildQuestionPrompt(ec), parseQuestionResponse);
  if (resp.done || !resp.question) {
    await ctx.env.vault.write(exercisePath, appendReadyNote(md));
    return { done: true };
  }
  await ctx.env.vault.write(exercisePath, appendQuestion(md, ex.rounds.length + 1, resp.question));
  return { done: false };
}

/** Write the answers up as a Pondering in her voice. Returns the pondering path. */
export async function finishExercise(ctx: Ctx, exercisePath: string): Promise<string> {
  const s = settingsOf(ctx);
  const md = await ctx.env.vault.read(exercisePath);
  if (md === null) throw new Error(`Can't find ${exercisePath}.`);
  const ex = parseExercise(md);
  if (!ex.source) throw new Error('This note isn’t a thinking exercise.');
  if (ex.status === 'done') throw new Error('This exercise is already finished.');
  const answered = ex.rounds.filter((r) => r.answer);
  if (!answered.length) throw new Error('Answer at least one question first.');

  const ec = await exerciseContext(ctx, ex.source, answered);
  const draft = await askJson(llmOf(ctx), buildPonderingPrompt(ec), parsePonderingResponse);
  const ledger = await readLedger(ctx);
  const ids = new Set(ledger.positions.map((p) => p.id));
  const related = draft.relatedPositions.filter((id) => ids.has(id)).map((id) => `${s.positionsPath}#^${id}`);
  const peopleLinks: Record<string, string> = {};
  for (const name of draft.people) {
    const page = [`${s.peopleFolder}/p- ${name}`, `${s.peopleFolder}/${name}`].find((p) => ctx.env.vault.exists(p));
    if (page) peopleLinks[name] = page;
  }

  const path = await uniqueNotePath(ctx, `${s.ponderingFolder}/${ponderingNoteName(draft.title)}`);
  await ctx.env.vault.write(
    path,
    renderPondering({ draft, date: localDate(ctx.env.now()), source: ex.source, exercise: exercisePath, related, peopleLinks }),
  );
  await ctx.env.vault.write(exercisePath, markDone(md, path));
  await fillSayItAll(ctx, [path]);
  try {
    await extractPositions(ctx, { dryRun: false });
  } catch (err) {
    ctx.env.log('positions update after exercise failed', { error: (err as Error).message });
  }
  return path;
}

/* ─── Quick thought ────────────────────────────────────────────────────── */

/** Append one timestamped line to today's thoughts note in the first quick-notes folder. */
export async function addQuickThought(ctx: Ctx, text: string): Promise<string> {
  const clean = text.trim();
  if (!clean) throw new Error('Type a thought first.');
  const now = ctx.env.now();
  const date = localDate(now);
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const folder = settingsOf(ctx).thoughtFolders[0];
  if (!folder) throw new Error('Add a quick-notes folder in Thinking Digest settings first.');
  const path = `${folder}/Thoughts ${date}`;
  const existing = await ctx.env.vault.read(path);
  await ctx.env.vault.write(path, quickThoughtNote(existing, { date, time, text: clean, createdIso: now.toISOString() }));
  return path;
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
    if (!r.digests) return null;
    const threads = r.threadBullets ? ` Added ${r.threadBullets} thread bullet(s) to your Sparks and Ponderings.` : '';
    const say = r.sayIt ? ` Drafted "Say it out loud" on ${r.sayIt} note(s).` : '';
    return `Harvested ${r.takes} take(s) from ${r.digests} digest(s).${threads}${say}`;
  });
  await step('Practice log', async () => {
    const n = await logPractice(ctx);
    return n ? `Added ${n} meeting(s) to your speaking practice log.` : null;
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
