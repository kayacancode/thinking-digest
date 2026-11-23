/**
 * Shared contract for every module. Pure modules (substack, positions, voice,
 * digest, harvest, citations, prompts, shifts, scheduler) import ONLY from here
 * and from each other — never from 'obsidian' — so they run under vitest.
 *
 * Link conventions:
 *   - A "path" is a vault path WITHOUT the .md extension, e.g. "Granola notes/2026-11-21, Stasht".
 *     Wikilinks are rendered as [[path]].
 *   - A position id is "pos-" + 4 lowercase hex chars ("pos-7f3a"); a voice rule id is
 *     "vr-" + 4 hex; a digest item id is "td-" + 6 hex. Ids are block ids: rendered as
 *     " ^pos-7f3a" at the end of the line they label.
 *   - A position is linked as [[<positionsPath>#^pos-7f3a]].
 *   - Dates are "YYYY-MM-DD" (local), timestamps ISO strings.
 */

export interface Settings {
  provider: 'cli' | 'api'; // cli = local Claude Code (`claude -p`, uses her subscription); api = Anthropic API key
  cliPath: string; // empty = auto-detect
  apiKey: string;
  model: string;
  substackUrl: string;
  writingFolder: string;
  sourceFolders: string[];
  excludedFolders: string[];
  priorFolders: string[];
  digestFolder: string;
  takesFolder: string;
  positionsPath: string; // without .md
  voiceRulesPath: string; // without .md
  dailyCap: number;
  digestTime: string; // "HH:MM"
  digestDays: number[]; // 0=Sun..6=Sat
  shiftsDay: number; // 0..6
  lookbackDays: number;
  excerptChars: number;
  maxActiveRules: number;
  autoRun: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'cli',
  cliPath: '',
  apiKey: '',
  model: 'claude-sonnet-5-5',
  substackUrl: 'https://kayajones.substack.com',
  writingFolder: 'Writing/Substack',
  sourceFolders: ['Granola notes', 'Clippings'],
  excludedFolders: ['Granola notes/transcripts'],
  priorFolders: ['Pondering', 'Beliefs', 'Thinking/Sparks'],
  digestFolder: 'Thinking/Digests',
  takesFolder: 'Thinking/Takes',
  positionsPath: 'Thinking/Positions',
  voiceRulesPath: 'Thinking/Voice rules',
  dailyCap: 5,
  digestTime: '07:30',
  digestDays: [1, 2, 3, 4, 5],
  shiftsDay: 5,
  lookbackDays: 3,
  excerptChars: 6000,
  maxActiveRules: 25,
  autoRun: false,
};

/* ─── Substack ─────────────────────────────────────────────────────────── */

export interface Post {
  url: string; // canonical post URL, identity key
  slug: string;
  title: string;
  subtitle: string;
  published: string; // YYYY-MM-DD
  audience: string; // "everyone" | "only_paid" | ... ; RSS posts are "everyone"
  html: string; // full body HTML
}

/* ─── Sources for the digest ───────────────────────────────────────────── */

export interface Candidate {
  path: string;
  title: string;
  created: string; // ISO
  kind: 'meeting' | 'clipping' | 'other';
  excerpt: string; // already truncated
}

/* ─── Priors pack (sent to the model) ──────────────────────────────────── */

export interface PriorNote {
  path: string;
  title: string;
  kind: 'post' | 'pondering' | 'belief' | 'spark' | 'take';
  body: string; // truncated
  verdict?: 'kept' | 'rewrote' | 'answered'; // takes only
}

export interface PriorsPack {
  voiceRules: string[]; // active rule texts
  positions: { id: string; topic: string; text: string }[]; // live entries only
  notes: PriorNote[];
}

/* ─── Positions ledger ─────────────────────────────────────────────────── */

export interface Position {
  id: string; // pos-xxxx
  topic: string;
  text: string;
  sources: string[]; // paths
  since: string; // YYYY-MM-DD
  supersededBy?: { id: string; date: string };
  tensionWith: string[]; // pos ids
}

export interface Ledger {
  topics: string[]; // order of topic headings as they appear
  positions: Position[];
}

/** One claim the extractor found in a source (model output, validated). */
export interface ExtractedClaim {
  text: string;
  topic: string;
  source: string; // path
  relation: 'new' | 'same' | 'updates' | 'tension';
  target: string | null; // pos id for same/updates/tension, null for new
}

export interface RetractedPosition {
  id: string;
  key: string; // normalizeKey(text)
}

/* ─── Voice rules ──────────────────────────────────────────────────────── */

export interface VoiceRule {
  id: string; // vr-xxxx
  text: string;
  learnedFrom: string[]; // take paths
  status: 'active' | 'proposed';
}

export interface ProposedRule {
  text: string;
  learnedFrom: string[]; // take paths; must be >= 2 distinct to be accepted
}

/* ─── Digest ───────────────────────────────────────────────────────────── */

export interface TensionRef {
  target: string; // pos id OR path
  why: string;
  kind: 'updates' | 'tension';
}

/** One digest item as returned by the model (validated) before citation checks. */
export interface DigestItemModel {
  source: string; // path of the candidate
  title: string;
  whatsNew: string;
  claims: string[]; // what THEY claim, <= 4
  take: string | null; // null => question mode
  question: string | null; // required when take is null
  groundedIn: string[]; // pos ids or paths
  tension: TensionRef[];
}

export interface AlsoNewModel {
  source: string;
  line: string;
}

export interface DigestModel {
  items: DigestItemModel[];
  alsoNew: AlsoNewModel[];
}

/** Stored per digest item in data.json; the harvester compares against it. */
export interface DraftRecord {
  title: string;
  source: string;
  claims: string[];
  take: string | null; // original draft (null in question mode)
  question: string | null;
  groundedIn: string[];
  tension: TensionRef[];
}

/** Item with its block id, ready to render. */
export interface DigestItem extends DraftRecord {
  id: string; // td-xxxxxx
  whatsNew: string;
}

/** What the harvester read back from a digest note for one item. */
export interface ParsedDigestItem {
  id: string;
  take: string | null; // text inside the [!take] callout (null if no take callout)
  answer: string | null; // text under "**My answer:**" (null if none / empty)
}

export type Verdict = 'kept' | 'rewrote' | 'answered' | 'rejected' | 'skipped';

export interface TakeOut {
  date: string; // digest date
  title: string;
  source: string;
  verdict: 'kept' | 'rewrote' | 'answered';
  final: string;
  original: string; // draft or question
  groundedIn: string[];
  tension: TensionRef[];
}

export interface HarvestResult {
  takes: TakeOut[];
  rejected: { date: string; source: string }[];
  rewritePairs: { draft: string; final: string; takeTitle: string }[];
  metrics: MetricsRow;
}

export interface MetricsRow {
  date: string;
  kept: number;
  rewrote: number;
  answered: number;
  rejected: number;
  skipped: number;
}

/* ─── Shifts ───────────────────────────────────────────────────────────── */

export interface ShiftsModel {
  moved: { from: string; to: string; line: string }[]; // pos ids
  tension: { a: string; b: string; line: string }[]; // pos ids
  sparks: { spark: string; evidence: string[]; line: string }[]; // paths
}

/* ─── Persistent plugin state (data.json) ──────────────────────────────── */

export interface PluginState {
  settings: Settings;
  lastRunDate: string | null;
  cutoff: string | null;
  handled: Record<string, string>; // path -> digest date
  drafts: Record<string, Record<string, DraftRecord>>; // date -> item id -> draft
  harvested: string[];
  rejections: { date: string; source: string }[];
  imports: Record<string, { path: string; hash: string }>; // post url -> note
  extracted: Record<string, string>; // source path -> content hash
  retractedPositions: RetractedPosition[];
  knownPositions: Record<string, string>; // pos id -> normalizeKey(text) for every id the plugin has seen (detects deletions)
  knownRules: Record<string, string>; // vr id -> normalizeKey(text)
  rejectedRulePatterns: string[]; // normalizeKey(text) of deleted rules
  metrics: MetricsRow[];
}

export const EMPTY_STATE = (): PluginState => ({
  settings: { ...DEFAULT_SETTINGS },
  lastRunDate: null,
  cutoff: null,
  handled: {},
  drafts: {},
  harvested: [],
  rejections: [],
  imports: {},
  extracted: {},
  retractedPositions: [],
  knownPositions: {},
  knownRules: {},
  rejectedRulePatterns: [],
  metrics: [],
});

/** Lowercase, strip punctuation, collapse whitespace. Shared identity key for claims and rules. */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Source of randomness for ids, injectable for tests. */
export type HexId = (len: number) => string;

/** FNV-1a 32-bit hex of a string. Change detection only, not security. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
