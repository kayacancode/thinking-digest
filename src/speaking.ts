/**
 * Speaking practice: "Say it out loud" points on Sparks and Ponderings, prep
 * for recurring meetings in the digest, and a practice-log row afterwards.
 * Pure: no Obsidian, no model calls.
 */

/* ─── Recurring meetings ───────────────────────────────────────────────── */

export interface MeetingNote {
  path: string;
  title: string;
  date: string; // YYYY-MM-DD (local)
  created: string; // ISO, orders meetings within a day
}

/**
 * A recurring meeting expected today. Series that meet together (IC Decisions
 * and IC Discussions on the same days) are one meeting to prep for.
 */
export interface DueMeeting {
  key: string; // seriesKey(title)
  title: string; // "💸weekly IC" for a merged pair, else the latest title
  keys: string[]; // the series in it
  lastPaths: string[]; // latest past instance of each series: what this meeting is about
  since: string; // ISO created of the latest past instance; "new" meetings come after it
}

const SERIES_WINDOW_DAYS = 42;
const WEEKDAY_WINDOW_DAYS = 21;
const MIN_OCCURRENCES = 3;
export const MAX_PREP_MEETINGS = 3;
const MAX_NEW_MEETINGS = 12;

/** "💸weekly IC 🔒Decisions meeting" and "💸Weekly IC 🔒 Decisions meeting" are the same series. */
export function seriesKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function seriesInWindow(meetings: MeetingNote[], today: string): Map<string, MeetingNote[]> {
  const t = dayNumber(today);
  const series = new Map<string, MeetingNote[]>();
  for (const m of meetings) {
    const age = t - dayNumber(m.date);
    if (age < 0 || age > SERIES_WINDOW_DAYS) continue;
    const key = seriesKey(m.title);
    if (key) series.set(key, [...(series.get(key) ?? []), m]);
  }
  return series;
}

/** Leading words two titles share: "💸weekly IC 🔒Decisions meeting" + "💸weekly IC 🗣️Discussions meeting" → "💸weekly IC". */
function commonTitle(titles: string[]): string {
  const words = titles.map((t) => t.split(/\s+/));
  const shared: string[] = [];
  for (let i = 0; i < words[0].length && words.every((w) => w[i] === words[0][i]); i++) shared.push(words[0][i]);
  return shared.length ? shared.join(' ') : titles[0];
}

/**
 * Recurring meetings expected today: a series seen on 3+ different days in the
 * last 6 weeks, with an instance on today's weekday in the last 3 weeks, and
 * no note for today yet (if there is one, it already happened). Series that
 * start with the same two words and have met on the same day are merged.
 */
export function meetingsDue(meetings: MeetingNote[], today: string): DueMeeting[] {
  const t = dayNumber(today);
  const due: { keys: string[]; latest: MeetingNote[]; dates: Set<string> }[] = [];
  for (const [key, notes] of seriesInWindow(meetings, today)) {
    if (notes.some((n) => n.date === today)) continue;
    const dates = new Set(notes.map((n) => n.date));
    if (dates.size < MIN_OCCURRENCES) continue;
    if (!notes.some((n) => t - dayNumber(n.date) <= WEEKDAY_WINDOW_DAYS && weekday(n.date) === weekday(today))) continue;
    const latest = [...notes].sort((a, b) => b.created.localeCompare(a.created))[0];
    const prefix = key.split(' ').slice(0, 2).join(' ');
    const group = due.find((g) => g.keys[0].split(' ').slice(0, 2).join(' ') === prefix && [...dates].some((d) => g.dates.has(d)));
    if (group) {
      group.keys.push(key);
      group.latest.push(latest);
      for (const d of dates) group.dates.add(d);
    } else {
      due.push({ keys: [key], latest: [latest], dates });
    }
  }
  return due
    .map((g) => {
      const latest = [...g.latest].sort((a, b) => b.created.localeCompare(a.created));
      const title = commonTitle(g.latest.map((n) => n.title));
      return { key: seriesKey(title), title, keys: g.keys, lastPaths: latest.map((n) => n.path), since: latest[0].created };
    })
    .sort((a, b) => b.since.localeCompare(a.since) || a.title.localeCompare(b.title))
    .slice(0, MAX_PREP_MEETINGS);
}

/**
 * One-off meetings since the last instance of a recurring one (the companies
 * and people she met that week), newest first. Other recurring meetings
 * (1:1s, standups) are left out.
 */
export function newMeetingsSince(meetings: MeetingNote[], due: DueMeeting, today: string): MeetingNote[] {
  const recurring = new Set([...seriesInWindow(meetings, today)].filter(([, notes]) => notes.length >= 2).map(([key]) => key));
  return meetings
    .filter((m) => m.created > due.since && m.date < today && !recurring.has(seriesKey(m.title)))
    .sort((a, b) => b.created.localeCompare(a.created))
    .slice(0, MAX_NEW_MEETINGS);
}

/* ─── Meeting prep in the digest ───────────────────────────────────────── */

export interface PrepModel {
  meeting: string; // series key
  points: { text: string; sources: string[] }[];
  question: string;
  sayOnce: string[];
}

/**
 * Keep talking points that rest on her own words, her positions, or a meeting
 * she had since the last instance (what she'd report to the room). At most 3,
 * for meetings actually due.
 */
export function checkPrep(
  prep: PrepModel[],
  due: DueMeeting[],
  ownWords: Set<string>,
  positionIds: Set<string>,
  newMeetings: Map<string, Set<string>>, // meeting key -> paths of meetings since its last instance
): PrepModel[] {
  const keys = new Set(due.map((d) => d.key));
  const seen = new Set<string>();
  const out: PrepModel[] = [];
  for (const p of prep) {
    if (!keys.has(p.meeting) || seen.has(p.meeting)) continue;
    seen.add(p.meeting);
    const fresh = newMeetings.get(p.meeting) ?? new Set<string>();
    const valid = (s: string) => ownWords.has(s) || positionIds.has(s) || fresh.has(s);
    const points = p.points
      .map((pt) => ({ text: pt.text.replace(/\s+/g, ' ').trim(), sources: [...new Set(pt.sources)].filter(valid) }))
      .filter((pt) => pt.text !== '' && pt.sources.length > 0)
      .slice(0, 3);
    if (!points.length) continue;
    const sayOnce = [...new Set(p.sayOnce.map((w) => w.trim()).filter(Boolean))].slice(0, 5);
    out.push({ meeting: p.meeting, points, question: p.question.replace(/\s+/g, ' ').trim(), sayOnce });
  }
  return out;
}

export function renderPrep(
  prep: PrepModel[],
  due: DueMeeting[],
  opts: { practicePath: string; positionsPath: string },
): string {
  const titles = new Map(due.map((d) => [d.key, d.title]));
  const link = (s: string) => (/^pos-[0-9a-f]{4}$/.test(s) ? `[[${opts.positionsPath}#^${s}|↗]]` : `[[${s}|↗]]`);
  return prep
    .map((p) => {
      const lines = [
        `## Before ${titles.get(p.meeting) ?? p.meeting}`,
        `> [!tip] 2 minutes, from your own notes. Slow is senior. [[${opts.practicePath}|Speaking practice]]`,
        '',
        '**Three talking points, one breath each**',
        // One link per point (the meeting it's about, or the note it came from): it's read aloud, not audited.
        ...p.points.map((pt, i) => `${i + 1}. ${pt.text} ${link(pt.sources[0])}`),
      ];
      if (p.question) lines.push('', `**The one question I'm bringing:** ${p.question}`);
      if (p.sayOnce.length) lines.push('', `**Say once, slowly, out loud:** ${p.sayOnce.join(' · ')}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/* ─── "Say it out loud" on Sparks and Ponderings ───────────────────────── */

export interface SayIt {
  points: string[]; // exactly 3
  stuckWord: string; // '' when nothing stands out
}

const SAY_HEADING = /^##\s+Say it out loud\s*$/i;
const NUMBERED = /^(\d+)\.\s*(.*)$/;
const STUCK = /^Word I might get stuck on:\s*(.*)$/i;

/**
 * Whether the note wants points: a Spark whose "Say it out loud" points are
 * still blank, or a note with no such section yet. Never when she's written any.
 */
export function needsSayIt(md: string): boolean {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => SAY_HEADING.test(l));
  if (start === -1) return true;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  return lines.slice(start + 1, end).every((l) => {
    const m = l.match(NUMBERED);
    return !m || m[2].trim() === '';
  });
}

/** Fill blank numbered points (and a blank stuck-word line), or append the section. */
export function fillSayIt(md: string, say: SayIt): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => SAY_HEADING.test(l));
  if (start === -1) {
    const section = [
      '## Say it out loud',
      'Three points, one breath each, pause between them.',
      ...say.points.map((p, i) => `${i + 1}. ${p}`),
    ];
    if (say.stuckWord) section.push('', `Word I might get stuck on: ${say.stuckWord}`);
    return `${md.replace(/\s*$/, '')}\n\n${section.join('\n')}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  const body = lines.slice(start + 1, end);
  let next = 0;
  const filled = body.map((l) => {
    const m = l.match(NUMBERED);
    if (m && m[2].trim() === '' && next < say.points.length) return `${m[1]}. ${say.points[next++]}`;
    const s = l.match(STUCK);
    if (s && s[1].trim() === '' && say.stuckWord) return `Word I might get stuck on: ${say.stuckWord}`;
    return l;
  });
  return [...lines.slice(0, start + 1), ...filled, ...lines.slice(end)].join('\n');
}

/** Three non-empty points; the stuck word must be one she'll actually say. */
export function checkSayIt(say: SayIt): SayIt | null {
  const points = say.points.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (points.length < 3) return null;
  const word = say.stuckWord.trim();
  const said = points.join(' ').toLowerCase();
  return { points: points.slice(0, 3), stuckWord: word && said.includes(word.toLowerCase()) ? word : '' };
}

/* ─── Practice log ─────────────────────────────────────────────────────── */

/**
 * Add a row for a meeting to the table under "## Practice log": fill her first
 * blank row, otherwise append. Returns null when there's no table, or the
 * meeting is already logged.
 */
export function addPracticeRow(md: string, row: { date: string; meetingPath: string; title: string }): string | null {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const heading = lines.findIndex((l) => /^##\s+Practice log/i.test(l));
  if (heading === -1) return null;
  let first = heading + 1;
  while (first < lines.length && !lines[first].trim().startsWith('|') && !/^#{1,2}\s/.test(lines[first])) first++;
  if (first >= lines.length || !lines[first].trim().startsWith('|')) return null;
  let last = first;
  while (last + 1 < lines.length && lines[last + 1].trim().startsWith('|')) last++;
  if (lines.slice(first, last + 1).some((l) => l.includes(`[[${row.meetingPath}\\|`))) return null;

  const columns = lines[first].split('|').length - 2;
  const label = row.title.replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const cells = [row.date, `[[${row.meetingPath}\\|${label}]]`, ...Array(Math.max(0, columns - 2)).fill('')];
  const text = `| ${cells.join(' | ')} |`;
  const blank = lines.findIndex((l, i) => i > first + 1 && i <= last && l.split('|').slice(1, -1).every((c) => c.trim() === ''));
  if (blank !== -1) lines[blank] = text;
  else lines.splice(last + 1, 0, text);
  return lines.join('\n');
}
