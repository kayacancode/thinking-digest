# Thinking Digest

An Obsidian plugin that turns what comes in each day (meetings, clipped articles) into a short digest of **your** takes. Each take is drafted in your voice from your own writing; you correct it in place, and it learns your positions and voice from those edits.

- **What they claim / My take.** Each item separates the source's claims from your take, so someone else's opinion never shows up as yours.
- **Grounded.** Every draft cites your positions, posts or past takes. When it can't ground a take, it asks you one pointed question instead.
- **Positions ledger** (`Thinking/Positions.md`). Your claims, one line each, extracted from your Substack, notes and takes. Newer views supersede older ones (the old ones are struck through, never deleted). Your edits always win.
- **Voice rules** (`Thinking/Voice rules.md`). Rules are learned from patterns that repeat across your rewrites. A rule only takes effect after you move it above `## Proposed`.
- **Shifts.** On Fridays the digest also lists positions that moved, unresolved tensions, and your rewrite rate.

Private by design: no notifications, no server. The only network calls are to the model and your Substack feed.

## Install (BRAT)

1. Install **Obsidian42 - BRAT** from Community plugins.
2. BRAT → *Add Beta plugin* → `kayacancode/thinking-digest`.
3. Enable **Thinking Digest** in Community plugins.

## Setup

- **Model provider**
  - *Claude Code CLI* (the default) runs on your Claude subscription. The path to `claude` is auto-detected.
  - *Anthropic API key* uses an API key instead.
- **Folders.** The defaults are `Granola notes` and `Clippings` as sources; `Pondering`, `Beliefs` and `Thinking/Sparks` as priors; `Writing/Substack` for imported posts. Change them in settings.
- **First run**
  1. **Import Substack**
  2. **Update positions now**
  3. **Generate digest (dry run)**. Read it.
  4. **Generate today's digest**
  5. Turn on **Run automatically** once you're happy with the output.

## Commands

| Command | What it does |
|---|---|
| Generate today's digest | Import Substack, harvest earlier digests, update positions, learn voice rules, then write `Thinking/Digests/YYYY-MM-DD` |
| Generate digest (dry run) | Writes `Dry run YYYY-MM-DD`; changes no state |
| Harvest now | Saves your edits from earlier digests as notes in `Thinking/Takes/` |
| Import Substack / Import Substack export… | RSS (latest 20 posts) or the official export zip (full history) |
| Update positions now / Rebuild positions (dry run) | Updates the ledger / previews a fresh one |
| Open today's digest | |

How it works with each item: rewrite the take, leave it as is, answer the question under **My answer:**, or delete the item to reject it.

## Develop

```sh
npm install
npm test        # vitest
npm run build   # tsc + esbuild → main.js

# Headless run against a vault (reads the vault; all writes go to the sandbox folder)
npx tsx scripts/run.ts <vault> /tmp/td-sandbox digest-dry
```

The design spec is in `docs/superpowers/specs/2026-11-22-thinking-digest-design.md`.
