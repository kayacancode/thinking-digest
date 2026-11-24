# Thinking Digest

An Obsidian plugin for thinking about what you read and hear. Capture anything you find online, get a daily digest with **your** take on each new meeting or clipping, and go deeper with a short Socratic thinking exercise that turns into one of your Ponderings. Takes are drafted in your voice from your own writing; you correct them in place, and the plugin learns your positions and voice from those edits.

- **Capture anything.** Save links with *Add link* (articles, X posts, anything with a URL) or with Obsidian Web Clipper. Add a first reaction if you like; it seeds your take.
- **Thinking exercises.** Choose *think about this* on any item: you get one question at a time, specific to the item and your positions. You answer in the note, and *Finish exercise* writes a 〰️ Pondering from your words only.
- **Your running notes count.** Anything new you write in `Fleeting Notes` (or with *Quick thought*) is read as your own words. Takes build on it, and **Threads** propose bullets that grow your ✨ Sparks and 〰️ Ponderings over the week. You tick what to keep. Notes tagged `#private` are never read.
- **What they claim / My take.** Each item separates the source's claims from your take, so someone else's opinion never shows up as yours.
- **Grounded.** Every draft cites your positions, posts or past takes. When it can't ground a take, it asks you one pointed question instead.
- **Positions ledger** (`Thinking/Positions.md`). Your claims, one line each, extracted from your Substack, notes and takes. Newer views supersede older ones (the old ones are struck through, never deleted). Your edits always win.
- **Voice rules** (`Thinking/Voice rules.md`). Rules are learned from patterns that repeat across your rewrites. A rule only takes effect after you move it above `## Proposed`.
- **Shifts.** On Fridays the digest also lists positions that moved, unresolved tensions, and your rewrite rate.

## The loop

1. **See something** → *Add link* (paste a URL, with an optional first reaction), or clip it with Web Clipper into `Clippings/`. **Think something** → write it in `Fleeting Notes` as you already do, or use *Quick thought*.
2. **Each morning** → the digest drafts your take on new clippings and meetings, separating "what they claim" from "my take".
   The digest's **Threads** section proposes bullets for your Sparks and Ponderings. A bullet extends an open Spark or a Pondering, or starts a new Spark (in your ✨ Spark template) when the same thought came up in 2+ notes or meetings that week. Tick the ones you want, edit them if you like, and they're added on the next run. A Spark becomes a Pondering when you run *think about this* on it.
3. **The one or two that matter** → click *〰️ think about this* to answer 3–5 questions, then *Finish exercise* to get a Pondering.
4. **Over time** → your Ponderings and edits update the positions ledger, and Friday's Shifts shows how your views moved.
5. **Say it out loud** → your thinking becomes something you can say in the room:
   - When a Spark gets a ticked thread, or *Finish exercise* writes a Pondering, its **Say it out loud** section is drafted: three one-breath points from that note, and the word you might get stuck on. Only blank sections are filled, never your own points.
   - On mornings a recurring meeting is due (learned from your meeting notes, e.g. a weekly IC), the digest opens with **Before ‹meeting›**: three one-breath talking points from your own notes and positions, the one question you're bringing, and names to say once, slowly.
   - The morning after a prepped meeting, its row is added to the *Practice log* table in `🗣️ Speaking Practice`, with the date and meeting filled in. You fill in the rest.

Private by design: no notifications, no server. The only network calls are to the model and your Substack feed.

## Install (BRAT)

1. Install **Obsidian42 - BRAT** from Community plugins.
2. BRAT → *Add Beta plugin* → `kayacancode/thinking-digest`.
3. Enable **Thinking Digest** in Community plugins.

## Setup

- **Model provider**
  - *Claude Code CLI* (the default) runs on your Claude subscription. The path to `claude` is auto-detected.
  - *Anthropic API key* uses an API key instead.
- **Folders.** Settings → Folders has a picker (type to search your vault) for every folder: sources, excluded, quick notes, Sparks (`Thinking/Sparks`), Ponderings (`Pondering`), other folders of your thinking (`Beliefs`), and where the plugin writes. Subfolders are included.
- **Capture**
  - **Add link**: run the command (or give it a hotkey). It pre-fills a URL from your clipboard. Full articles come through Readability; X posts come through X's public embed. Pages behind a login (LinkedIn, paywalls) save the title, description and link.
  - **Web Clipper** (desktop and iPhone Safari share sheet): install [Obsidian Web Clipper](https://obsidian.md/clipper) and set its note location to `Clippings`. Clipped notes feed the digest the same way.
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
| Add link | Saves any URL to `Clippings/`, with an optional first reaction |
| Quick thought | Adds one timestamped line to `Fleeting Notes/Thoughts YYYY-MM-DD` (Enter to save) |
| Think about this | Starts a thinking exercise on the current note, or on the digest item your cursor is in (same as the *〰️ think about this* links) |
| Next question | Adds the next question to the open exercise (after you answer the last one) |
| Finish exercise | Writes your answers up as a Pondering in `Pondering/`, then updates positions |
| Say it out loud for this note | Drafts the *Say it out loud* points on the open Spark or Pondering, if they're still blank |

How it works with each item: rewrite the take, leave it as is, answer the question under **My answer:**, or delete the item to reject it.

## Develop

```sh
npm install
npm test        # vitest
npm run build   # tsc + esbuild → main.js

# Headless run against a vault (reads the vault; all writes go to the sandbox folder)
npx tsx scripts/run.ts <vault> /tmp/td-sandbox digest-dry
npx tsx scripts/run.ts <vault> /tmp/td-sandbox addlink https://example.com/post "first reaction"
npx tsx scripts/run.ts <vault> /tmp/td-sandbox think "Clippings/Some article"
```

The design spec is in `docs/superpowers/specs/2026-11-22-thinking-digest-design.md`.
