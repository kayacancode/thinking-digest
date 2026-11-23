import type { Exec, Http } from './io';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 180_000;
const MAX_TOKENS = 32_000;

export interface Prompt {
  system: string;
  user: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Llm {
  complete(system: string, messages: Message[]): Promise<string>;
}

export function createLlm(http: Http, apiKey: string, model: string): Llm {
  return {
    async complete(system, messages) {
      const body = JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages });
      for (let attempt = 1; ; attempt++) {
        const res = await withTimeout(
          http({
            url: ENDPOINT,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body,
          }),
        );
        if (res.status >= 200 && res.status < 300) return textOf(res.text);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= 2) throw new Error(`Anthropic HTTP ${res.status}: ${errorMessage(res.text)}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
  };
}

const CLI_TIMEOUT_MS = 300_000;

/**
 * Same contract over the local Claude Code CLI (`claude -p`), so the digest
 * can run on Kaya's subscription without an API key. Every flag that would
 * pull in her Claude Code setup (settings, MCP, tools, slash commands,
 * sessions) is off: the call is a bare system prompt + user message.
 */
export function createCliLlm(exec: Exec, cliPath: string, model: string): Llm {
  return {
    async complete(system, messages) {
      const args = [
        '-p',
        '--model', model,
        '--system-prompt', system,
        '--output-format', 'json',
        '--tools', '',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--disable-slash-commands',
      ];
      const res = await exec(cliPath, args, flatten(messages), CLI_TIMEOUT_MS);
      let parsed: { result?: unknown; is_error?: unknown } | null = null;
      try {
        parsed = JSON.parse(res.stdout) as { result?: unknown; is_error?: unknown };
      } catch {
        parsed = null;
      }
      if (res.code !== 0 || !parsed || parsed.is_error === true || typeof parsed.result !== 'string') {
        const detail = typeof parsed?.result === 'string' ? parsed.result : (res.stderr || res.stdout).slice(0, 300);
        throw new Error(`Claude CLI failed (exit ${res.code}): ${detail}`);
      }
      return parsed.result;
    },
  };
}

/** The CLI takes one prompt; a retry conversation becomes one transcript. */
function flatten(messages: Message[]): string {
  if (messages.length === 1) return messages[0].content;
  return messages
    .map((m) => (m.role === 'user' ? m.content : `<your_previous_output>\n${m.content}\n</your_previous_output>`))
    .join('\n\n');
}

/**
 * Ask for JSON and validate it. One retry that shows the model its own output
 * and the validation error; a second failure throws.
 */
export async function askJson<T>(llm: Llm, prompt: Prompt, parse: (text: string) => T): Promise<T> {
  const first = await llm.complete(prompt.system, [{ role: 'user', content: prompt.user }]);
  try {
    return parse(first);
  } catch (err) {
    const retry = await llm.complete(prompt.system, [
      { role: 'user', content: prompt.user },
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: `That output failed validation: ${(err as Error).message}. Reply with ONLY the corrected JSON object, nothing else.`,
      },
    ]);
    return parse(retry);
  }
}

function textOf(raw: string): string {
  const data = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('Anthropic response had no text');
  return text;
}

function errorMessage(raw: string): string {
  try {
    const data = JSON.parse(raw) as { error?: { message?: string } };
    return data.error?.message ?? raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Anthropic request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
