import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

export function tokenCount(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return countTokens(text ?? '');
}

export function percentSaved(before, after) {
  if (before <= 0) return 0;
  return ((before - after) / before) * 100;
}
