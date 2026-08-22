const CALL_TYPES = new Set(['function_call', 'custom_tool_call']);
const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);

export function itemType(item) {
  return item && typeof item === 'object' && typeof item.type === 'string'
    ? item.type
    : '';
}

export function callKey(item) {
  if (!item || typeof item !== 'object') return undefined;
  for (const key of ['call_id', 'tool_call_id', 'id']) {
    if (typeof item[key] === 'string' && item[key]) return item[key];
  }
  return undefined;
}

function parseObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function callCommand(item) {
  if (!item || typeof item !== 'object') return '';
  const args = {
    ...parseObject(item.arguments),
    ...parseObject(item.input),
  };
  for (const value of [args.cmd, args.command, args.script, item.command]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return typeof item.name === 'string' ? item.name : '';
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    for (const key of ['text', 'output_text', 'content']) {
      if (typeof part[key] === 'string') return part[key];
    }
    return '';
  }).filter(Boolean).join('\n');
}

export function outputText(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.output === 'string') return item.output;
  const fromContent = textFromContent(item.content);
  if (fromContent) return fromContent;
  return item.output == null ? '' : JSON.stringify(item.output);
}

export function replaceOutputText(item, text) {
  const next = structuredClone(item);
  if (typeof next.output === 'string' || Object.hasOwn(next, 'output')) {
    next.output = text;
    return next;
  }
  if (typeof next.content === 'string' || !Array.isArray(next.content)) {
    next.content = text;
    return next;
  }
  const index = next.content.findIndex((part) => part && typeof part === 'object'
    && ['text', 'output_text', 'content'].some((key) => typeof part[key] === 'string'));
  if (index < 0) {
    next.content = [{ type: 'input_text', text }];
    return next;
  }
  const part = { ...next.content[index] };
  const key = ['text', 'output_text', 'content'].find((name) => typeof part[name] === 'string');
  part[key] = text;
  next.content = [part];
  return next;
}

export function pairToolItems(items) {
  const calls = new Map();
  const matched = new Set();
  const pairs = [];
  const unresolved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const type = itemType(item);
    if (CALL_TYPES.has(type)) {
      const key = callKey(item);
      if (key && calls.has(key)) unresolved.push({ index, reason: 'duplicate_call', type, key });
      else if (key) calls.set(key, { item, index });
      else unresolved.push({ index, reason: 'call_missing_id', type });
      continue;
    }
    if (!OUTPUT_TYPES.has(type)) continue;
    const key = callKey(item);
    const call = key ? calls.get(key) : undefined;
    if (!call) {
      unresolved.push({ index, reason: 'orphan_output', type, key });
      continue;
    }
    if (matched.has(key)) {
      unresolved.push({ index, reason: 'duplicate_output', type, key });
      continue;
    }
    matched.add(key);
    pairs.push({ key, call: call.item, callIndex: call.index, output: item, outputIndex: index });
  }
  for (const [key, call] of calls) {
    if (!matched.has(key)) unresolved.push({ index: call.index, reason: 'open_call', type: itemType(call.item), key });
  }
  return { pairs, unresolved };
}

export function validateToolPairs(items) {
  const { unresolved } = pairToolItems(items);
  return { valid: unresolved.length === 0, unresolved };
}
