/**
 * Headless harness: runs the real pipeline against a vault on disk without
 * Obsidian. Reads come from the vault; EVERY write goes to a sandbox folder
 * (reads check the sandbox first), so the vault itself is never modified.
 *
 *   ANTHROPIC_API_KEY=… DATE=YYYY-MM-DD npx tsx scripts/run.ts <vault> <sandbox> <command> [arg] [note]
 *   commands: import | positions-dry | positions | digest-dry | digest | harvest | daily
 *             addlink <url> [note] | think <source path> | next <exercise path> | finish <exercise path>
 *   DATE overrides "now" (local 08:00 on that date). Without ANTHROPIC_API_KEY the Claude CLI is used.
 */
import { promises as fs, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { parse as parseYaml } from 'yaml';
import { EMPTY_STATE, type PluginState } from '../src/types';
import type { Env, NoteMeta, VaultIO } from '../src/io';
import { randomHex } from '../src/io';
import { findClaudeCli, nodeExec } from '../src/exec';
import {
  addLink,
  extractPositions,
  finishExercise,
  generateDigest,
  harvestAll,
  importSubstackRss,
  nextQuestion,
  runDaily,
  startExercise,
  type Ctx,
} from '../src/pipeline';

const [vaultRoot, sandbox, command, arg = '', note = ''] = process.argv.slice(2);
const dateArg = process.env.DATE;
if (!vaultRoot || !sandbox || !command) {
  console.error('usage: tsx scripts/run.ts <vault> <sandbox> <command> [arg] [note]');
  process.exit(2);
}

(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;

function frontmatterOf(md: string): Record<string, unknown> | null {
  if (!md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return null;
  try {
    const fm = parseYaml(md.slice(4, end)) as unknown;
    return fm && typeof fm === 'object' ? (fm as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function walk(root: string, out: string[] = [], rel = ''): string[] {
  for (const name of readdirSync(path.join(root, rel))) {
    if (name.startsWith('.')) continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(path.join(root, r));
    if (st.isDirectory()) walk(root, out, r);
    else if (name.endsWith('.md')) out.push(r.slice(0, -3));
  }
  return out;
}

async function overlayVault(): Promise<VaultIO> {
  const metas = new Map<string, NoteMeta>();
  const load = async (root: string) => {
    if (!existsSync(root)) return;
    for (const p of walk(root)) {
      const file = path.join(root, `${p}.md`);
      const md = await fs.readFile(file, 'utf8');
      metas.set(p, { path: p, ctime: statSync(file).birthtimeMs, frontmatter: frontmatterOf(md) });
    }
  };
  await load(vaultRoot);
  await load(sandbox);
  const file = (root: string, p: string) => path.join(root, `${p}.md`);
  return {
    list: () => [...metas.values()],
    async read(p) {
      for (const root of [sandbox, vaultRoot]) {
        if (existsSync(file(root, p))) return fs.readFile(file(root, p), 'utf8');
      }
      return null;
    },
    async write(p, content) {
      await fs.mkdir(path.dirname(file(sandbox, p)), { recursive: true });
      await fs.writeFile(file(sandbox, p), content);
      metas.set(p, { path: p, ctime: Date.now(), frontmatter: frontmatterOf(content) });
    },
    exists: (p) => metas.has(p),
  };
}

async function main(): Promise<void> {
  const statePath = path.join(sandbox, 'data.json');
  const saved = existsSync(statePath) ? (JSON.parse(await fs.readFile(statePath, 'utf8')) as Partial<PluginState>) : {};
  const base = EMPTY_STATE();
  const state: PluginState = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings ?? {}) } };
  if (process.env.ANTHROPIC_API_KEY) {
    state.settings.provider = 'api';
    state.settings.apiKey = process.env.ANTHROPIC_API_KEY;
  } else {
    state.settings.provider = 'cli';
  }
  if (process.env.MODEL) state.settings.model = process.env.MODEL;

  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const now = dateArg ? () => new Date(`${dateArg}T08:00:00`) : () => new Date();
  const env: Env = {
    vault: await overlayVault(),
    http: async (req) => {
      const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body });
      return { status: res.status, text: await res.text() };
    },
    exec: nodeExec,
    cliPath: findClaudeCli(state.settings.cliPath),
    toMarkdown: (html) => turndown.turndown(html),
    now,
    newHex: randomHex,
    log: (msg, extra) => console.error(`[thinking-digest] ${msg}`, extra ?? ''),
  };
  await fs.mkdir(sandbox, { recursive: true });
  const ctx: Ctx = { env, state, save: () => fs.writeFile(statePath, JSON.stringify(state, null, 2)) };

  const t0 = Date.now();
  let result: unknown;
  switch (command) {
    case 'import': result = await importSubstackRss(ctx); break;
    case 'positions-dry': result = await extractPositions(ctx, { dryRun: true }); break;
    case 'positions': result = await extractPositions(ctx, { dryRun: false }); break;
    case 'digest-dry': result = await generateDigest(ctx, { dryRun: true }); break;
    case 'digest': result = await generateDigest(ctx, { dryRun: false }); break;
    case 'harvest': result = await harvestAll(ctx); break;
    case 'daily': result = await runDaily(ctx); break;
    case 'addlink': result = await addLink(ctx, arg, note); break;
    case 'think': result = await startExercise(ctx, arg); break;
    case 'next': result = await nextQuestion(ctx, arg); break;
    case 'finish': result = await finishExercise(ctx, arg); break;
    default: throw new Error(`unknown command ${command}`);
  }
  console.log(JSON.stringify({ command, provider: state.settings.provider, seconds: Math.round((Date.now() - t0) / 1000), result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
