# Thinking Digest: design

**Date:** 2026-11-22
**Status:** Draft for review
**Working name:** `thinking-digest` (plugin id `thinking-digest`, display name "Thinking Digest"). The brand is decided later; renaming means editing `manifest.json` before publishing.

## 1. Purpose

A private Obsidian plugin that helps Kaya sharpen her own thinking. Every weekday it:

- picks up to 5 new items (Granola meetings and clipped articles);
- drafts a take on each in her voice, grounded in what she has already written;
- shows where a take builds on or contradicts an earlier position.

Kaya corrects the drafts in place. Each corrected take is kept, and over time the record shows how her views move.

**What success looks like:**
- Reviewing a day's digest takes a few minutes.
- She keeps doing it daily.
- `Thinking/Takes/` becomes something she rereads.

### Non-goals
- Publishing, sharing, or a twin other people can ask.
- Email as an input.
- Any Bestmate backend, server, database, or embeddings.
- Notifications: no texts and no email, ever.
- Mobile support in v1. The plugin is desktop-only for now; see §11.

## 2. Vault facts this design relies on

Checked on 2026-11-22 in the vault `fιи∂ιиgѕ ... ʆც тємρlαтe 2` (iCloud).

- **`Granola notes/`**
  - About 677 entries, synced by the Granola Sync plugin.
  - Frontmatter includes `granola_id`, `title`, `created` (ISO), `updated`, `attendees`, `folders` and `transcript` (a link into `Granola notes/transcripts/`).
  - **File modification time is unreliable:** about 1,350 files were touched in one week by re-syncs. "New" must be based on frontmatter `created`, not mtime.
- **`Clippings/`** does not exist yet. Obsidian Web Clipper will be pointed at it. Clipper notes carry `source` (URL), `title`, `created` and usually `author` / `published`.
- **Priors:**
  - `Pondering/` (〰️, 4 notes) and `Thinking/Sparks/` (5 notes, created 2026-11-20, frontmatter `type: spark`, `one_liner`, `status`).
  - The vault's CLAUDE.md mentions `Beliefs/` (➰), but no Beliefs notes exist outside `Templates/`.
  - **Expect a cold start.** Early drafts will have little to ground on; see §6.
- **`Thinking/🧭 Thinking Home.md`** already lists the three latest notes in `Thinking/Digests` via Dataview. That folder is empty today.

## 3. User flow

1. Kaya opens Obsidian. If today is a digest day and today's digest is missing, the plugin first harvests earlier digests (§7), then writes `Thinking/Digests/YYYY-MM-DD.md`. While Obsidian stays open, it also checks at 07:30.
2. She opens the digest from Thinking Home or a notice ("Today's digest is ready").
3. For each item she rewrites the take, leaves it as is, or deletes the whole item.
4. At the next digest, her versions become notes in `Thinking/Takes/`.
5. Fridays, the digest adds a **Shifts** section (§8).

Commands:
- Thinking Digest: Generate today's digest
- Generate digest (dry run): writes to a scratch note and changes no state
- Harvest now
- Open today's digest

## 4. Picking sources

- **Candidates:**
  - Markdown files in the configured source folders (default `Granola notes`, `Clippings`).
  - Excluded: subfolders listed in settings (default `Granola notes/transcripts`), files already handled (§9), and files whose `created` (frontmatter, falling back to file creation time) is before the last digest's cutoff.
  - The first run looks back a configurable number of days (default 3).
- **Excerpts:**
  - Granola: the note body (summary and notes), not the linked transcript.
  - Clippings: the body.
  - Each is cut to a configurable character limit (default 6,000), keeping the start and dropping the end.
- **Ranking:** the model picks up to `dailyCap` items (default 5). It prefers substance (ideas, claims, decisions, disagreements) over logistics (scheduling, intros with no content). Items that touch an open Spark or a prior get a boost.
- **The rest** are listed under "Also new" as `[[link]]` plus one line, with no take. They're marked handled.
- **No candidates:** no digest is written. Today's date is recorded so the plugin doesn't retry all day.

## 5. Digest format

`Thinking/Digests/YYYY-MM-DD.md`:

```markdown
---
type: digest
date: 2026-11-23
items: 5
---
# Digest: Mon 23 Nov

## Stasht: what stays defensible ^td-a1b2c3
**Source:** [[Granola notes/2026-11-21, Stasht …]]
**What's new:** One line on what this item adds.

> [!take]
> Draft take: two to four sentences, first person, in Kaya's voice.

**Builds on:** [[Thinking/Sparks/Does it get smarter, or do the models]]
**In tension with:** [[Thinking/Takes/2026-10-03 …]]: one line on why

## Also new
- [[Clippings/…]]: one line
```

- Every item heading ends with a block id `^td-<6 hex chars>`. The harvester uses it to find the item.
- **The original drafts are not stored in the vault.** They live in the plugin's `data.json`, keyed by digest date and block id, which keeps the note clean.
- **Links are checked before writing.** Any `Builds on` or `In tension with` link that doesn't point to an existing file is removed. If none are left, that line is dropped.
- **Unknown voice:** if the model has no grounded take, the callout says `No take yet. What do you think?` and `draft` is stored as empty.

## 6. Grounding in her own writing (priors and voice)

Each generation sends the model a priors pack:

- every note in `Pondering/` and in `Beliefs/` (if it exists), plus open Sparks (`status` not `archived`);
- the 40 most recent Takes, with rewrites first. Rewrites are where the draft got her wrong, and they teach voice and stance;
- each prior given as its path, title and body (cut to 1,500 characters).

Rules in the prompt:

- **Write as her, plainly.** First person, two to four sentences, a concrete position, no hedging filler.
- **Cite at least one prior when a position comes from one.** Otherwise say it's a first reaction and don't pretend it's settled.
- **Flag tension, not quibbles.** Only flag it when the new take would contradict a prior's actual claim.
- **When unsure, write "No take yet. What do you think?"** A wrong confident take anchors her (the Bestmate correction-rules lesson: a missed rule costs one correction, a made-up one warps everything after it).

Cold start: with fewer than about 10 priors, expect more "No take yet" items. That's intended.

## 7. Harvest

Runs before each generation and from the "Harvest now" command. It processes digests dated before today that haven't been harvested yet:

| What's in the digest | Verdict | What happens |
|---|---|---|
| Callout text differs from the stored draft (whitespace normalized) | `rewrote` | A Take note is written |
| Callout text identical to the draft, and the draft isn't empty | `kept` | A Take note is written |
| Block id missing (item deleted) | `rejected` | Recorded in `data.json` only |
| Callout still says "No take yet…" | `skipped` | Nothing |

Take note: `Thinking/Takes/YYYY-MM-DD - <item title>.md`

```markdown
---
type: take
date: 2026-11-23
source: "[[Granola notes/…]]"
verdict: rewrote
digest: "[[Thinking/Digests/2026-11-23]]"
builds_on: ["[[…]]"]
in_tension_with: ["[[…]]"]
---
<Kaya's final text>

%% draft: <original draft> %%
```

The original draft goes in the Take note (as a hidden Obsidian comment) so the gap between draft and final stays visible in the vault. Once a digest is harvested it is never harvested again. Edits made to it later don't change Takes already written.

## 8. Weekly shifts (Fridays, configurable)

The digest adds a `## Shifts this week` section, built from this week's Takes plus the priors:

- **Moved:** takes that move away from an earlier take or Pondering on the same subject. Links to both, with one line on what changed.
- **Unresolved tension:** pairs flagged with `in_tension_with` this week.
- **Sparks with new evidence:** open Sparks that this week's items touched, with links.

If there are no Takes that week, the section is left out.

## 9. State (`data.json`, not in the vault)

```ts
{
  settings: Settings,
  lastRunDate: string | null,         // YYYY-MM-DD; covers "no candidates today"
  cutoff: string | null,              // ISO; created-after boundary for the next run
  handled: Record<string, string>,    // file path → digest date that handled it
  drafts: Record<string, Record<string, { title: string; source: string; draft: string; buildsOn: string[]; inTension: string[] }>>, // digest date → block id → draft
  harvested: string[],                // digest dates already harvested
  rejections: { date: string; source: string }[]
}
```

- Path keys are updated on `vault.on('rename')`.
- Drafts for harvested digests are pruned after 30 days.

## 10. Settings

| Setting | Default |
|---|---|
| Anthropic API key | empty (required; stored in `data.json`) |
| Model | the latest Claude Sonnet model id, looked up in Anthropic's model docs when the plugin is built; editable |
| Source folders | `Granola notes`, `Clippings` |
| Excluded subfolders | `Granola notes/transcripts` |
| Prior folders | `Pondering`, `Beliefs`, `Thinking/Sparks` |
| Digest folder | `Thinking/Digests` |
| Takes folder | `Thinking/Takes` |
| Daily cap | 5 |
| Digest time | 07:30 |
| Digest days | Mon–Fri |
| Shifts day | Friday |
| First-run lookback | 3 days |
| Excerpt cap | 6,000 characters |

The API key stays in plugin data. Never write it into the vault.

## 11. Architecture

- TypeScript, esbuild and Jest, following `obsidian-granola-sync`'s setup (eslint with `eslint-plugin-obsidianmd`, `manifest.json`, `versions.json`, release workflow).
- `isDesktopOnly: true` for v1.
- The core uses no Node APIs, which leaves room for mobile later.
- HTTP goes through Obsidian's `requestUrl` (no CORS issues, works on every platform).

**Modules.** Pure modules take plain data and are unit-tested; the vault and network sit at the edges.

| Module | What it does | Pure? |
|---|---|---|
| `sources.ts` | Lists candidate files and extracts `created` and the excerpt | Edge (vault) |
| `priors.ts` | Builds the priors pack | Edge (vault) |
| `prompt.ts` | Builds the generation prompt from candidates and priors; parses and validates the model's JSON (valibot) | Pure |
| `digest.ts` | Renders the digest markdown and block ids; checks links against a list of existing paths | Pure |
| `harvest.ts` | Compares parsed digest items to stored drafts, assigns verdicts, renders Take notes | Pure |
| `shifts.ts` | Builds the Shifts input and renders that section | Pure |
| `anthropic.ts` | One Messages API call via `requestUrl`, with a timeout and one retry on 429/5xx | Edge (network) |
| `scheduler.ts` | Decides whether a digest is due: digest day, today's digest missing, `lastRunDate` not today, time ≥ digest time | Pure |
| `main.ts` | Plugin lifecycle, commands, settings tab, 07:30 check, rename tracking | Glue |

**Model call:** one call per digest. Input: candidates (path, title, excerpt), the priors pack, and today's date. Output is strict JSON:

```json
{"items":[{"source":"…","title":"…","whatsNew":"…","take":"…|null","buildsOn":["path"],"inTension":[{"path":"…","why":"…"}]}],"alsoNew":[{"source":"…","line":"…"}]}
```

- If the JSON doesn't parse or validate, it's retried once with the error message; the second failure goes to error handling (§12).
- Shifts is a second call, on Fridays only.

## 12. Errors

- **No API key:** a notice explains how to add one. No digest, no state change.
- **API or validation failure after the retry:**
  - The digest note contains only `> [!warning] Digest failed: <reason>. Run "Generate today's digest" to retry.`
  - Candidates are **not** marked handled.
  - `lastRunDate` is not set, so opening Obsidian again retries.
- **Partial failure** can't happen: the digest is written in one go after validation succeeds.
- **Harvest errors** on one digest (e.g. the file is missing) are logged and that digest is skipped. Generation still runs.
- **Logs** go to the developer console with a `[thinking-digest]` prefix. Nothing goes to the network except the Anthropic call.

## 13. Testing and verification

**Unit (Jest), pure modules only:**
- prompt output validation: valid, malformed, and links to unknown paths
- harvest verdicts: rewrote, kept, rejected, skipped; whitespace normalization
- digest rendering round-trip: render, then parse block ids and callouts back
- scheduler decisions across days, times, and an existing or missing digest
- source filtering by frontmatter `created`, cutoff and handled set (mtime ignored)

**Real-data check before relying on it:**
1. Build, then symlink the plugin into the vault's `.obsidian/plugins/thinking-digest`.
2. Run **Generate digest (dry run)** against this week's real Granola notes. Kaya reads the scratch note: are the picks right, does it sound like her, are the citations real?
3. Only after that, run a real generation, edit two items and delete one, then **Harvest now**. Check the Take notes and verdicts.
4. Turn on the daily check.

## 14. Risks and open questions

- **Thin priors at the start** (4 Ponderings, 5 Sparks, no Beliefs). Voice quality depends on rewrites piling up. The "No take yet" fallback limits the damage.
- **Granola re-sync rewrites files.** Using `created` handles new-ness. A note re-synced with new content will not come back.
- **iCloud sync conflicts** if another device edits a digest while harvest runs. Harvest only reads digests and writes new Take files, so the risk is low.
- **Cost:** about 25–40k input tokens per digest with priors [INFERENCE]. Cents per day on Sonnet. The priors cap (40 Takes, 1,500 characters each) keeps it bounded.
- **Brand:** the working name stays until after the Stanley / mentor conversation (Bestmate name rights).
