import { describe, it, expect } from 'vitest';
import { hashText } from '../src/types';
import { addToPondering, diffThought, isPrivateNote, parseTickedThreads, quickThoughtNote, renderThreads } from '../src/thoughts';

describe('diffThought', () => {
  const monday = 'Update\n- events are good to go\n\n- [ ] want to grow wealth';

  it('treats every line as new the first time', () => {
    const t = diffThought('Fleeting Notes/JB', 'JB', monday, []);
    expect(t?.newText).toBe('Update\n- events are good to go\n- [ ] want to grow wealth');
    expect(t?.earlierText).toBe('');
  });

  it('returns only lines added since the snapshot, with earlier lines as context', () => {
    const first = diffThought('p', 'JB', monday, [])!;
    const tuesday = `${monday}\n\t- forever 22: one-off events give more energy than community`;
    const t = diffThought('p', 'JB', tuesday, first.lineHashes);
    expect(t?.newText).toBe('\t- forever 22: one-off events give more energy than community');
    expect(t?.earlierText).toContain('events are good to go');
  });

  it('returns null when nothing changed, and ignores code blocks', () => {
    const body = 'thought\n```dataviewjs\nconst x = 1;\n```';
    const first = diffThought('p', 't', body, [])!;
    expect(first.newText).toBe('thought');
    expect(diffThought('p', 't', body, first.lineHashes)).toBeNull();
  });

  it('accepts a baseline built from raw lines (first-run notes older than a week)', () => {
    const baseline = monday.split('\n').map((l) => hashText(l.trim()));
    expect(diffThought('p', 't', monday, baseline)).toBeNull();
  });
});

describe('isPrivateNote', () => {
  it('honours frontmatter flag, frontmatter tags, and inline tags', () => {
    expect(isPrivateNote({ private: true }, '', 'private')).toBe(true);
    expect(isPrivateNote({ tags: ['Ponderings', 'private'] }, '', 'private')).toBe(true);
    expect(isPrivateNote(null, 'parents getting older #private', 'private')).toBe(true);
    expect(isPrivateNote({ tags: ['privateequity'] }, 'about #privateequity deals', 'private')).toBe(false);
    expect(isPrivateNote(null, 'nothing secret', 'private')).toBe(false);
  });
});

describe('threads in the digest', () => {
  const drafts = {
    'th-0001': { pondering: 'Pondering/〰️ network shape', title: '', text: 'your network is your frontier map', sources: ['Fleeting Notes/JB'] },
    'th-0002': { pondering: null, title: 'one-off events beat community ...', text: 'events give energy, community drains it', sources: ['Fleeting Notes/JB', 'Granola notes/Jocelyn'] },
  };

  it('groups bullets under the Pondering they extend or the new one they propose', () => {
    const md = renderThreads(drafts);
    expect(md).toContain('### Adds to [[Pondering/〰️ network shape]]\n- [ ] your network is your frontier map · [[Fleeting Notes/JB]] ^th-0001');
    expect(md).toContain('### New pondering: one-off events beat community ...');
    expect(renderThreads({})).toBe('');
  });

  it('reads only ticked bullets, keeping her edited text and dropping the source links', () => {
    const md = renderThreads(drafts)
      .replace('- [ ] your network is your frontier map', '- [x] my network is literally my frontier map')
      .replace('- [ ] events give', '- [ ] events give');
    expect(parseTickedThreads(md)).toEqual([{ id: 'th-0001', text: 'my network is literally my frontier map' }]);
  });
});

describe('addToPondering', () => {
  const template = [
    '---',
    'tags:',
    '  - Ponderings',
    '---',
    '〰️',
    '',
    '> [!faq]+  Ideas i’m pondering 〰️ [[Pondering ...|🤔]] ',
    '> - I123',
    '',
    '### Relevant Notes:',
  ].join('\n');

  it('adds inside the "Ideas i’m pondering" callout, replacing the empty template bullet', () => {
    const out = addToPondering(template, [{ text: 'rooms > recipes', sources: ['Fleeting Notes/JB'] }], '2026-11-24');
    expect(out).toContain('> [!faq]+  Ideas i’m pondering 〰️ [[Pondering ...|🤔]] \n> - rooms > recipes ([[Fleeting Notes/JB]])\n\n### Relevant Notes:');
    expect(out).not.toContain('I123');
  });

  it('keeps existing ideas and appends after them', () => {
    const withIdea = template.replace('> - I123', '> - an older idea');
    const out = addToPondering(withIdea, [{ text: 'new one', sources: ['a'] }], '2026-11-24');
    expect(out).toContain('> - an older idea\n> - new one ([[a]])');
  });

  it('appends a dated section to free-form Ponderings without restructuring them', () => {
    const out = addToPondering('[[Narrative Collapse]]\n\nsome notes\n', [{ text: 'x', sources: ['a', 'b'] }], '2026-11-24');
    expect(out).toBe('[[Narrative Collapse]]\n\nsome notes\n\n### Threads (2026-11-24)\n- x ([[a]], [[b]])\n');
  });
});

describe('quickThoughtNote', () => {
  it('creates the day note, then appends timestamped lines', () => {
    const first = quickThoughtNote(null, { date: '2026-11-24', time: '09:05', text: 'rooms  matter\nmore than', createdIso: '2026-11-24T14:05:00.000Z' });
    expect(first).toBe('---\ncreated: "2026-11-24T14:05:00.000Z"\n---\n# Thoughts 2026-11-24\n\n- 09:05 rooms matter more than\n');
    const second = quickThoughtNote(first, { date: '2026-11-24', time: '13:40', text: 'second', createdIso: 'x' });
    expect(second.endsWith('- 09:05 rooms matter more than\n- 13:40 second\n')).toBe(true);
  });
});
