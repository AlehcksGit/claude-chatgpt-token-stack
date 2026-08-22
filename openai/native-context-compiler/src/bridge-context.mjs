import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bridgeContextPath } from './paths.mjs';

const MAX_CONTEXTS = 100;
const MAX_AGE_MS = 15 * 60 * 1000;

export function promptDigest(prompt) {
  return createHash('sha256').update(String(prompt ?? ''), 'utf8').digest('hex');
}

async function readDocument(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed?.contexts) ? parsed : { version: 1, contexts: [] };
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { version: 1, contexts: [] };
    throw error;
  }
}

async function writeDocument(file, document) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function recentContexts(contexts, now = Date.now()) {
  return contexts.filter((entry) => {
    const at = Date.parse(entry?.at ?? '');
    return Number.isFinite(at) && now - at <= MAX_AGE_MS;
  }).slice(-MAX_CONTEXTS);
}

export async function writeBridgeTurnContext({
  threadId,
  sessionId,
  prompt,
  model,
  effort,
  bypass = false,
  bypassReason = null,
} = {}, file = bridgeContextPath()) {
  const document = await readDocument(file);
  const context = {
    at: new Date().toISOString(),
    threadId: typeof threadId === 'string' ? threadId : null,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    promptHash: promptDigest(prompt),
    model: typeof model === 'string' ? model : null,
    effort: typeof effort === 'string' ? effort : null,
    bypass: Boolean(bypass),
    bypassReason: typeof bypassReason === 'string' ? bypassReason : null,
  };
  document.version = 1;
  document.contexts = [...recentContexts(document.contexts), context].slice(-MAX_CONTEXTS);
  await writeDocument(file, document);
  return context;
}

export async function consumeBridgeTurnContext({ sessionId, prompt } = {}, file = bridgeContextPath()) {
  const document = await readDocument(file);
  const contexts = recentContexts(document.contexts);
  const hash = promptDigest(prompt);
  let index = -1;
  for (let cursor = contexts.length - 1; cursor >= 0; cursor -= 1) {
    const candidate = contexts[cursor];
    const sessionMatches = !sessionId
      || candidate.sessionId === sessionId
      || candidate.threadId === sessionId;
    if (candidate.promptHash === hash && sessionMatches) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return null;
  const [match] = contexts.splice(index, 1);
  document.version = 1;
  document.contexts = contexts;
  await writeDocument(file, document);
  return match;
}
