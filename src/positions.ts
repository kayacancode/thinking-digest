import { normalizeKey } from './types';
import type { ExtractedClaim, Ledger, Position, RetractedPosition } from './types';

const HEADER = [
  '# Positions',
  '',
  '%% Maintained by Thinking Digest. Each entry is tracked by its block id (^pos-xxxx), so your edits stick: ' +
    'rewrite the text, move an entry to another topic, or delete it and it will not be re-added. %%',
].join('\n');

const FALLBACK_TOPIC = 'Uncategorized';
const POS_ID = /pos-[0-9a-f]{4}/g;
const DATE = /\d{4}-\d{2}-\d{2}/;
const TOPIC_HEADING = /^##\s+(.+?)\s*$/;
const FIELD = /^\s+[-*+]\s+(sources|since|superseded[_ ]by|tension)\s*:\s*(.*)$/i;
const ENTRY = /^\s*[-*+]\s+(.*?)\s*\^(pos-[0-9a-f]{4})\s*$/;
const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/* ─── Parse ─────────────────────────────────────────────────────────────── */

function applyField(position: Position, key: string, value: string): void {
  switch (key.toLowerCase().replace(' ', '_')) {
    case 'sources':
      position.sources = unique([...value.matchAll(WIKILINK)].map((m) => m[1].trim()).filter(Boolean));
      break;
    case 'since':
      position.since = value.trim();
      break;
    case 'superseded_by': {
      const id = value.match(POS_ID)?.[0];
      if (id) position.supersededBy = { id, date: DATE.exec(value)?.[0] ?? '' };
      break;
    }
    case 'tension':
      position.tensionWith = unique(value.match(POS_ID) ?? []).filter((id) => id !== position.id);
      break;
  }
}

export function parseLedger(md: string): Ledger {
  const topics: string[] = [];
  const positions: Position[] = [];
  const seen = new Set<string>();
  let topic: string | null = null;
  let current: Position | null = null;

  for (const line of md.split(/\r?\n/)) {
    const heading = TOPIC_HEADING.exec(line);
    if (heading) {
      topic = heading[1];
      if (!topics.includes(topic)) topics.push(topic);
      current = null;
      continue;
    }

    const field = FIELD.exec(line);
    if (field) {
      if (current) applyField(current, field[1], field[2]);
      continue;
    }

    const entry = ENTRY.exec(line);
    const text = entry ? entry[1].replace(/^~~(.*)~~$/, '$1').trim() : '';
    if (entry && text && !seen.has(entry[2])) {
      if (topic === null) {
        topic = FALLBACK_TOPIC;
        if (!topics.includes(topic)) topics.push(topic);
      }
      current = { id: entry[2], topic, text, sources: [], since: '', tensionWith: [] };
      seen.add(current.id);
      positions.push(current);
      continue;
    }

    if (entry || /^\S/.test(line)) current = null;
  }

  return { topics, positions };
}

/* ─── Render ────────────────────────────────────────────────────────────── */

function renderEntry(p: Position): string {
  const text = p.supersededBy ? `~~${p.text}~~` : p.text;
  const lines = [
    `- ${text} ^${p.id}`,
    `\t- sources: ${p.sources.map((s) => `[[${s}]]`).join(', ')}`.trimEnd(),
    `\t- since: ${p.since}`.trimEnd(),
  ];
  if (p.supersededBy) {
    lines.push(`\t- superseded_by: [[#^${p.supersededBy.id}]] (${p.supersededBy.date})`);
  }
  if (p.tensionWith.length) {
    lines.push(`\t- tension: ${p.tensionWith.map((id) => `[[#^${id}]]`).join(', ')}`);
  }
  return lines.join('\n');
}

export function renderLedger(ledger: Ledger): string {
  const topics = unique([...ledger.topics, ...ledger.positions.map((p) => p.topic)]);
  const sections = topics.map((topic) =>
    [`## ${topic}`, ...ledger.positions.filter((p) => p.topic === topic).map(renderEntry)].join('\n'),
  );
  return [HEADER, ...sections].join('\n\n') + '\n';
}

/* ─── Apply extracted claims ────────────────────────────────────────────── */

function clonePosition(p: Position): Position {
  const copy: Position = { ...p, sources: [...p.sources], tensionWith: [...p.tensionWith] };
  if (p.supersededBy) copy.supersededBy = { ...p.supersededBy };
  return copy;
}

function freshId(newId: () => string, taken: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = newId();
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error('positions: newId kept returning ids that are already in use');
}

/** Matches an existing topic case- and punctuation-insensitively; otherwise appends the new topic. */
function resolveTopic(topics: string[], topic: string): string {
  const wanted = topic.replace(/\s+/g, ' ').trim() || FALLBACK_TOPIC;
  const existing = topics.find((t) => normalizeKey(t) === normalizeKey(wanted));
  if (existing) return existing;
  topics.push(wanted);
  return wanted;
}

/** Keeps positions grouped by topic so render → parse returns the same order. */
function insertAtEndOfTopic(positions: Position[], position: Position): void {
  const lastInTopic = positions.map((p) => p.topic).lastIndexOf(position.topic);
  positions.splice(lastInTopic === -1 ? positions.length : lastInTopic + 1, 0, position);
}

export function applyClaims(
  ledger: Ledger,
  claims: ExtractedClaim[],
  opts: { date: string; retracted: RetractedPosition[]; newId: () => string },
): {
  ledger: Ledger;
  added: string[];
  superseded: { from: string; to: string }[];
  tensions: { a: string; b: string }[];
} {
  const topics = [...ledger.topics];
  const positions = ledger.positions.map(clonePosition);
  const taken = new Set([...positions.map((p) => p.id), ...opts.retracted.map((r) => r.id)]);
  const retractedKeys = new Set(opts.retracted.map((r) => r.key));
  const retractedIds = new Set(opts.retracted.map((r) => r.id));
  const added: string[] = [];
  const superseded: { from: string; to: string }[] = [];
  const tensions: { a: string; b: string }[] = [];

  const findOrAdd = (text: string, topic: string, source: string): Position => {
    const key = normalizeKey(text);
    const existing = positions.find((p) => normalizeKey(p.text) === key);
    if (existing) {
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
      return existing;
    }
    const position: Position = {
      id: freshId(opts.newId, taken),
      topic: resolveTopic(topics, topic),
      text,
      sources: source ? [source] : [],
      since: opts.date,
      tensionWith: [],
    };
    insertAtEndOfTopic(positions, position);
    added.push(position.id);
    return position;
  };

  for (const claim of claims) {
    const text = claim.text.replace(/\s+/g, ' ').trim();
    if (!text || retractedKeys.has(normalizeKey(text))) continue;
    if (claim.target && retractedIds.has(claim.target)) continue;

    const target =
      claim.relation === 'new' ? undefined : positions.find((p) => p.id === claim.target);
    if (claim.relation === 'same' && target) {
      if (claim.source && !target.sources.includes(claim.source)) target.sources.push(claim.source);
      continue;
    }

    const entry = findOrAdd(text, claim.topic || target?.topic || '', claim.source);
    if (!target || target === entry) continue;

    if (claim.relation === 'updates' && target.supersededBy?.id !== entry.id) {
      target.supersededBy = { id: entry.id, date: opts.date };
      superseded.push({ from: target.id, to: entry.id });
    }
    if (
      claim.relation === 'tension' &&
      !(target.tensionWith.includes(entry.id) && entry.tensionWith.includes(target.id))
    ) {
      target.tensionWith = unique([...target.tensionWith, entry.id]);
      entry.tensionWith = unique([...entry.tensionWith, target.id]);
      tensions.push({ a: target.id, b: entry.id });
    }
  }

  return { ledger: { topics, positions }, added, superseded, tensions };
}

/* ─── Queries ───────────────────────────────────────────────────────────── */

export function findRetractions(ledger: Ledger, known: Record<string, string>): RetractedPosition[] {
  const present = new Set(ledger.positions.map((p) => p.id));
  return Object.entries(known)
    .filter(([id]) => !present.has(id))
    .map(([id, key]) => ({ id, key }));
}

export function livePositions(ledger: Ledger): Position[] {
  return ledger.positions.filter((p) => !p.supersededBy);
}
