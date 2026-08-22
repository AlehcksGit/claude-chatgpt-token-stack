import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { bridgeMessagesPath } from './paths.mjs';

export const LEAN_BRIDGE_STATUS = 'Running the local Lean Bridge';

function recordKey(threadId, turnId) {
  return `${threadId}\u0000${turnId}`;
}

function itemId(threadId, turnId) {
  const digest = createHash('sha256').update(recordKey(threadId, turnId)).digest('hex').slice(0, 32);
  return `ncc_bridge_${digest}`;
}

export function isLeanBridgeRun(run) {
  return run?.eventName === 'userPromptSubmit'
    && run?.statusMessage === LEAN_BRIDGE_STATUS;
}

export function feedbackText(run) {
  const entries = Array.isArray(run?.entries) ? run.entries : [];
  const feedback = entries
    .filter((entry) => entry?.kind === 'feedback' && typeof entry.text === 'string' && entry.text.trim())
    .map((entry) => entry.text.trim());
  return feedback.length ? feedback.join('\n\n') : null;
}

export function bridgeAgentItem(record) {
  return {
    type: 'agentMessage',
    id: record.itemId,
    text: record.text,
    phase: 'final_answer',
    memoryCitation: null,
    delivery: null,
  };
}

export function createBridgeRecord({ threadId, turnId, text, completedAtMs = Date.now() }) {
  return {
    op: 'upsert',
    at: new Date(completedAtMs).toISOString(),
    threadId,
    turnId,
    itemId: itemId(threadId, turnId),
    text: String(text ?? '').trim(),
    completedAtMs,
  };
}

function patchTurn(turn, records) {
  if (!turn || typeof turn.id !== 'string') return turn;
  const record = records.find((candidate) => candidate.turnId === turn.id);
  if (!record) return turn;
  const items = Array.isArray(turn.items) ? [...turn.items] : [];
  if (!items.some((item) => item?.type === 'agentMessage')) items.push(bridgeAgentItem(record));
  return { ...turn, items, itemsView: 'summary' };
}

export function patchHistoryResponse(message, request, records) {
  if (!message?.result || !request || !Array.isArray(records) || !records.length) return message;
  const method = request.method;
  if (method === 'thread/read' && Array.isArray(message.result.thread?.turns)) {
    return {
      ...message,
      result: {
        ...message.result,
        thread: {
          ...message.result.thread,
          turns: message.result.thread.turns.map((turn) => patchTurn(turn, records)),
        },
      },
    };
  }
  if (method === 'thread/turns/list' && Array.isArray(message.result.data)) {
    return {
      ...message,
      result: { ...message.result, data: message.result.data.map((turn) => patchTurn(turn, records)) },
    };
  }
  if (method === 'thread/items/list' && Array.isArray(message.result.data)) {
    const selected = records.filter((record) => !request.params?.turnId || record.turnId === request.params.turnId);
    const data = [...message.result.data];
    for (const record of selected) {
      if (!data.some((item) => item?.id === record.itemId)) data.push(bridgeAgentItem(record));
    }
    return { ...message, result: { ...message.result, data } };
  }
  return message;
}

export function syntheticBridgeMessages(record, originalTurnCompleted) {
  const threadId = record.threadId;
  const turnId = record.turnId;
  const completedAtMs = Number(record.completedAtMs) || Date.now();
  const item = bridgeAgentItem(record);
  const originalTurn = originalTurnCompleted?.params?.turn ?? {};
  const turn = {
    ...originalTurn,
    items: [
      ...(Array.isArray(originalTurn.items) ? originalTurn.items.filter((candidate) => candidate?.type !== 'agentMessage') : []),
      item,
    ],
    itemsView: 'summary',
  };
  return [
    {
      method: 'item/started',
      params: {
        item: { ...item, text: '' },
        threadId,
        turnId,
        startedAtMs: completedAtMs,
      },
      emittedAtMs: completedAtMs,
    },
    {
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: record.itemId, delta: record.text },
      emittedAtMs: completedAtMs,
    },
    {
      method: 'item/completed',
      params: { item, threadId, turnId, completedAtMs },
      emittedAtMs: completedAtMs,
    },
    {
      ...originalTurnCompleted,
      params: { ...originalTurnCompleted.params, threadId, turn },
    },
  ];
}

export class BridgeMessageStore {
  constructor(file = bridgeMessagesPath()) {
    this.file = file;
    this.records = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    let source = '';
    try { source = await readFile(this.file, 'utf8'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event?.op === 'upsert' && event.threadId && event.turnId && event.text) {
        this.records.set(recordKey(event.threadId, event.turnId), event);
      } else if (event?.op === 'delete_thread' && event.threadId) {
        for (const [key, value] of this.records) if (value.threadId === event.threadId) this.records.delete(key);
      }
    }
  }

  async append(event) {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async remember(record) {
    await this.load();
    this.records.set(recordKey(record.threadId, record.turnId), record);
    await this.append(record);
  }

  async forgetThread(threadId) {
    await this.load();
    for (const [key, value] of this.records) if (value.threadId === threadId) this.records.delete(key);
    await this.append({ op: 'delete_thread', at: new Date().toISOString(), threadId });
  }

  async cloneThread(sourceThreadId, targetThreadId, lastTurnId = null) {
    await this.load();
    const source = this.forThread(sourceThreadId);
    let include = true;
    for (const record of source) {
      if (!include) break;
      const clone = createBridgeRecord({
        threadId: targetThreadId,
        turnId: record.turnId,
        text: record.text,
        completedAtMs: record.completedAtMs,
      });
      await this.remember(clone);
      if (lastTurnId && record.turnId === lastTurnId) include = false;
    }
  }

  forThread(threadId) {
    return [...this.records.values()]
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => String(left.at).localeCompare(String(right.at)));
  }
}
