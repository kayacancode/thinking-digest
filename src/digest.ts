import type { AlsoNewModel, DigestItem, ParsedDigestItem } from './types';

const POS_ID = /^pos-[0-9a-f]{4}$/;
const ITEM_HEADING = /^##\s+.*\^(td-[0-9a-f]{6})\s*$/;
const SECTION_HEADING = /^#{1,2}\s/;
const TAKE_CALLOUT = /^>\s*\[!take\]/i;
const ANSWER_LABEL = '**My answer:**';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wikilink for a citation target: a position block id or a vault path. */
export function targetLink(target: string, positionsPath: string): string {
  return POS_ID.test(target) ? `[[${positionsPath}#^${target}]]` : `[[${target}]]`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quoteLines(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line.trimEnd()}`));
}

function headingDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
}

function renderTakeBlock(item: DigestItem, positionsPath: string): string[] {
  const lines = ['> [!take] My take', ...quoteLines(item.take ?? '')];
  const citations: string[] = [];
  if (item.groundedIn.length > 0) {
    citations.push(`**Grounded in:** ${item.groundedIn.map((t) => targetLink(t, positionsPath)).join(' · ')}`);
  }
  for (const t of item.tension) {
    citations.push(`**Updates / in tension with:** ${targetLink(t.target, positionsPath)}: ${oneLine(t.why)}`);
  }
  if (citations.length > 0) lines.push('', ...citations);
  return lines;
}

/** Clicking it starts a thinking exercise on the source (handled by the plugin's URI handler). */
export function thinkLink(source: string): string {
  const encoded = encodeURIComponent(source).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[〰️ think about this](obsidian://thinking-digest?think=${encoded})`;
}

/**
 * The source the cursor is "on" in a digest: the wikilink on an Also-new line,
 * otherwise the **Source:** of the item section containing the line.
 */
export function sourceAtLine(md: string, line: number): string | null {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const here = lines[line] ?? '';
  const inline = here.match(/^\s*-\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  if (inline) return inline[1].trim();
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    if (!SECTION_HEADING.test(lines[i])) continue;
    if (!ITEM_HEADING.test(lines[i])) return null;
    for (let j = i + 1; j < lines.length && !SECTION_HEADING.test(lines[j]); j++) {
      const src = lines[j].match(/^\*\*Source:\*\*\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
      if (src) return src[1].trim();
    }
    return null;
  }
  return null;
}

function renderItem(item: DigestItem, positionsPath: string): string {
  const lines = [`## ${oneLine(item.title)} ^${item.id}`, `**Source:** [[${item.source}]] · ${thinkLink(item.source)}`];
  if (item.whatsNew.trim() !== '') lines.push('', oneLine(item.whatsNew));
  const claims = item.claims.slice(0, 4).map(oneLine).filter((c) => c !== '');
  if (claims.length > 0) lines.push('', '**What they claim**', ...claims.map((c) => `- ${c}`));
  lines.push('');
  if (item.take !== null) {
    lines.push(...renderTakeBlock(item, positionsPath));
  } else {
    lines.push('> [!question] What do you think?', ...quoteLines(item.question ?? ''), '', ANSWER_LABEL, '');
  }
  return lines.join('\n');
}

export function renderDigest(input: {
  date: string;
  prep: string; // "Before <meeting>" sections, '' when none
  items: DigestItem[];
  alsoNew: AlsoNewModel[];
  shifts: string;
  positionsPath: string;
}): string {
  const blocks = [
    ['---', 'type: digest', `date: ${input.date}`, `items: ${input.items.length}`, '---'].join('\n'),
    `# Digest: ${headingDate(input.date)}`,
    ...(input.prep.trim() ? [input.prep.trim()] : []),
    ...input.items.map((item) => renderItem(item, input.positionsPath)),
  ];
  if (input.alsoNew.length > 0) {
    blocks.push(['## Also new', ...input.alsoNew.map((a) => `- [[${a.source}]]: ${oneLine(a.line)} · ${thinkLink(a.source)}`)].join('\n'));
  }
  if (input.shifts.trim() !== '') blocks.push(input.shifts.trim());
  return blocks.join('\n\n') + '\n';
}

export function renderFailedDigest(date: string, reason: string): string {
  const why = oneLine(reason).replace(/\.+$/, '') || 'unknown error';
  return `> [!warning] Digest failed: ${why}. Run "Generate today's digest" to retry.\n`;
}

function splitSections(lines: string[]): { id: string; body: string[] }[] {
  const sections: { id: string; body: string[] }[] = [];
  let current: { id: string; body: string[] } | null = null;
  for (const line of lines) {
    if (SECTION_HEADING.test(line)) {
      const match = ITEM_HEADING.exec(line);
      current = match ? { id: match[1], body: [] } : null;
      if (current) sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return sections;
}

/** Callout body; a bare blank line followed by more `>` lines is treated as her paragraph break, not the end. */
function readTake(body: string[]): string | null {
  const start = body.findIndex((line) => TAKE_CALLOUT.test(line));
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < body.length; i++) {
    const line = body[i];
    if (line.startsWith('>')) {
      if (/^>\s*\[!/.test(line)) break;
      out.push(line.replace(/^>\s?/, ''));
    } else if (line.trim() === '' && continuesCallout(body, i)) {
      out.push('');
    } else {
      break;
    }
  }
  return out.join('\n').trim();
}

function continuesCallout(body: string[], blankAt: number): boolean {
  const next = body.slice(blankAt + 1).find((line) => line.trim() !== '');
  return next !== undefined && next.startsWith('>') && !/^>\s*\[!/.test(next);
}

function readAnswer(body: string[]): string | null {
  const start = body.findIndex((line) => line.trimStart().startsWith(ANSWER_LABEL));
  if (start === -1) return null;
  const out = [body[start].trimStart().slice(ANSWER_LABEL.length)];
  for (const line of body.slice(start + 1)) {
    if (line.startsWith('**')) break;
    out.push(line);
  }
  const answer = out.join('\n').trim();
  return answer === '' ? null : answer;
}

export function parseDigest(md: string): ParsedDigestItem[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  return splitSections(lines).map(({ id, body }) => ({ id, take: readTake(body), answer: readAnswer(body) }));
}
