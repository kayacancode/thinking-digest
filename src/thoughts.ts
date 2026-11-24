import { hashText, type Thought, type ThreadDraft } from './types';

const NEW_CHARS = 4000;
const EARLIER_CHARS = 1500;

/** A note is off-limits when tagged #<tag> (frontmatter tags or inline) or has `<tag>: true`. */
export function isPrivateNote(frontmatter: Record<string, unknown> | null, body: string, tag: string): boolean {
  if (!tag) return false;
  if (frontmatter?.[tag] === true) return true;
  const tags = frontmatter?.['tags'];
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,\s]+/) : [];
  if (list.some((t) => String(t).replace(/^#/, '').toLowerCase() === tag.toLowerCase())) return true;
  return new RegExp(`(^|\\s)#${tag}(\\b|$)`, 'i').test(body);
}

function contentLines(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of body.split('\n')) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    const line = raw.trimEnd();
    if (!inFence && line.trim() !== '') out.push(line);
  }
  return out;
}

/**
 * What's new in a quick note since the last run: lines whose hash wasn't seen.
 * Works for notes edited across several days, where creation time says nothing.
 * Returns null when nothing new was written.
 */
export function diffThought(path: string, title: string, body: string, seen: string[]): Thought | null {
  const lines = contentLines(body);
  const seenSet = new Set(seen);
  const hashes = lines.map((l) => hashText(l.trim()));
  const fresh = lines.filter((_, i) => !seenSet.has(hashes[i]));
  if (!fresh.length) return null;
  const earlier = lines.filter((_, i) => seenSet.has(hashes[i]));
  return {
    path,
    title,
    newText: fresh.join('\n').slice(0, NEW_CHARS),
    earlierText: earlier.join('\n').slice(-EARLIER_CHARS),
    lineHashes: hashes,
  };
}

/* ─── Threads section in the digest ────────────────────────────────────── */

const THREAD_LINE = /^- \[( |x|X)\] (.*?)\s*\^(th-[0-9a-f]{4})\s*$/;

export function renderThreads(drafts: Record<string, ThreadDraft>): string {
  const groups = new Map<string, [string, ThreadDraft][]>();
  for (const [id, d] of Object.entries(drafts)) {
    const key = d.pondering ? `### Adds to [[${d.pondering}]]` : `### New pondering: ${d.title}`;
    groups.set(key, [...(groups.get(key) ?? []), [id, d]]);
  }
  if (!groups.size) return '';
  const blocks = ['## Threads', "%% Tick the bullets to add to your Ponderings; they're added on the next run. Edit the text first if you like. Unticked ones are dropped. %%"];
  for (const [heading, items] of groups) {
    blocks.push(
      [heading, ...items.map(([id, d]) => `- [ ] ${d.text.replace(/\s+/g, ' ').trim()} · ${d.sources.map((s) => `[[${s}]]`).join(', ')} ^${id}`)].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** Ticked thread bullets, with her edited text (the source links after " · " are dropped). */
export function parseTickedThreads(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(THREAD_LINE);
    if (!m || m[1] === ' ') continue;
    const text = m[2].replace(/\s*·\s*(\[\[[^\]]+\]\](,\s*)?)+$/, '').trim();
    if (text) out.push({ id: m[3], text });
  }
  return out;
}

/**
 * Add bullets to an existing Pondering: inside its "Ideas i'm pondering"
 * callout when it has one (her template), otherwise under a dated heading at
 * the end, so older free-form Ponderings aren't restructured.
 */
export function addToPondering(md: string, bullets: { text: string; sources: string[] }[], date: string): string {
  const line = (b: { text: string; sources: string[] }) =>
    `${b.text.replace(/\s+/g, ' ').trim()} (${b.sources.map((s) => `[[${s}]]`).join(', ')})`;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^>\s*\[!faq\][+-]?\s+Ideas i/i.test(l));
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && lines[end].startsWith('>')) end++;
    // Drop the template's empty placeholder bullet if that's all there is.
    const body = lines.slice(start + 1, end).filter((l) => !/^>\s*-\s*(I123)?\s*$/.test(l));
    const added = bullets.map((b) => `> - ${line(b)}`);
    return [...lines.slice(0, start + 1), ...body, ...added, ...lines.slice(end)].join('\n');
  }
  const trimmed = md.replace(/\s*$/, '');
  return `${trimmed}\n\n### Threads (${date})\n${bullets.map((b) => `- ${line(b)}`).join('\n')}\n`;
}

/* ─── Quick thought ────────────────────────────────────────────────────── */

export function quickThoughtNote(existing: string | null, a: { date: string; time: string; text: string; createdIso: string }): string {
  const bullet = `- ${a.time} ${a.text.replace(/\s+/g, ' ').trim()}`;
  if (existing === null) return `---\ncreated: ${JSON.stringify(a.createdIso)}\n---\n# Thoughts ${a.date}\n\n${bullet}\n`;
  return `${existing.replace(/\s*$/, '')}\n${bullet}\n`;
}
