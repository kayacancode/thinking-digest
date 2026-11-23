import { strFromU8, unzipSync } from 'fflate';
import type { Post } from './types';

const MAX_TITLE_LENGTH = 100;

export function sanitizeTitle(title: string, maxLength: number): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function utcDate(value: string): string | null {
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

function childText(item: Element, tagName: string): string {
  return item.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? '';
}

function parseRssItem(item: Element): Post | null {
  const url = childText(item, 'link');
  const slug = /\/p\/([^/?#]+)/.exec(url)?.[1];
  const published = utcDate(childText(item, 'pubDate'));
  if (!slug || !published) return null;
  return {
    url,
    slug,
    title: childText(item, 'title'),
    subtitle: childText(item, 'description'),
    published,
    audience: 'everyone',
    html: childText(item, 'content:encoded'),
  };
}

export function parseRss(xml: string): Post[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Substack RSS is not valid XML');
  }
  return Array.from(doc.getElementsByTagName('item'))
    .map(parseRssItem)
    .filter((post): post is Post => post !== null);
}

/** RFC 4180 CSV: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i] ?? ''])));
}

export function parseExportZip(bytes: Uint8Array, baseUrl: string): Post[] {
  const files = unzipSync(bytes);
  const csvName = Object.keys(files).find((name) => name === 'posts.csv' || name.endsWith('/posts.csv'));
  if (!csvName) throw new Error('Substack export is missing posts.csv');
  const prefix = csvName.slice(0, -'posts.csv'.length);
  const root = baseUrl.replace(/\/+$/, '');

  const posts: Post[] = [];
  for (const record of csvRecords(strFromU8(files[csvName]))) {
    if (record.is_published?.trim().toLowerCase() !== 'true') continue;
    const postId = record.post_id ?? '';
    const dot = postId.indexOf('.');
    const slug = dot >= 0 ? postId.slice(dot + 1) : '';
    const published = utcDate(record.post_date ?? '');
    if (!slug || !published) continue;
    const body = files[`${prefix}posts/${postId}.html`];
    posts.push({
      url: `${root}/p/${slug}`,
      slug,
      title: record.title ?? '',
      subtitle: record.subtitle ?? '',
      published,
      audience: record.audience || 'everyone',
      html: body ? strFromU8(body) : '',
    });
  }
  return posts;
}

export function postNotePath(post: Post, folder: string): string {
  const title = sanitizeTitle(post.title, MAX_TITLE_LENGTH) || post.slug;
  return `${folder}/${post.published} - ${title}`;
}

export function renderPostNote(post: Post, toMarkdown: (html: string) => string): string {
  const fields: [string, string][] = [
    ['type', 'published'],
    ['platform', 'substack'],
    ['title', post.title],
    ['subtitle', post.subtitle],
    ['url', post.url],
    ['published', post.published],
    ['audience', post.audience],
  ];
  const frontmatter = fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  return `---\n${frontmatter}\n---\n# ${post.title}\n\n${toMarkdown(post.html).trim()}\n`;
}

function unquoteYaml(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

export function parseNoteUrl(md: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!frontmatter) return null;
  const line = frontmatter[1].split(/\r?\n/).find((l) => /^url\s*:/.test(l));
  if (!line) return null;
  const url = unquoteYaml(line.replace(/^url\s*:/, '').trim());
  return url || null;
}
