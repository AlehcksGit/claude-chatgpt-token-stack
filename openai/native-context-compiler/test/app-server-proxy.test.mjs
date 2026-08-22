import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BridgeMessageStore,
  createBridgeRecord,
  feedbackText,
  isLeanBridgeRun,
  patchHistoryResponse,
  syntheticBridgeMessages,
} from '../src/app-server-proxy-protocol.mjs';
import { consumeBridgeTurnContext, writeBridgeTurnContext } from '../src/bridge-context.mjs';

test('desktop turn context transfers effort once without storing prompt text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-bridge-context-'));
  const file = path.join(root, 'context.json');
  try {
    await writeBridgeTurnContext({
      threadId: 'thread-1',
      sessionId: 'thread-1',
      prompt: 'Sensitive local prompt',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    }, file);
    const source = await readFile(file, 'utf8');
    assert.equal(source.includes('Sensitive local prompt'), false);
    const context = await consumeBridgeTurnContext({ sessionId: 'thread-1', prompt: 'Sensitive local prompt' }, file);
    assert.equal(context.effort, 'xhigh');
    assert.equal(context.model, 'gpt-5.6-sol');
    assert.equal(await consumeBridgeTurnContext({ sessionId: 'thread-1', prompt: 'Sensitive local prompt' }, file), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blocked Lean hook becomes a standard authoritative agent message', () => {
  const run = {
    eventName: 'userPromptSubmit',
    statusMessage: 'Running the local Lean Bridge',
    status: 'blocked',
    entries: [{ kind: 'feedback', text: 'Finished.' }],
  };
  assert.equal(isLeanBridgeRun(run), true);
  assert.equal(feedbackText(run), 'Finished.');
  const record = createBridgeRecord({ threadId: 'thread-1', turnId: 'turn-1', text: 'Finished.', completedAtMs: 1000 });
  const messages = syntheticBridgeMessages(record, {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], itemsView: 'notLoaded', status: 'completed', error: null } },
    emittedAtMs: 1000,
  });
  assert.deepEqual(messages.map((message) => message.method), [
    'item/started', 'item/agentMessage/delta', 'item/completed', 'turn/completed',
  ]);
  assert.equal(messages[2].params.item.text, 'Finished.');
  assert.equal(messages[3].params.turn.items[0].type, 'agentMessage');
});

test('bridge messages survive app-server restart and patch thread history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-bridge-store-'));
  const file = path.join(root, 'messages.jsonl');
  try {
    const first = new BridgeMessageStore(file);
    const record = createBridgeRecord({ threadId: 'thread-1', turnId: 'turn-1', text: 'Persisted.' });
    await first.remember(record);
    const second = new BridgeMessageStore(file);
    await second.load();
    const response = patchHistoryResponse({
      id: 1,
      result: { thread: { id: 'thread-1', turns: [{ id: 'turn-1', items: [], itemsView: 'full' }] } },
    }, { method: 'thread/read', params: { threadId: 'thread-1' } }, second.forThread('thread-1'));
    assert.equal(response.result.thread.turns[0].items[0].text, 'Persisted.');
    assert.equal(response.result.thread.turns[0].itemsView, 'summary');
    await second.forgetThread('thread-1');
    assert.equal(second.forThread('thread-1').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
