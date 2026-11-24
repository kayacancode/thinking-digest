import type { Candidate, PluginState, PriorNote, PriorsPack, Settings, Thought } from './types';
import { hashText } from './types';
import type { NoteMeta, VaultIO } from './io';
import { stripFrontmatter } from './io';
import { diffThought, isPrivateNote } from './thoughts';
import { localDate } from './scheduler';
import type { MeetingNote } from './speaking';

const THOUGHT_WINDOW_MS = 7 * 86_400_000;
const MAX_THOUGHT_NOTES = 15;

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
      kind: candidateKind(note, settings),
      excerpt: body.slice(0, settings.excerptChars),
    });
  }
  return { candidates, overflow: fresh.slice(MAX_CANDIDATES).map((x) => x.note.path) };
}

function candidateKind(note: NoteMeta, settings: Settings): Candidate['kind'] {
  const fm = note.frontmatter ?? {};
  if ('granola_id' in fm || 'attendees' in fm) return 'meeting';
  if (inFolder(note.path, settings.clippingsFolder) || typeof fm['source'] === 'string') return 'clipping';
  return 'other';
}

function priorKind(path: string, settings: Settings): PriorNote['kind'] | null {
  if (inFolder(path, settings.writingFolder)) return 'post';
  if (inFolder(path, settings.takesFolder)) return 'take';
  if (inFolder(path, settings.ponderingFolder)) return 'pondering';
  if (inFolder(path, settings.sparksFolder)) return 'spark';
  if (settings.priorFolders.some((f) => inFolder(path, f))) return 'note';
  return null;
}

/** Her meeting notes (Granola-style frontmatter) in the source folders, with local dates and titles. */
export function listMeetings(vault: VaultIO, settings: Settings): MeetingNote[] {
  return vault
    .list()
    .filter((n) => settings.sourceFolders.some((f) => inFolder(n.path, f)))
    .filter((n) => !settings.excludedFolders.some((f) => inFolder(n.path, f)))
    .filter((n) => candidateKind(n, settings) === 'meeting')
    .map((n) => {
      const created = createdOf(n);
      return { path: n.path, title: titleOf(n).replace(/^\d{4}-\d{2}-\d{2},\s*/, ''), date: localDate(new Date(created)), created };
    });
}

export interface ThoughtScan {
  thoughts: Thought[];
  /** Line hashes for every readable quick note; saved after a successful digest. */
  snapshot: Record<string, string[]>;
}

/**
 * Her quick notes, as new text since the last digest. A note seen for the first
 * time counts as new only if edited in the last 7 days; older ones are taken as
 * already read, so the first run doesn't dump months of notes on the model.
 * Private notes are skipped and never enter the snapshot.
 */
export async function listThoughts(vault: VaultIO, settings: Settings, state: PluginState, now: Date): Promise<ThoughtScan> {
  const notes = vault
    .list()
    .filter((n) => settings.thoughtFolders.some((f) => inFolder(n.path, f)))
    .sort((a, b) => b.mtime - a.mtime);
  const thoughts: Thought[] = [];
  const snapshot: Record<string, string[]> = {};
  for (const note of notes) {
    const raw = await vault.read(note.path);
    if (raw === null) continue;
    const body = stripFrontmatter(raw);
    if (isPrivateNote(note.frontmatter, body, settings.privateTag)) continue;
    const fresh = !(note.path in state.thoughtSeen) && now.getTime() - note.mtime > THOUGHT_WINDOW_MS;
    const seen = fresh ? body.split('\n').map((l) => hashText(l.trim())) : state.thoughtSeen[note.path] ?? [];
    const thought = diffThought(note.path, titleOf(note), body, seen);
    snapshot[note.path] = thought?.lineHashes ?? seen;
    if (thought && thoughts.length < MAX_THOUGHT_NOTES) thoughts.push(thought);
  }
  return { thoughts, snapshot };
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
