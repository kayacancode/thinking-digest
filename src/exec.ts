import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';
import type { Exec } from './io';

/**
 * Desktop-only process runner. GUI apps on macOS start with a minimal PATH,
 * so the binary's own folder and the usual Homebrew/npm prefixes are added:
 * `claude` is a Node script and needs `node` on PATH. Runs in the temp dir so
 * no project CLAUDE.md is picked up.
 */
export const nodeExec: Exec = (cmd, args, stdin, timeoutMs) =>
  new Promise((resolve, reject) => {
    const PATH = [dirname(cmd), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), process.env.PATH ?? '']
      .filter(Boolean)
      .join(':');
    const child = spawn(cmd, args, { cwd: tmpdir(), env: { ...process.env, PATH } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

/** The configured path if it exists, else the first common install location. */
export function findClaudeCli(configured: string): string | undefined {
  const candidates = configured
    ? [configured]
    : [
        join(homedir(), '.local/bin/claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        join(homedir(), '.claude/local/claude'),
      ];
  return candidates.find((p) => existsSync(p));
}
