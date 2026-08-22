import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LiveEvaluationError,
  createLiveEvaluationFixture,
  prepareLiveEvaluation,
  runLiveAbEvaluation,
  scoreLiveAnswer,
  validateRateLimitHeadroom,
} from '../src/live-eval.mjs';

function preparedFixture() {
  const fixture = createLiveEvaluationFixture({ noiseTurns: 2, noiseRepeat: 2 });
  return {
    model: 'test-model',
    expected: fixture.expected,
    instructions: fixture.instructions,
    finalPrompt: fixture.finalPrompt,
    outputSchema: fixture.outputSchema,
    baselineItems: fixture.input,
    optimizedItems: fixture.input.slice(-2),
    localReport: { baselineTokens: 1000, compiledTokens: 200, savedPercent: 80 },
  };
}

class FakeLiveClient {
  constructor({ paidCredits = false, forbidden = false, missingUsage = false, wrongModel = false } = {}) {
    this.paidCredits = paidCredits;
    this.forbidden = forbidden;
    this.missingUsage = missingUsage;
    this.wrongModel = wrongModel;
    this.listeners = new Set();
    this.injected = new Map();
    this.started = 0;
    this.turns = 0;
    this.interrupts = 0;
    this.unsubscribed = [];
    this.threadParams = [];
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method, params) {
    const event = { kind: 'notification', value: { method, params } };
    for (const listener of this.listeners) listener(event);
  }

  async start() { this.started += 1; }

  async readAccount() {
    return { account: { type: 'chatgpt', planType: 'pro', email: 'not-returned@example.com' } };
  }

  async readRateLimits() {
    return {
      rateLimits: {
        credits: { hasCredits: this.paidCredits, unlimited: false, balance: this.paidCredits ? '5' : null },
        individualLimit: null,
        primary: { usedPercent: 10, resetsAt: 1, windowDurationMins: 300 },
        secondary: null,
        rateLimitReachedType: null,
      },
    };
  }

  async startThread(params) {
    this.threadParams.push(structuredClone(params));
    const id = `thread-${this.injected.size + 1}`;
    return {
      thread: { id },
      approvalPolicy: params.approvalPolicy,
      cwd: params.cwd,
      instructionSources: [],
      model: this.wrongModel ? 'rerouted-model' : params.model,
      modelProvider: 'openai',
      runtimeWorkspaceRoots: [],
      sandbox: { type: 'readOnly', networkAccess: false },
      serviceTier: params.serviceTier ?? null,
    };
  }

  async injectItems({ threadId, items }) {
    this.injected.set(threadId, structuredClone(items));
    return {};
  }

  async startTurn({ threadId }) {
    this.turns += 1;
    const turnId = `turn-${this.turns}`;
    const baseline = this.injected.get(threadId).length > 2;
    const expected = preparedFixture().expected;
    queueMicrotask(() => {
      this.emit('mcpServer/startupStatus/updated', { status: 'complete' });
      this.emit('item/completed', {
        completedAtMs: Date.now(),
        threadId: 'unrelated-thread',
        turnId: 'unrelated-turn',
        item: { type: 'commandExecution', id: 'ignored', status: 'completed' },
      });
      if (this.forbidden) {
        this.emit('item/completed', {
          completedAtMs: Date.now(),
          threadId,
          turnId,
          item: { type: 'commandExecution', id: 'forbidden', status: 'completed' },
        });
        return;
      }
      this.emit('item/completed', {
        completedAtMs: Date.now(),
        threadId,
        turnId,
        item: { type: 'agentMessage', id: `answer-${turnId}`, phase: 'final_answer', text: JSON.stringify(expected) },
      });
      if (!this.missingUsage) {
        const inputTokens = baseline ? 1000 : 200;
        const breakdown = {
          inputTokens,
          cachedInputTokens: baseline ? 100 : 20,
          outputTokens: 40,
          reasoningOutputTokens: 10,
          totalTokens: inputTokens + 40,
        };
        this.emit('thread/tokenUsage/updated', {
          threadId,
          turnId,
          tokenUsage: { last: breakdown, total: breakdown, modelContextWindow: 10000 },
        });
      }
      this.emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [], error: null } });
    });
    return { turn: { id: turnId, status: 'inProgress', items: [], error: null } };
  }

  async interruptTurn() { this.interrupts += 1; }

  async unsubscribeThread(threadId) { this.unsubscribed.push(threadId); }

  close() { this.closed = true; }
}

test('local live fixture preparation compiles without model calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-live-prepare-'));
  try {
    const prepared = await prepareLiveEvaluation({
      vaultRoot: path.join(root, 'vault'),
      model: 'fixture-model',
      fixture: createLiveEvaluationFixture({ noiseTurns: 12, noiseRepeat: 20 }),
      compileOptions: { maxInputTokens: 1800, recentTokens: 800, checkpointTokens: 600 },
    });
    assert.ok(prepared.optimizedItems.length < prepared.baselineItems.length);
    assert.equal(prepared.localReport.withinBudget, true);
    assert.equal(prepared.localReport.toolPairsValid, true);
    assert.equal(prepared.localReport.needsOpaqueCompactionBoundary, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('live runner is opt-in and requires Claude idle', async () => {
  const client = new FakeLiveClient();
  const common = {
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
  };
  await assert.rejects(runLiveAbEvaluation(common), (error) => error.code === 'live_opt_in_required');
  await assert.rejects(runLiveAbEvaluation({ ...common, live: true }), (error) => error.code === 'claude_idle_confirmation_required');
  assert.equal(client.started, 0);
  assert.equal(client.turns, 0);
});

test('rate-limit preflight rejects paid credits, missing telemetry, and low headroom', () => {
  assert.throws(() => validateRateLimitHeadroom({ rateLimits: { primary: { usedPercent: 10 }, credits: { hasCredits: true }, individualLimit: null } }), (error) => error.code === 'paid_credits_present');
  assert.throws(() => validateRateLimitHeadroom({ rateLimits: {} }), (error) => error.code === 'rate_limit_telemetry_missing');
  assert.throws(() => validateRateLimitHeadroom({ rateLimits: { primary: { usedPercent: 10 }, individualLimit: null } }), (error) => error.code === 'billing_telemetry_missing');
  assert.throws(() => validateRateLimitHeadroom({ rateLimits: { primary: { usedPercent: 90 }, credits: { hasCredits: false }, individualLimit: null } }), (error) => error.code === 'subscription_headroom_too_low');
});

test('answer scoring requires exact JSON keys and values', () => {
  const expected = preparedFixture().expected;
  assert.equal(scoreLiveAnswer(JSON.stringify(expected), expected).perfect, true);
  assert.equal(scoreLiveAnswer(`result: ${JSON.stringify(expected)}`, expected).reason, 'invalid_json');
  assert.equal(scoreLiveAnswer(JSON.stringify({ ...expected, extra: true }), expected).reason, 'key_mismatch');
  assert.equal(scoreLiveAnswer(JSON.stringify({ ...expected, port: 47191 }), expected).reason, 'value_mismatch');
});

test('fake paired run uses isolated new threads and exact per-turn usage', async () => {
  const client = new FakeLiveClient();
  const result = await runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
    seed: 'deterministic-seed',
  });
  assert.equal(result.valid, true);
  assert.equal(result.nativeInputSavedTokens, 800);
  assert.notEqual(result.baseline.threadId, result.optimized.threadId);
  assert.equal(result.baseline.quality.perfect, true);
  assert.equal(result.optimized.quality.perfect, true);
  assert.equal(client.turns, 2);
  assert.equal(client.unsubscribed.length, 2);
  assert.equal(client.closed, true);
  assert.doesNotMatch(JSON.stringify(result), /not-returned@example\.com/);
});

test('paired run can compare ordinary baseline context to a lean optimized profile', async () => {
  const client = new FakeLiveClient();
  await runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
    seed: 'deterministic-seed',
    optimizedThreadConfig: { features: { plugins: false, shell_tool: false } },
  });
  const baseline = client.threadParams.find((params) => params.config === undefined);
  const optimized = client.threadParams.find((params) => params.config?.features?.plugins === false);
  assert.ok(baseline);
  assert.equal(optimized.config.features.shell_tool, false);
});

test('paid-credit state blocks before any thread or turn starts', async () => {
  const client = new FakeLiveClient({ paidCredits: true });
  await assert.rejects(runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
  }), (error) => error instanceof LiveEvaluationError && error.code === 'paid_credits_present');
  assert.equal(client.turns, 0);
});

test('sandbox or model mismatch blocks before a model turn', async () => {
  const client = new FakeLiveClient({ wrongModel: true });
  await assert.rejects(runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
  }), (error) => error.code === 'model_mismatch');
  assert.equal(client.turns, 0);
  assert.equal(client.unsubscribed.length, 1);
});

test('forbidden item events interrupt and invalidate the run', async () => {
  const client = new FakeLiveClient({ forbidden: true });
  await assert.rejects(runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
    timeoutMs: 100,
  }), (error) => error.code === 'forbidden_live_event');
  assert.equal(client.interrupts, 1);
  assert.equal(client.unsubscribed.length, 1);
});

test('missing usage telemetry invalidates the run instead of estimating it', async () => {
  const client = new FakeLiveClient({ missingUsage: true });
  await assert.rejects(runLiveAbEvaluation({
    client,
    prepared: preparedFixture(),
    cwd: path.resolve(os.tmpdir(), 'isolated-live-test'),
    effort: 'low',
    live: true,
    claudeIdleConfirmed: true,
    timeoutMs: 20,
  }), (error) => error.code === 'turn_timeout');
  assert.equal(client.interrupts, 1);
});
