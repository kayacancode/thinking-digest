import { Readability } from '@mozilla/readability';
import { sanitizeTitle } from './substack';

export interface Clip {
  url: string;
  title: string;
  author: string;
  site: string;
  published: string; // YYYY-MM-DD or ''
  html: string; // body HTML ('' when only metadata could be read)
}

export function isXUrl(url: string): boolean {
  return /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(url);
}

export function xOembedUrl(url: string): string {
  return `https://publish.x.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`;
}

/** X's public oEmbed: the post text arrives as a blockquote. */
export function parseXOembed(json: string, url: string): Clip {
  const data = JSON.parse(json) as { author_name?: unknown; html?: unknown };
  const author = typeof data.author_name === 'string' ? data.author_name : '';
  const html = typeof data.html === 'string' ? data.html : '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = doc.querySelector('blockquote p')?.textContent?.trim() ?? '';
  const date = doc.querySelector('blockquote > a')?.textContent?.trim() ?? '';
  return {
    url,
    title: text ? `${author}: ${text.slice(0, 80)}` : `Post by ${author || 'unknown'}`,
    author,
    site: 'X',
    published: isoDate(date),
    html: doc.querySelector('blockquote')?.outerHTML ?? '',
  };
}

function meta(doc: Document, ...names: string[]): string {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return '';
}

function isoDate(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/**
 * Main content of any page via Readability, with Open Graph metadata as the
 * fallback. Login-walled pages (LinkedIn, paywalls) usually still expose
 * og:title / og:description, so a clip is never empty-handed.
 */
export function extractPage(html: string, url: string): Clip {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  const title = meta(doc, 'og:title', 'twitter:title') || doc.title.trim();
  const description = meta(doc, 'og:description', 'description', 'twitter:description');
  const author = meta(doc, 'author', 'article:author', 'twitter:creator');
  const site = meta(doc, 'og:site_name') || new URL(url).hostname.replace(/^www\./, '');
  const published = isoDate(meta(doc, 'article:published_time', 'og:published_time', 'date', 'pubdate'));

  const article = new Readability(doc.cloneNode(true) as Document).parse();
  const textLength = article?.textContent?.trim().length ?? 0;
  const body = article && textLength > 200 ? article.content ?? '' : description ? `<p>${escapeHtml(description)}</p>` : '';

  return {
    url,
    title: article?.title?.trim() || title || url,
    author: article?.byline?.trim() || author,
    site,
    published,
    html: body,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function clipPath(clip: Clip, folder: string): string {
  return `${folder}/${sanitizeTitle(clip.title, 100) || 'Untitled clip'}`;
}

/** Same frontmatter shape as Obsidian Web Clipper, so both feed the digest alike. */
export function renderClipping(clip: Clip, toMarkdown: (html: string) => string, created: string, note: string): string {
  const fm = [
    '---',
    `title: ${JSON.stringify(clip.title)}`,
    `source: ${JSON.stringify(clip.url)}`,
    `author: ${JSON.stringify(clip.author)}`,
    `site: ${JSON.stringify(clip.site)}`,
    `published: ${JSON.stringify(clip.published)}`,
    `created: ${JSON.stringify(created)}`,
    'tags:',
    '  - clippings',
    '---',
  ];
  const parts = [fm.join('\n'), ''];
  if (note.trim()) parts.push(`> [!take] My first reaction\n> ${note.trim().replace(/\n/g, '\n> ')}`, '');
  parts.push(clip.html ? toMarkdown(clip.html).trim() : `_Couldn't read the page body. Open the [source](${clip.url})._`, '');
  return parts.join('\n');
}
