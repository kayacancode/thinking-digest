import * as v from 'valibot';
import type {
  Candidate,
  DigestModel,
  ExtractedClaim,
  Position,
  PriorsPack,
  ProposedRule,
  ShiftsModel,
  Thought,
} from './types';

export interface Prompt {
  system: string;
  user: string;
}

/* ─── Shared helpers ───────────────────────────────────────────────────── */

const KAYA_VOICE = `Kaya writes casually and directly: often lowercase, short sentences, opinionated, no corporate hedging, no warm-up, no exclamation marks, no "great question" filler. She says what she thinks and why.`;

function extractJson(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in model response');
  return body.slice(start, end + 1);
}

function parseWith<T>(schema: v.GenericSchema<unknown, T>, text: string, label: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (err) {
    throw new Error(`${label}: ${(err as Error).message}`);
  }
  const result = v.safeParse(schema, raw);
  if (result.success) return result.output;
  const issue = result.issues[0];
  const path = v.getDotPath(issue) ?? '(root)';
  throw new Error(`${label}: invalid field "${path}": ${issue.message}`);
}

function bulletList(lines: string[], empty: string): string {
  return lines.length > 0 ? lines.map((l) => `- ${l}`).join('\n') : empty;
}

function positionLine(p: { id: string; topic: string; text: string }): string {
  return `${p.id} [${p.topic}] ${p.text}`;
}

/* ─── Digest ───────────────────────────────────────────────────────────── */

const TensionSchema = v.object({
  target: v.string(),
  why: v.string(),
  kind: v.picklist(['updates', 'tension']),
});

const DigestItemSchema = v.object({
  source: v.string(),
  title: v.string(),
  whatsNew: v.optional(v.string(), ''),
  claims: v.optional(v.array(v.string()), []),
  take: v.optional(v.nullable(v.string()), null),
  question: v.optional(v.nullable(v.string()), null),
  groundedIn: v.optional(v.array(v.string()), []),
  tension: v.optional(v.array(TensionSchema), []),
});

const ThreadSchema = v.object({
  target: v.optional(v.nullable(v.string()), null),
  title: v.optional(v.string(), ''),
  oneLiner: v.optional(v.string(), ''),
  bullets: v.array(v.object({ text: v.string(), sources: v.optional(v.array(v.string()), []) })),
});

const DigestSchema = v.object({
  items: v.array(DigestItemSchema),
  alsoNew: v.optional(v.array(v.object({ source: v.string(), line: v.string() })), []),
  threads: v.optional(v.array(ThreadSchema), []),
});

function renderPriors(priors: PriorsPack): string {
  const rules = bulletList(priors.voiceRules, '(no voice rules yet)');
  const positions = bulletList(
    priors.positions.map(positionLine),
    '(no positions recorded yet)',
  );
  const notes =
    priors.notes.length > 0
      ? priors.notes
          .map((n) => {
            const verdict = n.verdict ? ` verdict="${n.verdict}"` : '';
            return `<prior path="${n.path}" kind="${n.kind}"${verdict} title="${n.title}">\n${n.body}\n</prior>`;
          })
          .join('\n\n')
      : '(no prior notes)';
  return `## Kaya's voice rules (follow every one)
${rules}

## Kaya's live positions (cite by id)
${positions}

## Kaya's prior writing (cite by path)
${notes}`;
}

export function buildDigestPrompt(input: {
  date: string;
  candidates: Candidate[];
  priors: PriorsPack;
  cap: number;
  thoughts?: Thought[];
}): Prompt {
  const { date, candidates, priors, cap } = input;
  const thoughts = input.thoughts ?? [];
  const system = `You draft Kaya's daily thinking digest. She reads it to sharpen her own thinking: for each item, she sees what the source claims next to what SHE thinks, and corrects your draft of her take.

${KAYA_VOICE}

The single most important rule: never put the source's claims in Kaya's mouth. "What they claim" belongs to the source. "Take" is Kaya's view, and it may only say what her positions or prior writing below support. If a source claim sounds smart but nothing of hers backs it, it does not go in her take.

${renderPriors(priors)}

## Rules
1. Pick at most ${cap} items. Prefer substance (ideas, claims, decisions, disagreements, surprising evidence) over logistics (scheduling, intros, status updates, admin). Boost items that touch one of her positions or prior notes. Fewer is fine when the rest are thin.
2. "claims": what the SOURCE asserts, at most 4, each attributed to the source ("they argue…", "<name> says…"). Never Kaya's opinions. Empty list if the source makes no real claims.
3. "take": Kaya's take in first person, 2–4 sentences, in her voice and following every voice rule. It MUST be grounded in HER words: "groundedIn" lists at least one position id, prior path, or thought path that the take actually relies on. A meeting or article is never grounding for her take (only a candidate with her "My first reaction" callout counts). If you cannot ground it honestly, set "take" to null and "groundedIn" to []. A weak or invented take is worse than none.
4. "question": ALWAYS write one pointed question that would pull out Kaya's stance on this item, tied to the specific tension or idea in it (not "what do you think?"). It is shown instead of the take if the take is dropped.
5. "tension": only when the source or the take genuinely contradicts one of the positions or prior notes you cited. kind "updates" = her view should move (the new evidence wins); kind "tension" = unresolved, both stand. "why" is one short line in Kaya's first person ("my view…", never "her view"). Never invent tension; usually this is [].
6. "whatsNew": one line saying what's new in this item.
7. Every candidate you don't pick goes in "alsoNew" with a one-line summary.
8. Use ONLY the candidate paths, position ids and prior paths given here, copied exactly. Never make up a path or id.
9. A candidate may contain a "> [!take] My first reaction" callout. That is Kaya's OWN words, written when she saved it. Build the take from it first: keep her stance and phrasing, tighten it, and cite the candidate path itself in "groundedIn" (plus any positions it relies on).
10. "Kaya's thoughts" below are HER OWN quick notes from this week; the NEW part is what she wrote since the last digest. They are her words, like a first reaction: when an item touches one, build the take on it and cite the note's path in "groundedIn". Ignore todos, logistics and personal admin in them.
11. "threads": how her thinking is building up this week, written into her Sparks (prior notes with kind="spark": her open curiosities, each with a "What's new in my head" list) and Ponderings (kind="pondering": ideas she has worked through). Each thread proposes 1–3 short bullets in her first person, made ONLY from her own words (thoughts, first reactions, takes, sparks, ponderings), never from a source's claims. Each bullet's "sources" lists EVERY note where that thought shows up this week: at least one of her own notes (thought, take, spark, pondering, first reaction) first, plus any meetings where she raised it. A bullet backed only by a meeting or article is not hers and is dropped. Prefer extending an existing Spark or Pondering ("target": its exact path) when the thread fits one; a Spark fits a fresh question or hunch, a Pondering fits an idea she has already worked through. Propose a NEW Spark ("target": null, plus a short "title" naming the topic like her spark titles, and a "oneLiner": one sentence in her voice saying why it grabs her) only when the same thought shows up in at least 2 different notes or items this week. No thread is better than a weak one; usually 0–3 threads.

## Output
Return only a JSON object, no prose, in this exact shape:
{
  "items": [
    {
      "source": "<candidate path>",
      "title": "<short title for the item>",
      "whatsNew": "<one line>",
      "claims": ["<what the source claims>"],
      "take": "<Kaya's take>" | null,
      "question": "<one pointed question>",
      "groundedIn": ["pos-xxxx" | "<prior path>"],
      "tension": [{ "target": "pos-xxxx" | "<prior path>", "why": "<one line>", "kind": "updates" | "tension" }]
    }
  ],
  "alsoNew": [{ "source": "<candidate path>", "line": "<one line>" }],
  "threads": [{ "target": "<existing spark or pondering path>" | null, "title": "<new spark title, or empty>", "oneLiner": "<new spark one-liner, or empty>", "bullets": [{ "text": "<her idea, first person>", "sources": ["<path>"] }] }]
}`;

  const sources = candidates
    .map(
      (c) =>
        `<candidate path="${c.path}" kind="${c.kind}" created="${c.created}" title="${c.title}">\n${c.excerpt}\n</candidate>`,
    )
    .join('\n\n');
  const thoughtBlock = thoughts.length
    ? thoughts
        .map(
          (t) =>
            `<thought path="${t.path}" title="${t.title}">\n${t.earlierText ? `<earlier>\n${t.earlierText}\n</earlier>\n` : ''}<new>\n${t.newText}\n</new>\n</thought>`,
        )
        .join('\n\n')
    : '(none)';
  const user = `Today is ${date}. Here are the ${candidates.length} new candidates. Pick at most ${cap}; every other one goes in alsoNew.

${sources || '(no new candidates)'}

## Kaya's thoughts this week (her own words)
${thoughtBlock}`;
  return { system, user };
}

export function parseDigestResponse(text: string): DigestModel {
  return parseWith(DigestSchema, text, 'digest response');
}

/* ─── Position extraction ──────────────────────────────────────────────── */

const ExtractionSchema = v.object({
  claims: v.array(
    v.object({
      text: v.string(),
      topic: v.string(),
      source: v.string(),
      relation: v.picklist(['new', 'same', 'updates', 'tension']),
      target: v.optional(v.nullable(v.string()), null),
    }),
  ),
});

export function buildExtractionPrompt(input: {
  sources: { path: string; title: string; kind: string; body: string }[];
  positions: { id: string; topic: string; text: string }[];
}): Prompt {
  const topics = [...new Set(input.positions.map((p) => p.topic))];
  const system = `You maintain Kaya's positions ledger: a list of the claims she herself holds, one line each, grouped by topic.

Extract only Kaya's OWN standalone claims from the sources below. A claim qualifies only if:
- Kaya asserts it herself (or explicitly endorses someone else's view: "Boris is right that…", "I agree…").
- It stands on its own without the source for context.
- A reasonable person could disagree with it. "Agents need a gate more than more tools" qualifies; "agents are a hot topic" does not.

Drop:
- Summaries or descriptions of what the source covers ("she discusses pricing").
- Claims she only reports from others ("Boris says…", "the guest argued…") unless she clearly endorses them.
- Facts, logistics, questions, and anything hedged into meaninglessness.

Write each claim as one plain declarative sentence in Kaya's words where possible. No "Kaya thinks"; just the claim. Most sources yield 0–5 claims; returning none is fine.

Compare every claim to the existing positions:
- "same": it says the same thing as an existing position → target = that id.
- "updates": it replaces an existing position; her view has moved → target = the old id.
- "tension": it genuinely conflicts with an existing position and neither clearly wins → target = that id.
- "new": nothing existing covers it → target = null.

"topic" is a short noun phrase. Reuse an existing topic when it fits. Existing topics: ${topics.length > 0 ? topics.join('; ') : '(none yet)'}.
"source" is the exact path of the source the claim came from.

## Existing positions
${bulletList(
  input.positions.map(positionLine),
  '(none yet)',
)}

## Output
Return only JSON:
{"claims": [{"text": "...", "topic": "...", "source": "<path>", "relation": "new" | "same" | "updates" | "tension", "target": "pos-xxxx" | null}]}`;

  const user = input.sources
    .map((s) => `<source path="${s.path}" kind="${s.kind}" title="${s.title}">\n${s.body}\n</source>`)
    .join('\n\n');
  return { system, user };
}

export function parseExtractionResponse(text: string): ExtractedClaim[] {
  return parseWith(ExtractionSchema, text, 'extraction response').claims;
}

/* ─── Voice learning ───────────────────────────────────────────────────── */

const VoiceSchema = v.object({
  rules: v.array(v.object({ text: v.string(), learnedFrom: v.array(v.string()) })),
});

export function buildVoicePrompt(input: {
  pairs: { draft: string; final: string; takeTitle: string; takePath: string }[];
  rules: string[];
}): Prompt {
  const system = `You learn Kaya's writing voice from how she rewrites drafted takes. Each pair below is a draft and the version she actually kept.

Propose a voice rule ONLY for a pattern you can see in at least 2 separate pairs. A single rewrite is a one-off, not a rule. A wrong rule distorts every future draft, while a missing rule costs her one more edit, so when in doubt return {"rules": []}.

Each rule:
- is one short imperative about HOW she writes (structure, tone, length, word choice), e.g. "Lead with the position, then the reason." Not about what she believes.
- is not already covered by an existing rule.
- lists in "learnedFrom" the exact takePath of every pair that shows the pattern (at least 2).

## Existing rules
${bulletList(input.rules, '(none yet)')}

## Output
Return only JSON: {"rules": [{"text": "...", "learnedFrom": ["<takePath>", "<takePath>"]}]}`;

  const user = input.pairs
    .map(
      (p) =>
        `<pair takePath="${p.takePath}" title="${p.takeTitle}">\n<draft>\n${p.draft}\n</draft>\n<final>\n${p.final}\n</final>\n</pair>`,
    )
    .join('\n\n');
  return { system, user };
}

export function parseVoiceResponse(text: string): ProposedRule[] {
  return parseWith(VoiceSchema, text, 'voice response').rules;
}

/* ─── Weekly shifts ────────────────────────────────────────────────────── */

const ShiftsSchema = v.object({
  moved: v.optional(v.array(v.object({ from: v.string(), to: v.string(), line: v.string() })), []),
  tension: v.optional(v.array(v.object({ a: v.string(), b: v.string(), line: v.string() })), []),
  sparks: v.optional(
    v.array(
      v.object({
        spark: v.string(),
        evidence: v.optional(v.array(v.string()), []),
        line: v.string(),
      }),
    ),
    [],
  ),
});

export function buildShiftsPrompt(input: {
  takes: { path: string; text: string }[];
  moved: { from: Position; to: Position }[];
  tensions: { a: Position; b: Position }[];
  sparks: { path: string; body: string }[];
}): Prompt {
  const system = `You write the weekly "Shifts" summary of how Kaya's thinking moved this week. She reads it in seconds, so every line is one short sentence, plain and specific, in her casual voice. No praise, no filler.

- "moved": for each position change given, one line on what changed in her view and why (use the takes for the why when they say). Use the exact from/to ids given.
- "tension": for each unresolved pair given, one line naming the actual conflict. Use the exact a/b ids given.
- "sparks": only open sparks that this week's takes genuinely bear on. "evidence" = the exact take paths that bear on it; "line" = what the new evidence suggests. Skip sparks nothing touched.

Use only ids and paths given here. Never invent a shift; empty lists are fine.

## Output
Return only JSON:
{"moved": [{"from": "pos-xxxx", "to": "pos-yyyy", "line": "..."}], "tension": [{"a": "pos-xxxx", "b": "pos-yyyy", "line": "..."}], "sparks": [{"spark": "<spark path>", "evidence": ["<take path>"], "line": "..."}]}`;

  const takes = input.takes.map((t) => `<take path="${t.path}">\n${t.text}\n</take>`).join('\n\n');
  const moved = bulletList(
    input.moved.map((m) => `from ${positionLine(m.from)}\n  to ${positionLine(m.to)}`),
    '(none)',
  );
  const tensions = bulletList(
    input.tensions.map((t) => `${positionLine(t.a)}\n  vs ${positionLine(t.b)}`),
    '(none)',
  );
  const sparks = input.sparks.map((s) => `<spark path="${s.path}">\n${s.body}\n</spark>`).join('\n\n');
  const user = `## This week's takes
${takes || '(none)'}

## Positions that moved
${moved}

## Unresolved tensions
${tensions}

## Open sparks
${sparks || '(none)'}`;
  return { system, user };
}

export function parseShiftsResponse(text: string): ShiftsModel {
  return parseWith(ShiftsSchema, text, 'shifts response');
}

/* ─── Thinking exercise ────────────────────────────────────────────────── */

const QuestionSchema = v.object({
  done: v.optional(v.boolean(), false),
  question: v.optional(v.nullable(v.string()), null),
});

export interface ExerciseContext {
  title: string;
  sourcePath: string;
  excerpt: string;
  positions: { id: string; topic: string; text: string }[];
  rounds: { question: string; answer: string }[];
  maxRounds: number;
}

function renderRounds(rounds: { question: string; answer: string }[]): string {
  if (!rounds.length) return '(none yet)';
  return rounds.map((r, i) => `Q${i + 1}: ${r.question}\nKaya: ${r.answer || '(no answer)'}`).join('\n\n');
}

export function buildQuestionPrompt(ctx: ExerciseContext): Prompt {
  const system = `You run a short Socratic thinking exercise with Kaya about one thing she read or heard. You ask ONE question at a time. The goal is her thinking, not yours: never argue, summarize the source back, or offer your opinion.

${KAYA_VOICE} Ask questions the way a sharp friend would: short, specific, casual, no preamble.

Each question must be specific to this item and build on what she has already said. Over the exercise, cover what's missing from this list, roughly in order:
1. what's the actual claim here, and does she buy it
2. how it connects to (or cuts against) one of HER positions below; name the position in plain words
3. the strongest counter to her view (steelman), and whether it moves her
4. idea forks: what other ideas or people this makes her think of
5. so what: what she'd do, build, or ask differently because of it

Stop when you have enough for a real pondering: at least 3 answered questions with substance, or ${ctx.maxRounds} questions total. If her last answer is thin or dodges, ask a sharper follow-up instead of moving on.

## Her positions
${bulletList(ctx.positions.map(positionLine), '(none yet)')}

## Output
Return only JSON: {"done": false, "question": "<one question>"} or, when you have enough, {"done": true, "question": null}.`;
  const user = `<item path="${ctx.sourcePath}" title="${ctx.title}">
${ctx.excerpt}
</item>

## The exercise so far
${renderRounds(ctx.rounds)}`;
  return { system, user };
}

export function parseQuestionResponse(text: string): { done: boolean; question: string | null } {
  const out = parseWith(QuestionSchema, text, 'question response');
  if (!out.done && !out.question?.trim()) throw new Error('question response: "question" is empty while done is false');
  return { done: out.done, question: out.question?.trim() || null };
}

const PonderingSchema = v.object({
  title: v.pipe(v.string(), v.minLength(3)),
  heterodox: v.optional(v.nullable(v.boolean()), null),
  ideas: v.array(v.string()),
  insights: v.optional(v.array(v.string()), []),
  people: v.optional(v.array(v.string()), []),
  forkIdeas: v.optional(v.array(v.string()), []),
  steelman: v.optional(v.string(), ''),
  relatedPositions: v.optional(v.array(v.string()), []),
});

export type PonderingResponse = v.InferOutput<typeof PonderingSchema>;

export function buildPonderingPrompt(ctx: Omit<ExerciseContext, 'maxRounds'>): Prompt {
  const system = `You turn Kaya's answers from a thinking exercise into one of her "pondering" notes. This is HER thinking: use only what she said in her answers. Never add ideas, claims, or opinions she didn't express. The source is context only; its claims are not hers.

${KAYA_VOICE} Keep her phrasing wherever you can; tighten, don't rewrite.

Fields:
- "title": her main idea as one statement in her style, lowercase-ish, ending with " ..." (e.g. "the averaging in culture is a result of the shape of the network, not the algos ...").
- "heterodox": true if her view goes against the common take, false if not, null if unclear.
- "ideas": 2–5 bullets, first person, the ideas she's pondering.
- "insights": 1–3 bullets on what in the source triggered them (attribute to the source).
- "people": names she mentioned (people to talk to or who think about this), exactly as she wrote them.
- "forkIdeas": other ideas she said this led to.
- "steelman": the strongest counter as she stated or accepted it; "" if she didn't engage one.
- "relatedPositions": ids of her positions below that this note supports, extends, or challenges.

## Her positions
${bulletList(ctx.positions.map(positionLine), '(none yet)')}

## Output
Return only JSON: {"title": "", "heterodox": null, "ideas": [], "insights": [], "people": [], "forkIdeas": [], "steelman": "", "relatedPositions": []}`;
  const user = `<item path="${ctx.sourcePath}" title="${ctx.title}">
${ctx.excerpt}
</item>

## The exercise
${renderRounds(ctx.rounds)}`;
  return { system, user };
}

export function parsePonderingResponse(text: string): PonderingResponse {
  return parseWith(PonderingSchema, text, 'pondering response');
}

/* ─── Speaking ─────────────────────────────────────────────────────────── */

const SPEAKING = `Kaya stutters and is practicing speaking. A point she can say well fits in ONE breath: at most ~12 words, plain spoken words, one idea, no lists or parentheses inside it. Pauses between points are fine; long run-on points are not.`;

const PrepSchema = v.object({
  prep: v.array(
    v.object({
      meeting: v.string(),
      points: v.array(v.object({ text: v.string(), sources: v.optional(v.array(v.string()), []) })),
      question: v.optional(v.string(), ''),
      sayOnce: v.optional(v.array(v.string()), []),
    }),
  ),
});

export function buildPrepPrompt(input: {
  meetings: {
    key: string;
    title: string;
    lastInstances: { path: string; excerpt: string }[];
    newMeetings: { path: string; title: string; date: string; excerpt: string }[];
  }[];
  priors: PriorsPack;
  thoughts: Thought[];
}): Prompt {
  const system = `You prep Kaya for her meetings today, two minutes before she walks in. ${SPEAKING}

${KAYA_VOICE}

For each meeting below:
1. "points": exactly three talking points she'd say in THIS meeting, in her first person.
   - When the meeting lists "new since last time", the points are about those: the companies and people she met since this meeting last happened, which is what she brings to the room. Pick the three most worth the room's time, preferring ones she has written about (takes, thoughts, first reactions, sparks). One company per point, as "<Name>: <what they do>, <her read>", one breath. What they do comes from the meeting note. Her read comes ONLY from her own words or positions; if she hasn't written a read on it, say plainly what's notable and add no opinion. Skip internal meetings, 1:1s and admin.
   - When nothing is new, use her own live thinking (thoughts, takes, sparks, positions) that fits what this meeting is about (see its last instances).
   "sources": the meeting path each point is about, plus every note or position id her read came from, copied exactly.
2. "question": the one question she's bringing, about one of those companies or the meeting's topic. Pointed, one breath.
3. "sayOnce": up to 5 names (companies, founders) or numbers from the points and question that she can't swap for another word. Prefer ones starting with a vowel sound or a hard stop. [] if none.
"meeting" is the meeting's key, copied exactly. Always try for three points.
${renderPriors(input.priors)}

## Output
Return only JSON: {"prep": [{"meeting": "<key>", "points": [{"text": "", "sources": [""]}], "question": "", "sayOnce": [""]}]}`;
  const thoughts = input.thoughts.length
    ? input.thoughts.map((t) => `<thought path="${t.path}" title="${t.title}">\n${t.newText}\n</thought>`).join('\n\n')
    : '(none this week)';
  const meetings = input.meetings
    .map((m) => {
      const last = m.lastInstances.map((l) => `<last-instance path="${l.path}">\n${l.excerpt}\n</last-instance>`).join('\n');
      const fresh = m.newMeetings.length
        ? m.newMeetings.map((n) => `<new path="${n.path}" date="${n.date}" title="${n.title}">\n${n.excerpt}\n</new>`).join('\n')
        : '(nothing new since last time)';
      return `<meeting key="${m.key}" title="${m.title}">\n${last}\n<new-since-last-time>\n${fresh}\n</new-since-last-time>\n</meeting>`;
    })
    .join('\n\n');
  return { system, user: `## Kaya's thoughts this week\n${thoughts}\n\n## Today's meetings\n${meetings}` };
}

export function parsePrepResponse(text: string): v.InferOutput<typeof PrepSchema> {
  return parseWith(PrepSchema, text, 'prep response');
}

const SayItSchema = v.object({
  points: v.array(v.string()),
  stuckWord: v.optional(v.string(), ''),
});

export function buildSayItPrompt(input: { title: string; body: string; voiceRules: string[] }): Prompt {
  const system = `You write the "Say it out loud" part of one of Kaya's notes: how she'd say this idea out loud to someone. ${SPEAKING}

${KAYA_VOICE}

Rules:
- "points": exactly three points, in her first person, made ONLY from what this note says. Never add ideas she didn't write. Together they tell the idea in order: what it is, why it matters, what follows.
- "stuckWord": one word from your points she can't swap for another (a name, a number, or a key word starting with a vowel sound like "interest", "insight", "investor"), the one most likely to catch. "" if none stands out.

## Her voice rules
${bulletList(input.voiceRules, '(none yet)')}

## Output
Return only JSON: {"points": ["", "", ""], "stuckWord": ""}`;
  return { system, user: `<note title="${input.title}">\n${input.body}\n</note>` };
}

export function parseSayItResponse(text: string): v.InferOutput<typeof SayItSchema> {
  return parseWith(SayItSchema, text, 'say-it response');
}
