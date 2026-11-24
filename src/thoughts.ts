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
    const key = d.target ? `### Adds to [[${d.target}]]` : `### New spark: ${d.title}`;
    groups.set(key, [...(groups.get(key) ?? []), [id, d]]);
  }
  if (!groups.size) return '';
  const blocks = ['## Threads', "%% Tick the bullets to add to your Sparks and Ponderings; they're added on the next run. Edit the text first if you like. Unticked ones are dropped. %%"];
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

type Bullet = { text: string; sources: string[] };

const bulletText = (b: Bullet) => `${b.text.replace(/\s+/g, ' ').trim()} (${b.sources.map((s) => `[[${s}]]`).join(', ')})`;

/**
 * Add bullets to an existing Spark or Pondering, where her template keeps
 * ideas: a Spark's "What's new in my head" list, a Pondering's "Ideas i'm
 * pondering" callout. Anything else gets a dated heading at the end, so
 * free-form notes aren't restructured.
 */
export function addToThread(md: string, bullets: Bullet[], date: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');

  const spark = lines.findIndex((l) => /^##\s+What[’']s new in my head/i.test(l));
  if (spark !== -1) {
    let end = spark + 1;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
    // Keep her text, drop the template's empty "- " placeholder, add after the last line.
    const body = lines.slice(spark + 1, end).filter((l) => !/^\s*-\s*$/.test(l));
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const added = bullets.map((b) => `- ${bulletText(b)}`);
    const rest = lines.slice(end);
    return [...lines.slice(0, spark + 1), ...body, ...added, ...(rest.length ? ['', ...rest] : [])].join('\n');
  }

  const callout = lines.findIndex((l) => /^>\s*\[!faq\][+-]?\s+Ideas i/i.test(l));
  if (callout !== -1) {
    let end = callout + 1;
    while (end < lines.length && lines[end].startsWith('>')) end++;
    // Drop the template's empty placeholder bullet if that's all there is.
    const body = lines.slice(callout + 1, end).filter((l) => !/^>\s*-\s*(I123)?\s*$/.test(l));
    const added = bullets.map((b) => `> - ${bulletText(b)}`);
    return [...lines.slice(0, callout + 1), ...body, ...added, ...lines.slice(end)].join('\n');
  }

  const trimmed = md.replace(/\s*$/, '');
  return `${trimmed}\n\n### Threads (${date})\n${bullets.map((b) => `- ${bulletText(b)}`).join('\n')}\n`;
}

/** A new Spark in her ✨ Spark template, seeded with the ticked bullets. */
export function renderSpark(a: { title: string; oneLiner: string; date: string; bullets: Bullet[] }): string {
  return `---
type: spark
status: open
created: ${a.date}
one_liner: ${JSON.stringify(a.oneLiner.replace(/\s+/g, ' ').trim())}
talk_to: []
---
> Started by Thinking Digest from your notes on ${a.date}. Edit, merge, or delete freely.

# ${a.title}

## What's new in my head
${a.bullets.map((b) => `- ${bulletText(b)}`).join('\n')}

## Why it spikes my interest
- 

## The fringes
The edges I don't understand yet.
- 

## Who I want to talk to about it
Add them to \`talk_to\` above.
- 

## Say it out loud
Three points, one breath each, pause between them. If one doesn't fit in a breath, it's two points.
1. 
2. 
3. 

Word I might get stuck on: 

## Smallest next step
Something I can do in 15 minutes or less.
- [ ] 
`;
}

/* ─── Quick thought ────────────────────────────────────────────────────── */

export function quickThoughtNote(existing: string | null, a: { date: string; time: string; text: string; createdIso: string }): string {
  const bullet = `- ${a.time} ${a.text.replace(/\s+/g, ' ').trim()}`;
  if (existing === null) return `---\ncreated: ${JSON.stringify(a.createdIso)}\n---\n# Thoughts ${a.date}\n\n${bullet}\n`;
  return `${existing.replace(/\s*$/, '')}\n${bullet}\n`;
}
