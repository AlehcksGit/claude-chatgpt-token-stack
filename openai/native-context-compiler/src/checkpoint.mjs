import { tokenCount } from './tokenizer.mjs';

function itemText(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.output === 'string') return item.output;
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((part) => typeof part === 'string'
    ? part
    : (part?.text ?? part?.output_text ?? part?.content ?? '')).filter(Boolean).join('\n');
}

const IDENTIFIER_PATTERNS = [
  /\b[a-f0-9]{12,64}\b/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /(?:[A-Za-z]:\\|\/)[^\s"'<>|]{3,220}/g,
  /\b(?:port\s*)?\d{4,5}\b/gi,
  /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?\b/g,
];

export function collectIdentifiers(text, limit = 120) {
  const found = new Set();
  for (const pattern of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[0]);
      if (found.size >= limit) return [...found];
    }
  }
  return [...found];
}

function concise(text, limit = 700) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

export function buildCheckpoint(items, receipts = [], maxTokens = 1800) {
  const messages = items.map((item) => ({ item, text: itemText(item) })).filter((x) => x.text);
  const firstUser = messages.find((x) => x.item.role === 'user')?.text ?? '';
  const decisionLines = [];
  for (const { text } of messages) {
    for (const line of text.split('\n')) {
      if (/\b(decision|implemented|completed|verified|blocked|remaining|root cause|result|bottom line)\b/i.test(line)) {
        decisionLines.push(concise(line, 300));
      }
      if (decisionLines.length >= 30) break;
    }
    if (decisionLines.length >= 30) break;
  }
  const allText = messages.map((x) => x.text).join('\n');
  const checkpoint = {
    version: 1,
    objective: concise(firstUser, 900),
    decisions: [...new Set(decisionLines)].slice(0, 24),
    exactIdentifiers: collectIdentifiers(allText),
    evidence: receipts.map((r) => r.handle).filter(Boolean).slice(-80),
    note: 'Transparent deterministic checkpoint; retrieve evidence handles for exact source text.',
  };

  while (tokenCount(checkpoint) > maxTokens && checkpoint.decisions.length > 4) checkpoint.decisions.pop();
  while (tokenCount(checkpoint) > maxTokens && checkpoint.exactIdentifiers.length > 10) checkpoint.exactIdentifiers.pop();
  while (tokenCount(checkpoint) > maxTokens && checkpoint.evidence.length > 10) checkpoint.evidence.shift();

  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: `<context_checkpoint>${JSON.stringify(checkpoint)}</context_checkpoint>` }],
  };
}

export function textOfItem(item) {
  return itemText(item);
}
