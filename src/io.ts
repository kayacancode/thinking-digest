/**
 * The edges the pipeline needs. Obsidian implements them in main.ts; the
 * headless harness (scripts/run.ts) implements them over the filesystem so the
 * whole pipeline can be exercised against a real vault without the app.
 * All paths here are vault paths WITHOUT ".md".
 */

export interface NoteMeta {
  path: string;
  ctime: number; // ms
  frontmatter: Record<string, unknown> | null;
}

export interface VaultIO {
  /** Every markdown note in the vault. */
  list(): NoteMeta[];
  read(path: string): Promise<string | null>;
  /** Create or overwrite; creates parent folders. */
  write(path: string, content: string): Promise<void>;
  exists(path: string): boolean;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a local program with stdin. Desktop only; absent on platforms without processes. */
export type Exec = (cmd: string, args: string[], stdin: string, timeoutMs: number) => Promise<ExecResult>;

export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export interface Env {
  vault: VaultIO;
  http: Http;
  exec?: Exec;
  /** Resolved path to the `claude` binary, when the CLI provider is available. */
  cliPath?: string;
  toMarkdown: (html: string) => string;
  now: () => Date;
  newHex: (len: number) => string;
  log: (msg: string, extra?: unknown) => void;
}

export function randomHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

/** Strip a leading YAML frontmatter block. */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return md;
  const after = md.indexOf('\n', end + 4);
  return after === -1 ? '' : md.slice(after + 1);
}
