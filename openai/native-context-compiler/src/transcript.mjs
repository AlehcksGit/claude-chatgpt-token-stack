import { createReadStream } from 'node:fs';
import readline from 'node:readline';

function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function samePrompt(left, right) {
  return String(left ?? '').trim().replace(/\s+/g, ' ') === String(right ?? '').trim().replace(/\s+/g, ' ');
}

export async function readConversationTranscript(file, {
  excludeTrailingPrompt,
  maxMessages = 200,
} = {}) {
  if (typeof file !== 'string' || !file) return [];
  const messages = [];
  try {
    const lines = readline.createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const payload = entry?.type === 'response_item' ? entry.payload : null;
      if (payload?.type !== 'message' || !['user', 'assistant'].includes(payload.role)) continue;
      if (payload.role === 'assistant' && payload.phase && payload.phase !== 'final_answer') continue;
      const text = messageText(payload.content);
      if (!text) continue;
      messages.push({ role: payload.role, text });
      if (messages.length > maxMessages) messages.shift();
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') return [];
    throw error;
  }
  if (
    messages.at(-1)?.role === 'user'
    && samePrompt(messages.at(-1)?.text, excludeTrailingPrompt)
  ) messages.pop();
  return messages;
}
