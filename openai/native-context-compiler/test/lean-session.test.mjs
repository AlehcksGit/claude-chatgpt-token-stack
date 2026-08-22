import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { leanSessionPath, runLeanSessionTurn } from '../src/lean-session.mjs';

class FakeLeanClient {
  constructor() {
    this.listeners = new Set();
    this.thread = 0;
    this.turn = 0;
    this.injected = [];
  }

  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(method, params) {
    for (const listener of this.listeners) listener({ kind: 'notification', value: { method, params } });
  }
  async start() {}
  async readAccount() { return { account: { type: 'chatgpt', planType: 'pro', email: 'private@example.com' } }; }
  async startThread(params) {
    this.thread += 1;
    this.threadParams = params;
    return { thread: { id: `thread-${this.thread}` }, model: params.model ?? 'selected-model' };
  }
  async injectItems(params) { this.injected.push(params); }
  async startTurn(params) {
    this.turn += 1;
    const turnId = `turn-${this.turn}`;
    queueMicrotask(() => {
      this.emit('item/completed', {
        threadId: params.threadId,
        turnId,
        item: { type: 'agentMessage', phase: 'final_answer', text: `answer-${this.turn}` },
      });
      const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 };
      this.emit('thread/tokenUsage/updated', {
        threadId: params.threadId,
        turnId,
        tokenUsage: { last: usage, total: usage },
      });
      this.emit('turn/completed', { threadId: params.threadId, turn: { id: turnId, status: 'completed' } });
    });
    return { turn: { id: turnId } };
  }
  async interruptTurn() {}
  async unsubscribeThread() {}
  close() { this.closed = true; }
}

test('lean session uses subscription auth, pruned capabilities, and local history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-lean-session-'));
  const workspace = path.join(root, 'workspace');
  const client = new FakeLeanClient();
  try {
    const first = await runLeanSessionTurn({
      prompt: 'first prompt',
      sessionName: 'test-session',
      cwd: workspace,
      effort: 'xhigh',
      profile: 'workspace',
      dataDirectory: root,
      client,
      closeClient: false,
    });
    assert.equal(first.answer, 'answer-1');
    assert.equal(first.model, 'selected-model');
    assert.equal(first.planType, 'pro');
    assert.equal(first.apiKeyUsed, false);
    assert.equal(client.threadParams.config.features.plugins, false);
    assert.equal(client.threadParams.config.features.shell_tool, true);
    assert.equal(first.history.mode, 'empty');

    const second = await runLeanSessionTurn({
      prompt: 'second prompt',
      sessionName: 'test-session',
      cwd: workspace,
      profile: 'workspace',
      dataDirectory: root,
      client,
      closeClient: false,
    });
    assert.equal(second.answer, 'answer-2');
    assert.ok(client.injected.length >= 1);
    const saved = JSON.parse(await readFile(leanSessionPath('test-session', root), 'utf8'));
    assert.equal(saved.messages.length, 4);
    assert.doesNotMatch(JSON.stringify(first), /private@example\.com/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('lean session rejects workspace reuse across directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-lean-mismatch-'));
  const client = new FakeLeanClient();
  try {
    await runLeanSessionTurn({ prompt: 'one', sessionName: 'same', cwd: path.join(root, 'a'), dataDirectory: root, client, closeClient: false });
    await assert.rejects(
      runLeanSessionTurn({ prompt: 'two', sessionName: 'same', cwd: path.join(root, 'b'), dataDirectory: root, client, closeClient: false }),
      (error) => error.code === 'session_workspace_mismatch',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
