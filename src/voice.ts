import { hashText, normalizeKey } from './types';
import type { ProposedRule, VoiceRule } from './types';

const HEADER = [
  '# Voice rules',
  '',
  '%% Rules above the Proposed heading go into every draft. To activate a proposed rule, move it above that heading. ' +
    'Rewrite any rule freely; a deleted rule is never proposed again. %%',
].join('\n');

const PROPOSED_HEADING = /^##\s+Proposed\s*$/i;
const LEARNED_FROM = /^\s+[-*+]\s+learned from\s*:\s*(.*)$/i;
const BULLET = /^(\s*)[-*+]\s+(.*?)\s*$/;
const RULE_ID = /\s*\^(vr-[0-9a-z]+)$/;
const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/**
 * A top-level bullet is a rule. One she typed without a block id gets an id derived from its
 * text, so it stays put when the note is re-rendered. Indented bullets are never rules.
 */
function ruleFromLine(line: string, status: VoiceRule['status']): VoiceRule | null {
  const bullet = BULLET.exec(line);
  if (!bullet) return null;
  const idMatch = RULE_ID.exec(bullet[2]);
  if (!idMatch && bullet[1]) return null;
  const text = idMatch ? bullet[2].slice(0, idMatch.index).trim() : bullet[2];
  if (!text) return null;
  const id = idMatch ? idMatch[1] : `vr-${hashText(normalizeKey(text)).slice(0, 4)}`;
  return { id, text, learnedFrom: [], status };
}

export function parseVoiceRules(md: string): VoiceRule[] {
  const rules: VoiceRule[] = [];
  const seen = new Set<string>();
  let status: VoiceRule['status'] = 'active';
  let current: VoiceRule | null = null;

  for (const line of md.split(/\r?\n/)) {
    if (PROPOSED_HEADING.test(line)) {
      status = 'proposed';
      current = null;
      continue;
    }

    const learned = LEARNED_FROM.exec(line);
    if (learned) {
      if (current) {
        const paths = [...learned[1].matchAll(WIKILINK)].map((m) => m[1].trim()).filter(Boolean);
        current.learnedFrom = [...new Set(paths)];
      }
      continue;
    }

    const rule = ruleFromLine(line, status);
    if (rule && !seen.has(rule.id)) {
      seen.add(rule.id);
      rules.push(rule);
      current = rule;
    } else if (rule || /^\S/.test(line)) {
      current = null;
    }
  }

  return rules;
}

function renderRule(rule: VoiceRule): string {
  const head = `- ${rule.text} ^${rule.id}`;
  if (!rule.learnedFrom.length) return head;
  return `${head}\n\t- learned from: ${rule.learnedFrom.map((p) => `[[${p}]]`).join(', ')}`;
}

export function renderVoiceRules(rules: VoiceRule[], maxActive: number): string {
  const active = rules.filter((r) => r.status === 'active');
  const proposed = rules.filter((r) => r.status === 'proposed');
  const blocks = [HEADER];
  if (active.length) blocks.push(active.map(renderRule).join('\n'));
  blocks.push('## Proposed');
  if (active.length >= maxActive && proposed.length) {
    blocks.push(`> Cap of ${maxActive} active rules reached: archive one before activating another.`);
  }
  if (proposed.length) blocks.push(proposed.map(renderRule).join('\n'));
  return blocks.join('\n\n') + '\n';
}

function freshId(newId: () => string, taken: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = newId();
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error('voice: newId kept returning ids that are already in use');
}

export function acceptProposals(
  rules: VoiceRule[],
  proposals: ProposedRule[],
  opts: { rejectedKeys: string[]; newId: () => string },
): VoiceRule[] {
  const result = rules.map((r) => ({ ...r, learnedFrom: [...r.learnedFrom] }));
  const blockedKeys = new Set([...opts.rejectedKeys, ...rules.map((r) => normalizeKey(r.text))]);
  const taken = new Set(rules.map((r) => r.id));

  for (const proposal of proposals) {
    const text = proposal.text.replace(/\s+/g, ' ').trim();
    const key = normalizeKey(text);
    const learnedFrom = [...new Set(proposal.learnedFrom.map((p) => p.trim()).filter(Boolean))];
    if (!key || learnedFrom.length < 2 || blockedKeys.has(key)) continue;
    blockedKeys.add(key);
    result.push({ id: freshId(opts.newId, taken), text, learnedFrom, status: 'proposed' });
  }

  return result;
}

export function activeRuleTexts(rules: VoiceRule[], maxActive: number): string[] {
  return rules
    .filter((r) => r.status === 'active')
    .slice(0, maxActive)
    .map((r) => r.text);
}

export function findDeletedRules(rules: VoiceRule[], known: Record<string, string>): string[] {
  const present = new Set(rules.map((r) => r.id));
  return Object.entries(known)
    .filter(([id]) => !present.has(id))
    .map(([, key]) => key);
}
