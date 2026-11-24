import { describe, it, expect } from 'vitest';
import { addPracticeRow, checkPrep, checkSayIt, fillSayIt, meetingsDue, needsSayIt, seriesKey } from '../src/speaking';

// Her real IC history from Granola.
const ic = [
  { path: 'Granola notes/2026-10-29, 💸Weekly IC touchbase', title: '💸Weekly IC touchbase', date: '2026-10-29' },
  { path: 'Granola notes/2026-11-03, 💸weekly IC 🔒Decisions meeting', title: '💸weekly IC 🔒Decisions meeting', date: '2026-11-03' },
  { path: 'Granola notes/2026-11-03, 💸weekly IC 🗣️Discussions meeting', title: '💸weekly IC 🗣️Discussions meeting', date: '2026-11-03' },
  { path: 'Granola notes/2026-11-10, 💸weekly IC 🔒Decisions meeting', title: '💸weekly IC 🔒Decisions meeting', date: '2026-11-10' },
  { path: 'Granola notes/2026-11-10, 💸weekly IC 🗣️Discussions meeting', title: '💸weekly IC 🗣️Discussions meeting', date: '2026-11-10' },
  { path: 'Granola notes/2026-11-16, 💸weekly IC 🔒Decisions meeting', title: '💸weekly IC 🔒Decisions meeting', date: '2026-11-16' },
  { path: 'Granola notes/2026-11-17, 💸weekly IC 🗣️Discussions meeting', title: '💸weekly IC 🗣️Discussions meeting', date: '2026-11-17' },
  { path: 'Granola notes/2026-11-20, Jocelyn x Kaya', title: 'Jocelyn x Kaya', date: '2026-11-20' },
];
const decisions = seriesKey('💸weekly IC 🔒Decisions meeting');
const discussions = seriesKey('💸weekly IC 🗣️Discussions meeting');

describe('meetingsDue', () => {
  it('expects both IC meetings on a Tuesday and only Decisions on a Monday', () => {
    expect(meetingsDue(ic, '2026-11-24').map((m) => m.key).sort()).toEqual([decisions, discussions].sort());
    expect(meetingsDue(ic, '2026-11-23').map((m) => m.key)).toEqual([decisions]);
  });

  it('points at the latest instance, and skips one-offs and other weekdays', () => {
    const tue = meetingsDue(ic, '2026-11-24');
    expect(tue.find((m) => m.key === discussions)?.lastPath).toBe('Granola notes/2026-11-17, 💸weekly IC 🗣️Discussions meeting');
    expect(meetingsDue(ic, '2026-11-26')).toEqual([]); // Thursday: no series meets then
  });

  it("doesn't prep a meeting that already has today's note", () => {
    const happened = [...ic, { path: 'x', title: '💸weekly IC 🗣️Discussions meeting', date: '2026-11-24' }];
    expect(meetingsDue(happened, '2026-11-24').map((m) => m.key)).toEqual([decisions]);
  });
});

describe('checkPrep', () => {
  const due = meetingsDue(ic, '2026-11-24');
  it('keeps talking points that rest on her words or positions, drops the rest', () => {
    const out = checkPrep(
      [
        {
          meeting: discussions,
          points: [
            { text: 'restraint  is the product', sources: ['Thinking/Sparks/AI in the room'] },
            { text: 'they said agents are dead', sources: ['Granola notes/2026-11-17, 💸weekly IC 🗣️Discussions meeting'] },
            { text: 'loops compound', sources: ['pos-7f3a'] },
          ],
          question: 'what would make us pass?',
          sayOnce: ['Stasht', 'Stasht', ' '],
        },
        { meeting: 'some other meeting', points: [{ text: 'x', sources: ['Thinking/Sparks/AI in the room'] }], question: '', sayOnce: [] },
      ],
      due,
      new Set(['Thinking/Sparks/AI in the room']),
      new Set(['pos-7f3a']),
    );
    expect(out).toEqual([
      {
        meeting: discussions,
        points: [
          { text: 'restraint is the product', sources: ['Thinking/Sparks/AI in the room'] },
          { text: 'loops compound', sources: ['pos-7f3a'] },
        ],
        question: 'what would make us pass?',
        sayOnce: ['Stasht'],
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
