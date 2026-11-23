import type { Candidate, PluginState, PriorNote, PriorsPack, Settings } from './types';
import type { NoteMeta, VaultIO } from './io';
import { stripFrontmatter } from './io';

const MAX_CANDIDATES = 25;
const PRIOR_BODY_CHARS = 1500;
const MAX_TAKES = 40;

export function inFolder(path: string, folder: string): boolean {
  return path.startsWith(folder.replace(/\/+$/, '') + '/');
}

function createdOf(note: NoteMeta): string {
  const fm = note.frontmatter?.['created'];
  if (typeof fm === 'string' && !Number.isNaN(Date.parse(fm))) return new Date(fm).toISOString();
  return new Date(note.ctime).toISOString();
}

function titleOf(note: NoteMeta): string {
  const t = note.frontmatter?.['title'];
  return typeof t === 'string' && t.trim() ? t.trim() : note.path.split('/').pop() ?? note.path;
}

/**
 * New notes in the source folders since the cutoff, newest first, capped.
 * "New" is frontmatter `created` (Granola re-syncs rewrite mtimes), falling
 * back to file creation time. Returns the overflow beyond the cap separately
 * so the caller can mark it handled instead of letting it pile up.
 */
export async function listCandidates(
  vault: VaultIO,
  settings: Settings,
  state: PluginState,
  now: Date,
): Promise<{ candidates: Candidate[]; overflow: string[] }> {
  const cutoff = state.cutoff ?? new Date(now.getTime() - settings.lookbackDays * 86_400_000).toISOString();
  const fresh = vault
    .list()
    .filter((n) => settings.sourceFolders.some((f) => inFolder(n.path, f)))
    .filter((n) => !settings.excludedFolders.some((f) => inFolder(n.path, f)))
    .filter((n) => !(n.path in state.handled))
    .map((n) => ({ note: n, created: createdOf(n) }))
    .filter((x) => x.created > cutoff)
    .sort((a, b) => b.created.localeCompare(a.created));

  const candidates: Candidate[] = [];
  for (const { note, created } of fresh.slice(0, MAX_CANDIDATES)) {
    const body = stripFrontmatter((await vault.read(note.path)) ?? '').trim();
    if (!body) continue;
    candidates.push({
      path: note.path,
      title: titleOf(note),
      created,
      kind: inFolder(note.path, 'Granola notes') ? 'meeting' : inFolder(note.path, 'Clippings') ? 'clipping' : 'other',
      excerpt: body.slice(0, settings.excerptChars),
    });
  }
  return { candidates, overflow: fresh.slice(MAX_CANDIDATES).map((x) => x.note.path) };
}

function priorKind(path: string, settings: Settings): PriorNote['kind'] | null {
  if (inFolder(path, settings.writingFolder)) return 'post';
  if (inFolder(path, settings.takesFolder)) return 'take';
  if (inFolder(path, 'Pondering')) return 'pondering';
  if (inFolder(path, 'Beliefs')) return 'belief';
  if (settings.priorFolders.some((f) => inFolder(path, f))) return 'spark';
  return null;
}

/** Notes of Kaya's own writing that can be extraction sources or priors. */
export function ownWritingNotes(vault: VaultIO, settings: Settings): NoteMeta[] {
  return vault.list().filter((n) => {
    const kind = priorKind(n.path, settings);
    if (!kind) return false;
    if (kind === 'spark' && n.frontmatter?.['status'] === 'archived') return false;
    if (n.path.split('/').pop()?.startsWith('Dry run')) return false;
    return true;
  });
}

export async function buildPriors(
  vault: VaultIO,
  settings: Settings,
  positions: PriorsPack['positions'],
  voiceRules: string[],
): Promise<PriorsPack> {
  const notes: PriorNote[] = [];
  const takes: PriorNote[] = [];
  for (const meta of ownWritingNotes(vault, settings)) {
    const kind = priorKind(meta.path, settings);
    if (!kind) continue;
    const body = stripFrontmatter((await vault.read(meta.path)) ?? '')
      .replace(/%%[\s\S]*?%%/g, '')
      .trim()
      .slice(0, PRIOR_BODY_CHARS);
    if (!body) continue;
    const note: PriorNote = { path: meta.path, title: titleOf(meta), kind, body };
    if (kind === 'take') {
      const verdict = meta.frontmatter?.['verdict'];
      if (verdict === 'kept' || verdict === 'rewrote' || verdict === 'answered') note.verdict = verdict;
      takes.push(note);
    } else {
      notes.push(note);
    }
  }
  // Newest takes, rewrites first: rewrites are where the draft got her wrong.
  takes.sort((a, b) => b.path.localeCompare(a.path));
  const recent = takes.slice(0, MAX_TAKES);
  recent.sort((a, b) => Number(b.verdict === 'rewrote') - Number(a.verdict === 'rewrote'));
  return { voiceRules, positions, notes: [...notes, ...recent] };
}
