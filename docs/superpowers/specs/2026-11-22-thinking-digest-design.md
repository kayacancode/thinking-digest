# Thinking Digest: design

**Date:** 2026-11-22 (rev 2: brings in the ideas from Bestmate's capture and judgment pipeline)
**Status:** Draft for review
**Working name:** `thinking-digest` (plugin id `thinking-digest`, display name "Thinking Digest"). The brand is decided later; renaming means editing `manifest.json` before publishing.

## 1. Purpose

A private Obsidian plugin that helps Kaya sharpen her own thinking.

Every weekday it:
- picks up to 5 new items (Granola meetings and clipped articles);
- separates what *they* claim from what *she* thinks;
- drafts her take, grounded in her own published writing and past takes, or asks one pointed question when it can't ground one;
- flags where the take updates or contradicts an earlier position.

Her corrections teach it two things:
- **her positions**, kept in a ledger;
- **her voice**, kept as an editable rules note.

Kaya writes on Substack (`kayajones.substack.com`). Those essays are her most developed thinking, so they are the plugin's main source for her positions and voice. Publishing is **not** a goal.

**What success looks like:**
- Reviewing a day's digest takes a few minutes.
- She keeps doing it daily.
- `Thinking/Takes/` and the positions ledger become things she rereads.
- Drafts need fewer rewrites over time.

### Non-goals
- Publishing, post ideas or drafts, sharing, or a twin other people can ask.
- Email as an input.
- Any Bestmate backend, server, database, embeddings or cron.
- Notifications: no texts and no email, ever.
- Mobile support in v1. The plugin is desktop-only for now; see §14.

## 2. Ideas taken from Bestmate, and the improvements

| Bestmate source | Idea kept | Improvement |
|---|---|---|
| `fn/scripts/ingest-article.ts`, public twin flow | Her Substack posts are first-class evidence of what she thinks | Imported as vault notes she owns and can read (§4). Bestmate hid them in a Firestore knowledge base. |
| `fn/services/worldview.ts` | Split sources into standalone claims; **never answer as the owner using someone else's claim**; merge duplicate claims by normalized key | Each digest item shows *What they claim* and *My take* side by side. Her own claims live in a ledger with a citation to each source (§5). |
| `fn/services/research-interview.ts` | Ask questions that draw out the owner's take instead of guessing | Used **instead of** a weakly grounded draft, never on top of one. One question, not 2–3 (§7). |
| `fn/services/correction-rules.ts` | Tell a standing correction apart from a one-off; when in doubt, add no rule | Rules go in a note she can see and edit, each with its source. A hard cap with **visible** overflow replaces Bestmate's silent drop after 6,000 characters (§9). Rules come only from patterns that repeat across ≥2 rewrites. |
| `fn/services/supersession.ts` / `contradiction.ts` | Newer positions replace older ones; flag real conflicts | Updates are explicit: an `updates:` link on the new entry, `superseded_by` on the old one. Nothing is deleted. Contradictions are only flagged against a cited, existing position (§5, §8). |
| `fn/services/interview-grades.ts` | Corrections are training signal | Her rewrite is the grade, so there's no extra ✓/≈/✗ step (§8). |
| SUS graph `EXTRACTION_SYSTEM` | Kaya's own judgment kept as a layer separate from the source claims; every claim cites its source | Every citation is checked against the vault before writing. Links to files that don't exist are removed (§6). |
| `fn/services/eval-runner.ts` | Measure the loop | Measures her actual edits (rewrite rate), not a judge model. Judge errors can't count as passes (§12). |

Left out: rag-v2, embeddings, tenants, twins, dreaming, Firestore. The corpus is small enough (about 20 essays, a few hundred takes a year) to send priors to the model directly.

## 3. Vault and source facts this design relies on

Checked on 2026-11-22.

- **Vault:** `fιи∂ιиgѕ ... ʆც тємρlαтe 2` (iCloud).
- **`Granola notes/`**
  - About 677 notes, synced by the Granola Sync plugin.
  - Frontmatter: `granola_id`, `title`, `created` (ISO), `updated`, `attendees`, `folders`, `transcript`.
  - **File modification time is unreliable:** about 1,350 files were touched in one week by re-syncs. "New" must use frontmatter `created`.
- **`Clippings/`** does not exist yet. Obsidian Web Clipper will be pointed at it. Clipper frontmatter: `source` (URL), `title`, `created`, often `author` / `published`.
- **Priors already in the vault:**
  - `Pondering/` (〰️, 4 notes) and `Thinking/Sparks/` (5 notes, `type: spark`, `one_liner`, `status`).
  - The vault's CLAUDE.md mentions `Beliefs/` (➰), but no Belief notes exist.
- **Substack:**
  - `https://kayajones.substack.com/feed` is public RSS with the **20 most recent posts, full HTML** in `content:encoded`. The newest is from 2026-11-22; the oldest in the feed is from 2026-01-11.
  - `/api/v1/archive?sort=new&limit=12` returns `{posts:[…]}` but rejects `offset`. It's not used for pagination.
  - For the full history, use Substack's official export (Settings → Exports, a zip of post HTML plus `posts.csv`).
- **`Thinking/🧭 Thinking Home.md`** already lists the latest notes in `Thinking/Digests` via Dataview. That folder is empty today.

## 4. Her writing (Substack import)

**Command: Import Substack.** Two sources:

1. **RSS** (the default; it refreshes before each digest). Fetch `<substackUrl>/feed` with `requestUrl`, then write or update `Writing/Substack/YYYY-MM-DD - <slug>.md` for each item.
2. **Export zip.** The command "Import Substack export…" takes the zip path. It reads `posts.csv` and `posts/<id>.<slug>.html`, and skips drafts and unpublished rows.

Note format (HTML converted to markdown; images become links):

```markdown
---
type: published
platform: substack
title: "your agent doesn't need more tools. it needs a gate."
url: https://kayajones.substack.com/p/…
published: 2026-…
audience: everyone
---
<post body as markdown>
```

- Notes are matched by `url`.
- If a post changed, the body is rewritten and the change is noted in `data.json`.
- Her edits to a Writing note are kept: if the note has changed since the last import, it is **not** overwritten, and the import reports it instead.
- Paid posts (`audience` other than `everyone`) are imported only from the export zip, since RSS shows only a preview.

After an import, any new or changed post goes through **position extraction** (§5).

## 5. Positions ledger

`Thinking/Positions.md` is one note, maintained by the plugin and editable by Kaya. It holds her claims in one line each, grouped by topic:

```markdown
## Agents
- Agents need a gate more than they need more tools. ^pos-7f3a
  - sources: [[Writing/Substack/2026-… - your agent doesnt need more tools]]
  - since: 2026-03-02
- ~~Personal AI is a feature, not a company.~~ ^pos-19c2
  - superseded_by: ^pos-a210 (2026-11-23)
```

**Extraction** (one call per new or changed source; sources are her posts, Ponderings, Sparks and harvested Takes):
- Each position must be a **standalone claim she makes**, something a person could disagree with. Summaries ("she discusses pricing") are dropped.
- Positions she **reports** from someone else ("Boris says…") are dropped unless she explicitly agrees. This follows `worldview.ts`'s rule that owner and world claims stay separate.
- Claims are compared to the existing ledger by normalized key. A matching claim adds a source to the existing entry; a new one becomes a new entry.

**Updates and conflicts:**
- If a new claim conflicts with an existing entry, the extractor marks it as either `updates` (her view moved) or `tension` (unresolved), citing both.
- On `updates`, the old entry is struck through, gets `superseded_by`, and stays in the note.
- On `tension`, both entries stay and the pair goes in the digest's Shifts section (§10).

**Her edits rule:**
- The ledger is parsed by block id (`^pos-xxxx`).
- She can edit text, delete entries, or move them between topics.
- A deleted block id is remembered as `retracted` and is never re-extracted from the same source.

Cold start: importing the Substack (about 20 posts) builds the first ledger. That fixes the thin-priors problem (only 4 Ponderings and 5 Sparks).

## 6. Picking items for the digest

- **Candidates:**
  - Markdown files in the source folders (default `Granola notes`, `Clippings`).
  - Excluded: subfolders listed in settings (default `Granola notes/transcripts`), files already handled, and files with `created` (frontmatter, falling back to file creation time) before the cutoff.
  - The first run looks back 3 days (configurable).
- **Excerpts:** the note body only (not the transcript), cut to 6,000 characters.
- **Ranking:**
  - The model keeps up to `dailyCap` (5) items.
  - It prefers substance (ideas, claims, decisions, disagreements) over logistics.
  - Items that touch an open Spark or a position in the ledger get a boost.
- **The rest** are listed under "Also new" (link plus one line) and marked handled.
- **No candidates:** no digest is written, and today's date is recorded so the plugin doesn't retry all day.
- **Citation check:** every link the model returns (source, position block ref, prior note) is checked against the vault index and ledger block ids before writing. Invalid links are removed. If an item's *grounding* citation is invalid, the item is downgraded to question mode (§7).

## 7. Digest item format

`Thinking/Digests/YYYY-MM-DD.md`. One item:

```markdown
## Stasht: what stays defensible ^td-a1b2c3
**Source:** [[Granola notes/2026-11-21, Stasht …]]

**What they claim**
- Frontier models will organize saved content better every quarter.
- Their edge is the social layer, not the organizing.

> [!take] My take
> Draft, two to four sentences, first person.

**Grounded in:** [[Thinking/Positions#^pos-7f3a]] · [[Writing/Substack/…]]
**Updates / in tension with:** [[Thinking/Positions#^pos-19c2]]: one line why
```

**Question mode** (`research-interview.ts`, improved). If the model can't ground a take in at least one valid position, post or take, it asks instead of guessing:

```markdown
> [!question] What do you think?
> One pointed question that pulls out her stance, e.g. "Is a social layer an accumulating asset by your test from 'Does it get smarter, or do the models', or still riding the models?"
```

She answers under the callout. Her answer becomes the take at harvest.

- Original drafts and questions are stored in `data.json`, keyed by digest date and block id. They are not written into the note.
- "What they claim" is limited to 4 bullets and must be attributed to the source. **A claim from the source never appears in "My take" unless one of her positions grounds it.**

## 8. Harvest

Runs before each generation, and from "Harvest now". It processes digests dated before today that haven't been harvested yet.

| What's in the digest | Verdict | What happens |
|---|---|---|
| Take text differs from the stored draft (whitespace normalized) | `rewrote` | A Take is written. The rewrite pair goes to voice learning (§9) |
| Take text identical to the stored non-empty draft | `kept` | A Take is written |
| Question answered (text added under the callout) | `answered` | A Take is written, with her answer as the text |
| Block id missing (item deleted) | `rejected` | Recorded in `data.json` only |
| Question with no answer | `skipped` | Nothing |

Take note: `Thinking/Takes/YYYY-MM-DD - <title>.md`

```markdown
---
type: take
date: 2026-11-23
source: "[[Granola notes/…]]"
verdict: rewrote
digest: "[[Thinking/Digests/2026-11-23]]"
grounded_in: ["[[Thinking/Positions#^pos-7f3a]]"]
updates: ["[[Thinking/Positions#^pos-19c2]]"]
---
<Kaya's final text>

%% draft: <original draft or question> %%
```

- Harvested Takes go through position extraction (§5).
- A harvested digest is never harvested again.

## 9. Voice rules

`Thinking/Voice rules.md` is a short, editable list. It goes into every drafting prompt.

```markdown
- Lead with the position, then the reason. No warm-up. ^vr-01
  - learned from: [[Thinking/Takes/2026-11-24 …]], [[Thinking/Takes/2026-11-26 …]]
- Lowercase is fine; don't add exclamation marks. ^vr-02
```

- **Learning:**
  - After harvest, the model gets all `rewrote` pairs from the last 14 days, plus the current rules.
  - It may propose a new rule **only when the same pattern shows up in ≥2 separate rewrites**.
  - The model may also answer "none"; that's the default when in doubt. A wrong rule distorts every draft, while a missed one costs one more edit.
- **Proposals:**
  - New rules are added at the bottom under `## Proposed`, each with its `learned from` links.
  - **A proposed rule is used in prompts only after she moves it above the `## Proposed` heading.** Rules don't take effect silently.
- **Cap:**
  - At most 25 active rules.
  - At the cap, new proposals are still written under `## Proposed` with a note that the cap is reached. Nothing is silently dropped (unlike Bestmate's `appendRuleToPersona`).
- **Her edits rule:** she can rewrite or delete any rule. A deleted rule's pattern goes on a do-not-propose list in `data.json`.

## 10. Weekly shifts (Fridays, configurable)

`## Shifts this week`, built from this week's Takes and ledger changes:

- **Moved:** ledger entries superseded this week, showing old vs new with sources.
- **Unresolved tension:** pairs marked `tension` this week.
- **Sparks with new evidence:** open Sparks that this week's items touched.
- **Drift check:** the rewrite rate this week vs the previous 4 weeks (§12). It tells her whether the drafts are getting closer to her voice.

The section is left out if there are no Takes and no ledger changes that week.

## 11. State (`data.json`, not in the vault)

```ts
{
  settings: Settings,
  lastRunDate: string | null,
  cutoff: string | null,                 // ISO created-after for the next digest
  handled: Record<string, string>,       // path → digest date
  drafts: Record<string, Record<string, DraftRecord>>,   // date → block id → draft/question, claims, citations
  harvested: string[],
  rejections: { date: string; source: string }[],
  imports: Record<string, { url: string; hash: string; path: string }>,  // Substack posts, keyed by url
  extracted: Record<string, string>,     // source path → content hash last extracted
  retractedPositions: string[],          // pos ids she deleted
  rejectedRulePatterns: string[],
  metrics: { date: string; kept: number; rewrote: number; answered: number; rejected: number; skipped: number }[]
}
```

- Path keys are updated on `vault.on('rename')`.
- Drafts for harvested digests are pruned after 30 days.

## 12. Metrics

- Each harvest appends a `metrics` row.
- **Rewrite rate** = rewrote ÷ (kept + rewrote), over taken items.
- It's shown in the Friday Shifts section and in the settings tab.
- This measures the loop against what she actually does, not a model's judgment, so a model or network failure can never count as "kept".

## 13. Settings

| Setting | Default |
|---|---|
| Model provider | Claude Code CLI (`claude -p` with settings, tools, MCP and sessions off; runs on her subscription), or Anthropic API key |
| Claude CLI path | auto-detected (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) |
| Anthropic API key | empty (only for the API provider) |
| Model | the latest Claude Sonnet model id, looked up in Anthropic's model docs when the plugin is built; editable |
| Substack URL | `https://kayajones.substack.com` |
| Writing folder | `Writing/Substack` |
| Source folders | `Granola notes`, `Clippings` |
| Excluded subfolders | `Granola notes/transcripts` |
| Prior folders | `Pondering`, `Beliefs`, `Thinking/Sparks` |
| Digest / Takes folders | `Thinking/Digests`, `Thinking/Takes` |
| Positions / Voice rules notes | `Thinking/Positions.md`, `Thinking/Voice rules.md` |
| Daily cap | 5 |
| Digest time / days | 07:30, Mon–Fri |
| Shifts day | Friday |
| First-run lookback | 3 days |
| Excerpt cap | 6,000 characters |
| Max active voice rules | 25 |

The API key stays in plugin data and is never written into the vault.

## 14. Architecture

- TypeScript, esbuild, vitest; `tsc --noEmit` as the lint.
- `isDesktopOnly: true` for v1.
- The core uses no Node APIs. The zip import uses a pure-JS unzip library (e.g. `fflate`).
- HTTP goes through Obsidian's `requestUrl`. The CLI provider spawns `claude` from Node (`src/exec.ts`); that's one reason the plugin is desktop-only.
- `scripts/run.ts` runs the same pipeline headless against a vault on disk. It reads the vault, and every write goes to a sandbox folder.

**Modules.** Pure modules take plain data and are unit-tested; the vault and network sit at the edges.

| Module | What it does | Pure? |
|---|---|---|
| `substack.ts` | Parses RSS and the export zip into posts; converts HTML to markdown; builds note text | Pure (fetch and file reading in glue) |
| `positions.ts` | Parses and renders the ledger by block id; merges extracted claims by normalized key; applies updates and tension; honors retractions | Pure |
| `voice.ts` | Parses and renders Voice rules; finds active vs proposed; applies the cap; checks the do-not-propose list | Pure |
| `sources.ts` | Lists candidate files; reads `created` and excerpts | Edge |
| `priors.ts` | Builds the priors pack: active voice rules, live ledger entries, open Sparks, Ponderings, last 40 Takes with rewrites first | Edge |
| `prompts.ts` | Prompt builders and valibot schemas for the four calls: digest, extraction, voice, shifts | Pure |
| `citations.ts` | Validates links against a path index and ledger block ids; downgrades items to question mode | Pure |
| `digest.ts` | Renders the digest; parses it back (block ids, take or question callouts, answers) | Pure |
| `harvest.ts` | Assigns verdicts; renders Takes; produces rewrite pairs and metrics | Pure |
| `shifts.ts` | Shifts input and rendering | Pure |
| `anthropic.ts` | Messages API via `requestUrl`; timeout; one retry on 429/5xx | Edge |
| `scheduler.ts` | Decides whether a digest is due | Pure |
| `main.ts` | Lifecycle, commands, settings tab, 07:30 check, rename tracking, run order | Glue |

**Order of a run:**
1. Refresh Substack via RSS, then extract from new or changed posts.
2. Harvest, then extract from new Takes, then voice learning.
3. Generate the digest.
4. On Fridays, add Shifts.

Each step writes its results before the next one starts. If a step fails, later steps still run where they can (§15).

**Model calls:**
- Each call returns strict JSON checked by valibot.
- An invalid response is retried once with the validation error.
- Calls per weekday: one for the digest; one for extraction per new source (batched up to 5 sources per call); one for voice learning, only if there are rewrites; one for Shifts on Fridays.

**Commands:**
- Generate today's digest
- Generate digest (dry run): writes a scratch note and changes no state
- Harvest now
- Import Substack
- Import Substack export…
- Rebuild positions (dry run): shows the proposed ledger in a scratch note
- Open today's digest

## 15. Errors

- **No API key:** a notice; nothing runs.
- **Substack fetch failure:** a notice, and the run continues with the existing Writing notes.
- **Extraction or voice-learning failure:** logged. That source stays un-extracted (its hash isn't recorded) and is retried next run. Digest generation continues.
- **Digest failure after the retry:**
  - The note contains only `> [!warning] Digest failed: <reason>. Run "Generate today's digest" to retry.`
  - Candidates are not marked handled, and `lastRunDate` is not set.
- **Writes happen only after validation**, so nothing is ever half-written.
- **Harvest errors on one digest:** logged and skipped.
- **Logging:** the developer console with a `[thinking-digest]` prefix. The network is touched only for the Anthropic API and Substack.

## 16. Testing and verification

**Unit tests (Jest), pure modules:**
- Substack: RSS parsing on a saved copy of the real feed; export zip parsing on a small fixture; HTML-to-markdown on her post structures.
- Positions: merging by normalized key; updates (struck through, `superseded_by`); tension; retraction honored on re-extract; her manual edits survive a re-render.
- Voice: a rule proposed only from ≥2 rewrite pairs; proposed rules not used in prompts; cap overflow is visible; the do-not-propose list is respected.
- Citations: invalid links removed; invalid grounding downgrades to question mode.
- Digest round-trip: render, then parse (block ids, take vs question, answers).
- Harvest: all five verdicts; whitespace normalization; metrics rows.
- Scheduler: days, times, existing or missing digest.
- Sources: filtered by frontmatter `created` (mtime ignored), cutoff, handled set.

**Real-data check, step by step:**
1. Build, then symlink the plugin into the vault's `.obsidian/plugins/thinking-digest`.
2. **Import Substack** from RSS. Check that 20 notes appear in `Writing/Substack/`.
3. **Rebuild positions (dry run).** Kaya reads the proposed ledger. Are these really her claims, are other people's claims excluded, are the citations right?
4. **Generate digest (dry run)** on this week's real Granola notes. Kaya judges the picks, the claims vs take split, her voice, and whether question mode triggers when it should.
5. A real digest: edit two takes, answer one question, delete one item, then **Harvest now**. Check the Takes, verdicts, metrics and ledger updates.
6. Turn on the daily check.

## 17. Risks and open questions

- **Paid posts:** RSS shows only a preview for posts with `audience` other than `everyone`. The full history needs the export zip; that is a one-time manual step.
- **The ledger as a trap:** a stale position could anchor her drafts. This is mitigated by grounding on recent Takes (newest first), `updates` handling, and her edits to the ledger. Watch the drift check.
- **Granola re-sync** rewrites files. Using `created` handles new-ness, but notes re-synced with new content don't come back.
- **iCloud conflicts:** the plugin writes Positions and Voice rules, which she may edit on another device. Each write first re-reads the file and merges by block id, so her edits win over the plugin's.
- **Cost:** about 30–50k input tokens on a weekday with priors, plus a one-time extraction over about 20 posts [INFERENCE]. Low single-digit dollars a month on Sonnet [INFERENCE]. The priors are capped (ledger entries, 40 Takes, 25 rules).
- **Brand:** the working name stays until a final name is chosen.

## 18. Rev 3 (2026-11-23): capture anything, thinking exercises

**Capture.**
- *Add link* (modal; the URL is pre-filled from the clipboard; optional first reaction) saves to `Clippings/` with Web-Clipper-shaped frontmatter (`title`, `source`, `author`, `site`, `published`, `created`).
- How content is fetched (`src/capture.ts`):
  - Articles: Readability.
  - X posts: `publish.x.com/oembed`.
  - Login-walled pages: Open Graph title and description.
  - Fetch failures: the link alone is saved, and the user is told.
- A first reaction is stored as `> [!take] My first reaction`. The digest prompt treats it as Kaya's own words and builds the take from it first (digest rule 9).
- Obsidian Web Clipper, pointed at `Clippings/`, is the browser and iPhone path. No code needed.

**Thinking exercise.** A Socratic exercise held in one note: `Thinking/Exercises/YYYY-MM-DD - <title>.md`.
- *Think about this* starts it:
  - from the current note;
  - from the digest item under the cursor (`sourceAtLine`);
  - from the `〰️ think about this` link on every digest item and Also-new line (`obsidian://thinking-digest?think=<path>`).
- An open exercise for the same source is reopened rather than duplicated.
- *Next question* asks one question at a time: claim → link to her positions → steelman → idea forks → so what.
  - Each question adapts to her answers and asks a sharper follow-up when an answer is thin.
  - It stops once it has enough, or at `maxRounds` (default 5).
  - It refuses to continue until the last question has an answer.
- *Finish exercise* writes `Pondering/〰️ <title>.md` in her Pondering template:
  - fields: `Date created`, `Heterodox`, `Related to ?` (with links to source and positions), and the `Ponderings` tag;
  - sections: Ideas i'm pondering, Insights that triggered ideas, and Idea Forks (People, Ideas, Steel man Counter);
  - **only her answers are used**, and people are linked only when a `People pages/p- <Name>` note exists.
- The exercise is then marked `status: done` with a link to the Pondering, and position extraction runs, so the new Pondering feeds the ledger.

**Verified on real data (headless harness, CLI provider):**
- Add link:
  - a Paul Graham essay, with the full body;
  - an X post, with its text and date;
  - LinkedIn, saved as a link-only fallback.
- Exercise on the essay:
  - Q1 used her first reaction; Q2 tied to her network-shape position.
  - Finish produced a faithful Pondering linked to 4 positions.
  - Extraction then added 2 positions from it.

## 19. Rev 4 (2026-11-23): running notes and threads into Ponderings

**Quick notes as her words.**
- Notes in `thoughtFolders` (default `Fleeting Notes`) are read every run as Kaya's own words. Only **new lines** are read: a per-note snapshot of line hashes is kept in `thoughtSeen`. That works for notes she edits across several days, where creation time says nothing.
- First contact: a note untouched for 7+ days becomes a silent baseline.
- Skipped: notes tagged `#private` (inline or frontmatter tags), notes with `private: true`, and code blocks.
- At most 15 notes per run, newest first.
- The snapshot is saved only after a successful non-dry digest.

**Own-words grounding (enforced in `checkDigest` via `ownWords`).**
- A take may only be grounded in a position or in her own words: quick notes, posts, takes, ponderings, sparks, beliefs, or a clipping with a first reaction.
- A meeting or article on its own is never grounding.

**Threads.** The digest model proposes bullets for her Ponderings, built only from her words.
- Each bullet needs at least one own-words source. Meetings may be added alongside, to show the thought recurring.
- A thread either extends an existing Pondering (exact path) or proposes a new one. A new one needs 2+ distinct sources and a title.
- Bullets are rendered under `## Threads` as `- [ ] text · [[sources]] ^th-xxxx`.
- At the next harvest, **ticked** bullets (with her edited text) are applied:
  - inside the Pondering's "Ideas i’m pondering" callout, replacing the template's empty bullet;
  - or, for free-form Ponderings, under `### Threads (date)`;
  - or in a new Pondering written in her template.
- Unticked bullets are dropped. Nothing changes a Pondering without a tick.

**Quick thought.** A modal (Enter saves) appends `- HH:MM text` to `<first thought folder>/Thoughts YYYY-MM-DD`.

**Verified on real data (sandbox):**
- Her real Fleeting Notes from this week (e.g. "Euler, NewCo") produced a new-Pondering thread that recurred across her note and two meetings.
- After own-words enforcement, takes cite only positions and her notes.
- A quick thought surfaced as a thread extending the existing frontier-map Pondering. Ticked with edited text, it landed inside the callout on harvest, and the proposal was cleared.

## 20. Rev 5 (2026-11-23): Threads grow Sparks; every folder is a setting

Kaya wants to actually use her Sparks (`Thinking/Sparks`, ✨ Spark template, listed on 🧭 Thinking Home). She chose "Sparks first".

**Threads.**
- `ThreadModel.target` replaces `pondering`. It can be any open Spark (`status` ≠ archived) or any Pondering.
- An unknown or missing target becomes a **new Spark**: a title, a `oneLiner`, 2+ distinct sources.
- Ticked bullets go in her template's places:
  - for a Spark, the end of "## What's new in my head" (the empty `- ` placeholder is dropped; her prompt line is kept);
  - for a Pondering, the "Ideas i’m pondering" callout;
  - otherwise, `### Threads (date)`.
- A new Spark is written in her ✨ Spark sections, with frontmatter `type: spark`, `status: open`, `created`, `one_liner`, `talk_to: []`, so it shows up in Thinking Home's "Open sparks". It's a Spark rather than a Pondering because that's where her new thoughts start. A Spark graduates to a Pondering via *think about this*.

**Folders.**
- New `sparksFolder` setting.
- Ponderings and Sparks are always read as her own words.
- `priorFolders` now means "other folders of your thinking" (default `Beliefs`; kind `note`).
- No folder name is hardcoded anymore:
  - candidate kind comes from frontmatter (`granola_id`/`attendees` → meeting, `source` or the clippings folder → clipping);
  - Shifts reads `sparksFolder`;
  - Quick thought errors if no quick-notes folder is set.
- Settings → Folders uses a type-to-search folder picker (`AbstractInputSuggest` over vault folders). Folder lists show one removable row per folder and flag folders that don't exist.

**Verified (sandbox, real vault):**
- A quick thought on AI restraint was routed to the existing "AI in the room" Spark. Ticked with edited text, it landed at the end of "What's new in my head", and the rest of the Spark was unchanged.
- A thought recurring in two notes proposed a new Spark, "Personal software as zines", with a one-liner. Ticking 2 of 3 bullets wrote an open Spark with only those 2.
