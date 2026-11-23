// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { clipPath, extractPage, isXUrl, parseXOembed, renderClipping, xOembedUrl } from '../src/capture';

const para = (n: number) => `<p>${'Agents need judgment more than tools. '.repeat(8)} Paragraph ${n}.</p>`;

const ARTICLE = `<!doctype html><html><head>
<title>Ignored page title | Site</title>
<meta property="og:title" content="The Gate Thesis">
<meta property="og:site_name" content="Example Blog">
<meta name="author" content="Ada Lovelace">
<meta property="article:published_time" content="2026-11-20T10:00:00Z">
</head><body>
<nav>Home · About · Subscribe</nav>
<article><h1>The Gate Thesis</h1>${para(1)}${para(2)}${para(3)}</article>
<footer>© footer junk</footer>
</body></html>`;

const WALLED = `<!doctype html><html><head>
<meta property="og:title" content="Satya's post">
<meta property="og:description" content="We are entering the agentic era & everything changes.">
</head><body><div>Sign in to continue</div></body></html>`;

describe('extractPage', () => {
  it('pulls the article body and metadata, without the page chrome', () => {
    const clip = extractPage(ARTICLE, 'https://example.com/gate');
    expect(clip.title).toBe('The Gate Thesis');
    expect(clip.author).toBe('Ada Lovelace');
    expect(clip.site).toBe('Example Blog');
    expect(clip.published).toBe('2026-11-20');
    expect(clip.html).toContain('Paragraph 3');
    expect(clip.html).not.toContain('footer junk');
  });

  it('falls back to og:description on login-walled pages so the clip is not empty', () => {
    const clip = extractPage(WALLED, 'https://www.linkedin.com/posts/x');
    expect(clip.title).toBe("Satya's post");
    expect(clip.site).toBe('linkedin.com');
    expect(clip.html).toContain('agentic era &amp; everything');
    expect(clip.html).not.toContain('Sign in');
  });
});

describe('X posts', () => {
  it('recognizes x.com and twitter.com status links only', () => {
    expect(isXUrl('https://x.com/jack/status/20')).toBe(true);
    expect(isXUrl('https://twitter.com/jack/status/20?s=46')).toBe(true);
    expect(isXUrl('https://x.com/jack')).toBe(false);
    expect(xOembedUrl('https://x.com/jack/status/20')).toContain(encodeURIComponent('https://x.com/jack/status/20'));
  });

  it('reads the post text and date from oEmbed', () => {
    const json = JSON.stringify({
      author_name: 'jack',
      html: '<blockquote class="twitter-tweet"><p lang="en">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>',
    });
    const clip = parseXOembed(json, 'https://x.com/jack/status/20');
    expect(clip.title).toBe('jack: just setting up my twttr');
    expect(clip.published).toBe('2006-03-21');
    expect(clip.html).toContain('just setting up my twttr');
  });
});

describe('renderClipping', () => {
  const clip = { url: 'https://e.com/a', title: 'A "quoted": title', author: '', site: 'e.com', published: '', html: '<p>Body</p>' };

  it('writes Web-Clipper-shaped frontmatter the digest can read', () => {
    const md = renderClipping(clip, (h) => h.replace(/<\/?p>/g, ''), '2026-11-23T09:00:00.000Z', '');
    expect(md).toMatch(/^---\ntitle: "A \\"quoted\\": title"\nsource: "https:\/\/e.com\/a"/);
    expect(md).toContain('created: "2026-11-23T09:00:00.000Z"');
    expect(md).not.toContain('[!take]');
    expect(md.trim().endsWith('Body')).toBe(true);
  });

  it("puts her first reaction in a take callout, multi-line safe", () => {
    const md = renderClipping(clip, (h) => h, '2026-11-23T09:00:00.000Z', 'wrong.\nthe gate is the product');
    expect(md).toContain('> [!take] My first reaction\n> wrong.\n> the gate is the product');
  });

  it('saves a link-only clip with a pointer to the source', () => {
    const md = renderClipping({ ...clip, html: '' }, (h) => h, '2026-11-23T09:00:00.000Z', '');
    expect(md).toContain("Couldn't read the page body");
  });

  it('builds a filesystem-safe path', () => {
    expect(clipPath({ ...clip, title: 'What/is: this?' }, 'Clippings')).toBe('Clippings/Whatis this');
  });
});
