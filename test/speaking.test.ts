import { describe, it, expect } from 'vitest';
import { addPracticeRow, checkPrep, checkSayIt, fillSayIt, meetingsDue, needsSayIt, newMeetingsSince, seriesKey } from '../src/speaking';

const note = (date: string, time: string, title: string) => ({ path: `Granola notes/${date}, ${title}`, title, date, created: `${date}T${time}:00.000Z` });

// Her real IC history from Granola, plus the week around it.
const meetings = [
  note('2026-10-29', '15:00', '💸Weekly IC touchbase'),
  note('2026-11-03', '14:00', '💸weekly IC 🔒Decisions meeting'),
  note('2026-11-03', '16:00', '💸weekly IC 🗣️Discussions meeting'),
  note('2026-11-10', '14:00', '💸weekly IC 🔒Decisions meeting'),
  note('2026-11-10', '16:00', '💸weekly IC 🗣️Discussions meeting'),
  note('2026-11-16', '14:00', '💸weekly IC 🔒Decisions meeting'),
  note('2026-11-09', '19:00', 'Kaya + JB'),
  note('2026-11-16', '19:00', 'Kaya + JB'),
  note('2026-11-17', '12:00', 'Agentic Nation with Rob'),
  note('2026-11-17', '16:00', '💸weekly IC 🗣️Discussions meeting'),
  note('2026-11-17', '18:00', 'Habitat computer <> betaworks'),
  note('2026-11-20', '23:00', 'Jocelyn x Kaya'),
  note('2026-11-23', '18:20', 'Stasht intro <> Betaworks'),
  note('2026-11-23', '19:00', 'Kaya + JB'),
  note('2026-11-23', '21:33', 'Black Nile AI platform for industrial plants with Sarah Khan'),
];
const decisions = seriesKey('💸weekly IC 🔒Decisions meeting');
const discussions = seriesKey('💸weekly IC 🗣️Discussions meeting');

describe('meetingsDue', () => {
  it('treats IC Decisions and Discussions as one IC on a Tuesday', () => {
    const tue = meetingsDue(meetings, '2026-11-24');
    expect(tue).toHaveLength(1);
    expect(tue[0]).toMatchObject({ key: 'weekly ic', title: '💸weekly IC', since: '2026-11-17T16:00:00.000Z' });
    expect(tue[0].keys.sort()).toEqual([decisions, discussions].sort());
  });

  it('preps only Decisions on a Monday, and nothing on a day no series meets', () => {
    expect(meetingsDue(meetings, '2026-11-23').map((m) => m.title)).toEqual(['💸weekly IC 🔒Decisions meeting']);
    expect(meetingsDue(meetings, '2026-11-26')).toEqual([]);
  });

  it("doesn't prep a meeting that already has today's note", () => {
    const happened = [...meetings, note('2026-11-24', '16:00', '💸weekly IC 🗣️Discussions meeting')];
    expect(meetingsDue(happened, '2026-11-24').map((m) => m.keys)).toEqual([[decisions]]);
  });
});

describe('newMeetingsSince', () => {
  it('lists the one-off meetings after the last IC, newest first, without 1:1s or meetings before it', () => {
    const [ic] = meetingsDue(meetings, '2026-11-24');
    expect(newMeetingsSince(meetings, ic, '2026-11-24').map((m) => m.title)).toEqual([
      'Black Nile AI platform for industrial plants with Sarah Khan',
      'Stasht intro <> Betaworks',
      'Jocelyn x Kaya',
      'Habitat computer <> betaworks',
    ]);
  });
});

describe('checkPrep', () => {
  const due = meetingsDue(meetings, '2026-11-24');
  const blackNile = 'Granola notes/2026-11-23, Black Nile AI platform for industrial plants with Sarah Khan';
  const pollentia = 'Granola notes/2026-11-23, Pollentia __ Betaworks';
  it('keeps points about this week’s meetings or her own words, drops the rest', () => {
    const out = checkPrep(
      [
        {
          meeting: 'weekly ic',
          points: [
            { text: 'Black Nile:  plant AI, only works if it transfers', sources: [blackNile, 'Thinking/Takes/black nile'] },
            { text: 'last week we said agents are dead', sources: ['Granola notes/2026-11-17, 💸weekly IC 🗣️Discussions meeting'] },
            { text: 'loops compound', sources: ['pos-7f3a'] },
          ],
          question: 'what would make us pass?',
          sayOnce: ['Black Nile', 'Black Nile', ' '],
          // Pollentia stays listed; Black Nile is already a point; an invented path is dropped.
          alsoMet: [
            { name: 'Pollentia', path: pollentia, line: 'ship maintenance OS,  decision due Wednesday' },
            { name: 'Black Nile', path: blackNile, line: '' },
            { name: 'Made up', path: 'Granola notes/nope', line: '' },
          ],
        },
        { meeting: 'some other meeting', points: [{ text: 'x', sources: [blackNile] }], question: '', sayOnce: [], alsoMet: [] },
      ],
      due,
      new Set(['Thinking/Takes/black nile']),
      new Set(['pos-7f3a']),
      new Map([['weekly ic', new Set([blackNile, pollentia])]]),
    );
    expect(out).toEqual([
      {
        meeting: 'weekly ic',
        points: [
          { text: 'Black Nile: plant AI, only works if it transfers', sources: [blackNile, 'Thinking/Takes/black nile'] },
          { text: 'loops compound', sources: ['pos-7f3a'] },
        ],
        question: 'what would make us pass?',
        sayOnce: ['Black Nile'],
        alsoMet: [{ name: 'Pollentia', path: pollentia, line: 'ship maintenance OS, decision due Wednesday' }],
      },
    ]);
  });
});

describe('Say it out loud', () => {
  const blankSpark = [
    '## Say it out loud',
    "Three points, one breath each, pause between them. If one doesn't fit in a breath, it's two points.",
    '1. ',
    '2. ',
    '3. ',
    '',
    'Word I might get stuck on: ',
    '',
    '## Smallest next step',
    '- [ ] ',
  ].join('\n');
  const say = { points: ['ai vanishes in meetings', 'the fix is hardware', 'restraint is the real test'], stuckWord: 'hardware' };

  it("fills a Spark's blank points and stuck word, leaving the rest of the note alone", () => {
    expect(needsSayIt(blankSpark)).toBe(true);
    const out = fillSayIt(blankSpark, say);
    expect(out).toContain('1. ai vanishes in meetings\n2. the fix is hardware\n3. restraint is the real test\n\nWord I might get stuck on: hardware\n\n## Smallest next step\n- [ ] ');
    expect(needsSayIt(out)).toBe(false);
  });

  it("never touches points she's written", () => {
    const hers = blankSpark.replace('1. ', '1. Every AI tool disappears in a meeting room.');
    expect(needsSayIt(hers)).toBe(false);
  });

  it('appends the section to a note without one (a Pondering)', () => {
    const out = fillSayIt('〰️\n\n> [!faq]+ Ideas\n> - x\n', { points: ['a', 'b', 'c'], stuckWord: '' });
    expect(out).toBe('〰️\n\n> [!faq]+ Ideas\n> - x\n\n## Say it out loud\nThree points, one breath each, pause between them.\n1. a\n2. b\n3. c\n');
  });

  it('needs three points, and drops a stuck word she would never say', () => {
    expect(checkSayIt({ points: ['a', ' '], stuckWord: '' })).toBeNull();
    expect(checkSayIt({ points: ['one', 'two', 'three'], stuckWord: 'investor' })).toEqual({ points: ['one', 'two', 'three'], stuckWord: '' });
  });
});

describe('addPracticeRow', () => {
  const practice = [
    '## Practice log until Nov 30',
    'Focus: natural pausing.',
    '',
    '| Date | Setting | Paused? | Soft onset? | What I noticed |',
    '| ---- | ------- | ------- | ----------- | -------------- |',
    '|      |         |         |             |                |',
    '',
  ].join('\n');
  const row = { date: '2026-11-24', meetingPath: 'Granola notes/2026-11-24, 💸weekly IC 🗣️Discussions meeting', title: '💸weekly IC 🗣️Discussions meeting' };
  const line = '| 2026-11-24 | [[Granola notes/2026-11-24, 💸weekly IC 🗣️Discussions meeting\\|💸weekly IC 🗣️Discussions meeting]] |  |  |  |';

  it('fills her blank row with the date and meeting, leaving her columns empty', () => {
    expect(addPracticeRow(practice, row)).toBe(practice.replace('|      |         |         |             |                |', line));
  });

  it('appends after her filled rows, once per meeting', () => {
    const filled = addPracticeRow(practice, row)!;
    const next = addPracticeRow(filled, { ...row, date: '2026-11-25', meetingPath: 'Granola notes/b', title: 'b' })!;
    expect(next).toContain(`${line}\n| 2026-11-25 | [[Granola notes/b\\|b]] |  |  |  |\n`);
    expect(addPracticeRow(next, row)).toBeNull();
  });

  it('does nothing without a practice log table', () => {
    expect(addPracticeRow('# Speaking\n\nno table', row)).toBeNull();
  });
});
