import { sanitizeTitle } from './substack';

/**
 * A thinking exercise lives in one note: the plugin appends a question, Kaya
 * answers under it, repeat. Plain markdown so it works with slow model calls
 * and survives being edited, synced, or left half-done for days.
 */

export interface Round {
  question: string;
  answer: string;
}

export interface Exercise {
  source: string; // path of the item being thought about
  title: string;
  status: 'open' | 'done';
  rounds: Round[];
}

const QUESTION_HEADING = /^## Q(\d+)\. (.*)$/;

export function exerciseNoteName(title: string, date: string): string {
  return `${date} - ${sanitizeTitle(title, 80) || 'Untitled'}`;
}

export function renderNewExercise(a: { source: string; title: string; date: string; question: string }): string {
  return [
    '---',
    'type: exercise',
    `source: ${JSON.stringify(`[[${a.source}]]`)}`,
    'status: open',
    `started: ${a.date}`,
    '---',
    `# 〰️ Thinking through: ${a.title}`,
    '',
    '%% Answer under each question, then run "Thinking Digest: Next question". When it says it has enough (or whenever you want), run "Thinking Digest: Finish exercise". %%',
    '',
    `## Q1. ${oneLine(a.question)}`,
    '',
    '',
  ].join('\n');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseExercise(md: string): Exercise {
  const text = md.replace(/\r\n/g, '\n');
  const fmEnd = text.startsWith('---') ? text.indexOf('\n---', 3) : -1;
  const fm = fmEnd > 0 ? text.slice(4, fmEnd) : '';
  const sourceMatch = fm.match(/^source:\s*"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?\s*$/m);
  const status = /^status:\s*done\s*$/m.test(fm) ? 'done' : 'open';
  const titleMatch = text.match(/^# 〰️ Thinking through: (.*)$/m);

  const rounds: Round[] = [];
  let current: Round | null = null;
  const body: string[] = [];
  const flush = () => {
    if (current) {
      current.answer = body.join('\n').replace(/%%[\s\S]*?%%/g, '').trim();
      rounds.push(current);
    }
    body.length = 0;
  };
  for (const line of text.slice(fmEnd > 0 ? fmEnd + 4 : 0).split('\n')) {
    const q = line.match(QUESTION_HEADING);
    if (q) {
      flush();
      current = { question: q[2].trim(), answer: '' };
    } else if (/^#{1,2} /.test(line) && current) {
      flush();
      current = null;
    } else if (current) {
      body.push(line);
    }
  }
  flush();

  return {
    source: sourceMatch?.[1]?.trim() ?? '',
    title: titleMatch?.[1]?.trim() ?? '',
    status,
    rounds,
  };
}

export function appendQuestion(md: string, n: number, question: string): string {
  return `${md.replace(/\s*$/, '')}\n\n## Q${n}. ${oneLine(question)}\n\n`;
}

export function appendReadyNote(md: string): string {
  return `${md.replace(/\s*$/, '')}\n\n%% That's enough to write it up. Run "Thinking Digest: Finish exercise", or keep going with "Next question". %%\n`;
}

export function markDone(md: string, ponderingPath: string): string {
  const text = md.replace(/^status:\s*open\s*$/m, 'status: done');
  return text.replace(/^(started: .*)$/m, `$1\npondering: ${JSON.stringify(`[[${ponderingPath}]]`)}`);
}

/* ─── Pondering note (matches the vault's 〰️ Pondering template) ───────── */

export interface PonderingDraft {
  title: string;
  heterodox: boolean | null;
  ideas: string[];
  insights: string[];
  people: string[]; // display names
  forkIdeas: string[];
  steelman: string;
}

export function ponderingNoteName(title: string): string {
  return `〰️ ${sanitizeTitle(title, 120) || 'Untitled'}`;
}

export function renderPondering(a: {
  draft: PonderingDraft;
  date: string;
  source: string;
  exercise: string;
  related: string[]; // extra paths or position links (already link targets, no brackets)
  peopleLinks: Record<string, string>; // display name -> existing people page path
}): string {
  const { draft } = a;
  const yamlList = (items: string[]) => (items.length ? '\n' + items.map((i) => `  - ${JSON.stringify(`[[${i}]]`)}`).join('\n') : '');
  const bullets = (items: string[]) => items.map((i) => `> - ${oneLine(i)}`).join('\n');
  const person = (name: string) => (a.peopleLinks[name] ? `[[${a.peopleLinks[name]}|${name}]]` : name);

  return [
    '---',
    `Date created: ${a.date}`,
    `Heterodox: ${draft.heterodox === null ? '' : String(draft.heterodox)}`,
    'Quality score:',
    'Related Beliefs:',
    `Related to ?:${yamlList([a.source, ...a.related])}`,
    `exercise: ${JSON.stringify(`[[${a.exercise}]]`)}`,
    'tags:',
    '  - Ponderings',
    '---',
    '',
    '〰️',
    '',
    `> [!faq]+  Ideas i’m pondering 〰️`,
    bullets(draft.ideas) || '> - ',
    '',
    '### Relevant Notes:',
    `- [[${a.source}]]`,
    ...a.related.map((r) => `- [[${r}]]`),
    '',
    '>[!cue]  Insights that triggered ideas ... 🤔',
    bullets(draft.insights) || '> - ',
    '',
    '>[!faq]+  Idea Forks I travelled because of this ...  〰️',
    `>- People: ${draft.people.map(person).join(', ')}`,
    `>- Ideas: ${draft.forkIdeas.map(oneLine).join('; ')}`,
    `>- Steel man Counter: ${oneLine(draft.steelman)}`,
    '',
  ].join('\n');
}
