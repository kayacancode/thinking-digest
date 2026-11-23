import { describe, it, expect } from 'vitest';
import {
  appendQuestion,
  appendReadyNote,
  markDone,
  parseExercise,
  ponderingNoteName,
  renderNewExercise,
  renderPondering,
} from '../src/exercise';

const start = renderNewExercise({
  source: 'Clippings/The Gate Thesis',
  title: 'The Gate Thesis',
  date: '2026-11-23',
  question: "what's the actual claim here,\nand do you buy it?",
});

describe('exercise note', () => {
  it('starts with one unanswered question and the source', () => {
    const ex = parseExercise(start);
    expect(ex.source).toBe('Clippings/The Gate Thesis');
    expect(ex.title).toBe('The Gate Thesis');
    expect(ex.status).toBe('open');
    expect(ex.rounds).toEqual([{ question: "what's the actual claim here, and do you buy it?", answer: '' }]);
  });

  it('reads multi-paragraph answers she types under each question', () => {
    const answered = start.trimEnd() + '\n\nyes mostly.\n\nexcept the part about tools.\n';
    const withQ2 = appendQuestion(answered, 2, 'how does that square with your gate post?');
    const done = withQ2 + 'it IS the gate post lol\n';
    const ex = parseExercise(done);
    expect(ex.rounds).toHaveLength(2);
    expect(ex.rounds[0].answer).toBe('yes mostly.\n\nexcept the part about tools.');
    expect(ex.rounds[1]).toEqual({ question: 'how does that square with your gate post?', answer: 'it IS the gate post lol' });
  });

  it('ignores plugin comments when reading answers', () => {
    const ready = appendReadyNote(appendQuestion(start + 'a1\n', 2, 'q2') + 'a2\n');
    const ex = parseExercise(ready);
    expect(ex.rounds[1].answer).toBe('a2');
  });

  it('marks done and links the pondering', () => {
    const done = markDone(start, 'Pondering/〰️ gates are the product ...');
    const ex = parseExercise(done);
    expect(ex.status).toBe('done');
    expect(done).toContain('pondering: "[[Pondering/〰️ gates are the product ...]]"');
  });
});

describe('pondering note', () => {
  const md = renderPondering({
    draft: {
      title: 'gates are the product ...',
      heterodox: true,
      ideas: ['the gate is where judgment lives', 'tools are table stakes'],
      insights: ['the post argues execution is solved'],
      people: ['Jad Esber', 'Someone Unknown'],
      forkIdeas: ['consequence scoring', 'undo budgets'],
      steelman: 'gates slow everything down',
    },
    date: '2026-11-23',
    source: 'Clippings/The Gate Thesis',
    exercise: 'Thinking/Exercises/2026-11-23 - The Gate Thesis',
    related: ['Thinking/Positions#^pos-7f3a'],
    peopleLinks: { 'Jad Esber': 'People pages/p- Jad Esber' },
  });

  it('matches her Pondering template fields and sections', () => {
    expect(md).toContain('Heterodox: true');
    expect(md).toContain('  - Ponderings');
    expect(md).toContain('Related to ?:\n  - "[[Clippings/The Gate Thesis]]"\n  - "[[Thinking/Positions#^pos-7f3a]]"');
    expect(md).toContain('> - the gate is where judgment lives');
    expect(md).toContain('>[!cue]  Insights that triggered ideas');
    expect(md).toContain('>- Steel man Counter: gates slow everything down');
  });

  it('links only people who have a page', () => {
    expect(md).toContain('>- People: [[People pages/p- Jad Esber|Jad Esber]], Someone Unknown');
  });

  it('uses the 〰️ prefix and a safe file name', () => {
    expect(ponderingNoteName('ideas: what/why? ...')).toBe('〰️ ideas whatwhy');
  });
});
