// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  parseCsv,
  parseExportZip,
  parseNoteUrl,
  parseRss,
  postNotePath,
  renderPostNote,
} from '../src/substack';
import type { Post } from '../src/types';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title><![CDATA[Kaya's Substack]]></title>
    <link>https://kayajones.substack.com</link>
    <item>
      <title><![CDATA[Agents: "more tools" isn't the answer]]></title>
      <description><![CDATA[It needs a gate & a judge]]></description>
      <link>https://kayajones.substack.com/p/your-agent-doesnt-need-more-tools</link>
      <pubDate>Sun, 22 Nov 2026 23:30:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>First <em>paragraph</em> &amp; more.</p><ul><li>one</li></ul>]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[Second post]]></title>
      <description><![CDATA[]]></description>
      <link>https://kayajones.substack.com/p/second-post?utm_source=rss</link>
      <pubDate>Sun, 11 Jan 2026 08:00:00 +0100</pubDate>
      <content:encoded><![CDATA[<p>Body two</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const POST: Post = {
  url: 'https://kayajones.substack.com/p/your-agent',
  slug: 'your-agent',
  title: 'Agents: "more tools" isn\'t the answer #1',
  subtitle: 'key: value — "quoted"',
  published: '2026-11-22',
  audience: 'everyone',
  html: '<p>Hello</p>',
};

function frontmatterOf(md: string): Record<string, unknown> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!block) throw new Error('no frontmatter');
  return Object.fromEntries(
    block[1].split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), JSON.parse(line.slice(colon + 1).trim())];
    }),
  );
}

describe('parseRss', () => {
  const posts = parseRss(RSS);

  it('parses every item with CDATA text intact', () => {
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({
      url: 'https://kayajones.substack.com/p/your-agent-doesnt-need-more-tools',
      slug: 'your-agent-doesnt-need-more-tools',
      title: 'Agents: "more tools" isn\'t the answer',
      subtitle: 'It needs a gate & a judge',
      published: '2026-11-22',
      audience: 'everyone',
      html: '<p>First <em>paragraph</em> &amp; more.</p><ul><li>one</li></ul>',
    });
  });

  it('uses the UTC date and strips query strings from the slug', () => {
    expect(posts[1].published).toBe('2026-01-11');
    expect(posts[1].slug).toBe('second-post');
    expect(posts[1].subtitle).toBe('');
  });

  it('dates by UTC, not by the offset in pubDate', () => {
    const late = RSS.replace('Sun, 11 Jan 2026 08:00:00 +0100', 'Mon, 12 Jan 2026 00:30:00 +0100');
    expect(parseRss(late)[1].published).toBe('2026-01-11');
  });

  it('throws on malformed XML', () => {
    expect(() => parseRss('<rss><channel><item></channel>')).toThrow();
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, newlines, escaped quotes and CRLF', () => {
    const csv = 'a,b,c\r\n"x, y","line1\nline2","say ""hi"""\r\nplain,,end\r\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'line1\nline2', 'say "hi"'],
      ['plain', '', 'end'],
    ]);
  });
});

describe('parseExportZip', () => {
  const csv = [
    'post_id,post_date,is_published,email_sent_at,title,subtitle,audience',
    '111.first-post,2026-02-03T10:00:00.000Z,true,,"Tools, gates, and judges","Line one\nline two",everyone',
    '222.draft-post,2026-02-04T10:00:00.000Z,false,,Draft,,everyone',
    '333.paid-post,2026-03-01T23:59:00.000Z,true,,"She said ""no""",,only_paid',
  ].join('\n');
  const zip = zipSync({
    'posts.csv': strToU8(csv),
    'posts/111.first-post.html': strToU8('<p>First body</p>'),
    'posts/222.draft-post.html': strToU8('<p>Draft body</p>'),
    'posts/333.paid-post.html': strToU8('<p>Paid body</p>'),
  });
  const posts = parseExportZip(zip, 'https://kayajones.substack.com/');

  it('skips unpublished rows', () => {
    expect(posts.map((p) => p.slug)).toEqual(['first-post', 'paid-post']);
  });

  it('keeps quoted commas and newlines inside fields and reads the body', () => {
    expect(posts[0]).toEqual({
      url: 'https://kayajones.substack.com/p/first-post',
      slug: 'first-post',
      title: 'Tools, gates, and judges',
      subtitle: 'Line one\nline two',
      published: '2026-02-03',
      audience: 'everyone',
      html: '<p>First body</p>',
    });
  });

  it('keeps audience and escaped quotes for paid posts', () => {
    expect(posts[1].title).toBe('She said "no"');
    expect(posts[1].audience).toBe('only_paid');
    expect(posts[1].html).toBe('<p>Paid body</p>');
  });

  it('throws when posts.csv is missing', () => {
    expect(() => parseExportZip(zipSync({ 'x.txt': strToU8('x') }), 'https://a.b')).toThrow(/posts\.csv/);
  });
});

describe('postNotePath', () => {
  it('strips characters Obsidian links cannot hold', () => {
    expect(postNotePath(POST, 'Writing/Substack')).toBe(
      "Writing/Substack/2026-11-22 - Agents more tools isn't the answer 1",
    );
  });

  it('collapses whitespace and caps the title at 100 characters', () => {
    const path = postNotePath({ ...POST, title: `a  [b]   ${'x'.repeat(200)}` }, 'W');
    const title = path.slice('W/2026-11-22 - '.length);
    expect(title.startsWith('a b x')).toBe(true);
    expect(title).toHaveLength(100);
  });
});

describe('renderPostNote', () => {
  const md = renderPostNote(POST, (html) => html.replace(/<\/?p>/g, ''));

  it('writes frontmatter that survives quotes and colons', () => {
    expect(frontmatterOf(md)).toEqual({
      type: 'published',
      platform: 'substack',
      title: POST.title,
      subtitle: POST.subtitle,
      url: POST.url,
      published: POST.published,
      audience: POST.audience,
    });
  });

  it('puts the title heading and converted body after the frontmatter', () => {
    expect(md.split('---\n')[2]).toBe(`# ${POST.title}\n\nHello\n`);
  });

  it('round-trips the url through parseNoteUrl', () => {
    expect(parseNoteUrl(md)).toBe(POST.url);
  });
});

describe('parseNoteUrl', () => {
  it('reads an unquoted url', () => {
    expect(parseNoteUrl('---\ntitle: x\nurl: https://a.b/p/c\n---\nbody')).toBe('https://a.b/p/c');
  });

  it('returns null without frontmatter or url', () => {
    expect(parseNoteUrl('url: https://a.b/p/c')).toBeNull();
    expect(parseNoteUrl('---\ntitle: x\n---\n')).toBeNull();
  });

  it('ignores url lines in the body', () => {
    expect(parseNoteUrl('---\ntitle: x\n---\nurl: https://a.b')).toBeNull();
  });
});
