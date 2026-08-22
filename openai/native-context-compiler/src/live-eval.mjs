import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ContextRuntime } from './runtime.mjs';
import { NativeContextCompiler } from './native-context-compiler.mjs';

const ALLOWED_PLANS = new Set(['pro', 'business', 'enterprise', 'edu']);
const FORBIDDEN_ITEM_TYPES = new Set([
  'collabAgentToolCall',
  'commandExecution',
  'dynamicToolCall',
  'fileChange',
  'imageGeneration',
  'mcpToolCall',
  'subAgentActivity',
  'webSearch',
]);
const FORBIDDEN_METHOD = /(approval|elicitation|hook|diff|rerout|commandexecution|filechange|mcp|websearch|subagent|collab)/i;
const PASSIVE_STATUS_METHODS = new Set([
  'mcpServer/startupStatus/updated',
]);
const USAGE_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
];

export class LiveEvaluationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiveEvaluationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LiveEvaluationError(code, message);
}

function message(role, text) {
  return {
    type: 'message',
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
  };
}

export function createLiveEvaluationFixture({ noiseTurns = 18, noiseRepeat = 45 } = {}) {
  const expected = Object.freeze({
    build_hash: '53dd3e2db44143c1a19d34717aab4516',
    session_id: '01a020c5-fdf0-7260-9331-f08662d42ad4',
    release: '0.145.0',
    port: '47191',
  });
  const input = [message('user', [
    'Objective: retain these four exact release facts for a later audit question.',
    `build_hash=${expected.build_hash}`,
    `session_id=${expected.session_id}`,
    `release=${expected.release}`,
    `port=${expected.port}`,
    'Do not alter, normalize, infer, or abbreviate any value.',
  ].join('\n'))];
  const noise = 'Harmless archived diagnostic detail with no commands, paths, credentials, or release facts. '.repeat(noiseRepeat);
  for (let index = 0; index < noiseTurns; index += 1) {
    input.push(message('assistant', `Archived note ${index}: ${noise}`));
    input.push(message('user', `Continue reviewing the harmless archive slice named alpha${index}; the exact release question comes later.`));
  }
  input.push(message('assistant', 'Archive review completed. The exact release facts remain in the earlier supplied history.'));
  const instructions = [
    'Use only the supplied conversation history.',
    'Do not call tools, execute commands, browse, read files, write files, use plugins, or delegate.',
    'For the final task, return exactly one JSON object with no prose or markdown.',
  ].join(' ');
  const finalPrompt = 'Return the four earlier release facts as exactly one JSON object with keys build_hash, session_id, release, and port. Preserve every value byte-for-byte.';
  const outputSchema = {
    type: 'object',
    required: Object.keys(expected),
    properties: Object.fromEntries(Object.keys(expected).map((key) => [key, { type: 'string' }])),
    additionalProperties: false,
  };
  return { expected, input, instructions, finalPrompt, outputSchema };
}

export async function prepareLiveEvaluation({
  vaultRoot,
  model,
  compileOptions = {},
  fixture = createLiveEvaluationFixture(),
} = {}) {
  if (!path.isAbsolute(vaultRoot ?? '')) fail('absolute_vault_root_required', 'An absolute, owned vault root is required');
  if (typeof model !== 'string' || !model.trim()) fail('explicit_model_required', 'An explicit model is required');
  const runtime = await new ContextRuntime({ vaultRoot }).init();
  const compiler = new NativeContextCompiler({ runtime });
  const baselineRequest = {
    model,
    instructions: fixture.instructions,
    input: structuredClone(fixture.input),
    tools: [],
  };
  const optimized = await compiler.compileRequest(baselineRequest, {
    maxInputTokens: 4000,
    recentTokens: 2200,
    checkpointTokens: 1200,
    maxTools: 0,
    includeLocalTools: false,
    aggressive: false,
    ...compileOptions,
  });
  if (optimized.mode !== 'compiled') fail('compiler_passthrough', `Local compiler did not produce a safe arm: ${optimized.reasons.join(',')}`);
  if (optimized.accounting?.modelCallsAdded !== 0
    || optimized.accounting?.compactionCallsAdded !== 0
    || optimized.accounting?.usageBilledCallsAdded !== 0) {
    fail('compiler_extra_call_risk', 'The native compiler reported added model, compaction, or usage-billed calls');
  }
  const report = optimized.report ?? {};
  if (!report.withinBudget || !report.toolPairsValid || report.qualityRisk || report.needsOpaqueCompactionBoundary) {
    fail('unsafe_compiler_report', 'The optimized arm failed a compiler safety gate');
  }
  if (optimized.request.model !== model
    || optimized.request.instructions !== fixture.instructions
    || !Array.isArray(optimized.request.tools)
    || optimized.request.tools.length !== 0) {
    fail('compiler_configuration_changed', 'The local compiler changed model, instructions, or tool configuration');
  }
  const optimizedHistory = JSON.stringify(optimized.request.input);
  if (Object.values(fixture.expected).some((value) => !optimizedHistory.includes(value))) {
    fail('compiler_identifier_loss', 'The optimized arm lost an exact evaluation identifier');
  }
  return {
    model,
    expected: structuredClone(fixture.expected),
    instructions: fixture.instructions,
    finalPrompt: fixture.finalPrompt,
    outputSchema: structuredClone(fixture.outputSchema),
    baselineItems: structuredClone(baselineRequest.input),
    optimizedItems: structuredClone(optimized.request.input),
    localReport: structuredClone(report),
  };
}

function validateAccount(result) {
  const account = result?.account;
  const plan = typeof account?.planType === 'string' ? account.planType.toLowerCase() : null;
  if (account?.type !== 'chatgpt') fail('chatgpt_auth_required', 'Live evaluation requires ChatGPT-managed authentication');
  if (!plan || !ALLOWED_PLANS.has(plan)) fail('subscription_plan_ineligible', 'Live evaluation requires ChatGPT Pro or an eligible higher-tier workspace plan');
  return plan;
}

export function validateRateLimitHeadroom(result, { maxUsedPercent = 80 } = {}) {
  const snapshot = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!snapshot || typeof snapshot !== 'object') fail('rate_limit_telemetry_missing', 'Codex rate-limit telemetry is unavailable');
  if (snapshot.rateLimitReachedType) fail('subscription_allowance_exhausted', 'The included subscription allowance is exhausted');
  const windows = [snapshot.primary, snapshot.secondary].filter(Boolean);
  if (!windows.length || windows.some((window) => !Number.isInteger(window.usedPercent))) {
    fail('rate_limit_telemetry_missing', 'A complete subscription usage window is required');
  }
  if (!snapshot.credits || typeof snapshot.credits.hasCredits !== 'boolean') {
    fail('billing_telemetry_missing', 'Paid-credit state is unavailable');
  }
  if (snapshot.credits?.hasCredits) fail('paid_credits_present', 'Paid-credit fallback cannot be excluded');
  if (!Object.hasOwn(snapshot, 'individualLimit')) fail('billing_telemetry_missing', 'Usage-billed limit state is unavailable');
  if (snapshot.individualLimit) fail('usage_billed_limit_present', 'A usage-billed spend limit is active');
  if (snapshot.spendControlReached === true) fail('spend_control_reached', 'The account spend control is reached');
  if (windows.some((window) => window.usedPercent > maxUsedPercent)) {
    fail('subscription_headroom_too_low', 'Subscription headroom is too low for a paired evaluation');
  }
  return {
    maximumUsedPercent: Math.max(...windows.map((window) => window.usedPercent)),
    paidCreditsAvailable: false,
  };
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function validateThreadStart(result, { cwd, model, serviceTier }) {
  const threadId = result?.thread?.id;
  if (typeof threadId !== 'string' || !threadId) fail('thread_id_missing', 'App-server did not return a new thread id');
  if (result.approvalPolicy !== 'never') fail('approval_policy_mismatch', 'App-server did not retain approvalPolicy=never');
  if (result.sandbox?.type !== 'readOnly' || result.sandbox?.networkAccess === true) {
    fail('sandbox_mismatch', 'App-server did not retain a network-denied read-only sandbox');
  }
  if (!samePath(result.cwd, cwd)) fail('cwd_mismatch', 'App-server changed the isolated working directory');
  if (result.model !== model) fail('model_mismatch', 'App-server changed the requested model');
  if (serviceTier !== undefined && result.serviceTier !== serviceTier) fail('service_tier_mismatch', 'App-server changed the requested service tier');
  if (!Array.isArray(result.runtimeWorkspaceRoots) || result.runtimeWorkspaceRoots.length !== 0) {
    fail('workspace_roots_present', 'App-server exposed a runtime workspace root');
  }
  return threadId;
}

function validateUsageBreakdown(value) {
  if (!value || USAGE_FIELDS.some((field) => !Number.isInteger(value[field]) || value[field] < 0)) {
    fail('usage_telemetry_invalid', 'Turn usage telemetry is missing or invalid');
  }
  if (value.cachedInputTokens > value.inputTokens) fail('usage_telemetry_invalid', 'Cached input exceeds total input');
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, value[field]]));
}

export function scoreLiveAnswer(text, expected) {
  if (typeof text !== 'string') return { perfect: false, reason: 'missing_text' };
  let parsed;
  try { parsed = JSON.parse(text.trim()); } catch { return { perfect: false, reason: 'invalid_json' }; }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { perfect: false, reason: 'not_object' };
  const actualKeys = Object.keys(parsed).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return { perfect: false, reason: 'key_mismatch' };
  if (expectedKeys.some((key) => parsed[key] !== expected[key])) return { perfect: false, reason: 'value_mismatch' };
  return { perfect: true, reason: 'exact' };
}

function seededOrder(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? ['baseline', 'optimized'] : ['optimized', 'baseline'];
}

function createEventStream(client) {
  const queue = [];
  const waiters = [];
  const dispose = client.onEvent((event) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(event);
    else queue.push(event);
  });
  return {
    async next(timeoutMs) {
      if (queue.length) return queue.shift();
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.push(waiter);
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new LiveEvaluationError('turn_timeout', 'Timed out waiting for a terminal app-server event'));
        }, timeoutMs);
        waiter.resolve = (event) => {
          clearTimeout(waiter.timer);
          resolve(event);
        };
      });
    },
    close() {
      dispose();
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new LiveEvaluationError('event_stream_closed', 'App-server event stream closed'));
      }
    },
  };
}

function notificationThreadId(message) {
  return message?.params?.threadId ?? message?.params?.turn?.threadId ?? null;
}

function forbiddenEvent(event, threadId) {
  if (event.kind === 'processExit' || event.kind === 'processError' || event.kind === 'protocolError') return event.kind;
  if (event.kind === 'serverRequest') {
    const eventThread = notificationThreadId(event.value);
    return !eventThread || eventThread === threadId ? 'server_request' : null;
  }
  if (event.kind !== 'notification') return null;
  const message = event.value;
  const eventThread = notificationThreadId(message);
  if (eventThread && eventThread !== threadId) return null;
  if (PASSIVE_STATUS_METHODS.has(message.method)) return null;
  if (FORBIDDEN_METHOD.test(message.method)) return message.method;
  if (message.method === 'item/started' || message.method === 'item/completed') {
    if (FORBIDDEN_ITEM_TYPES.has(message.params?.item?.type)) return `item:${message.params.item.type}`;
  }
  return null;
}

async function runArm({ client, stream, prepared, arm, cwd, effort, serviceTier, timeoutMs, active, threadConfig }) {
  const threadParams = {
    allowProviderModelFallback: false,
    approvalPolicy: 'never',
    baseInstructions: prepared.instructions,
    ...(threadConfig === undefined ? {} : { config: structuredClone(threadConfig) }),
    cwd,
    developerInstructions: prepared.instructions,
    dynamicTools: [],
    environments: [],
    ephemeral: true,
    model: prepared.model,
    runtimeWorkspaceRoots: [],
    sandbox: 'read-only',
    selectedCapabilityRoots: [],
    ...(serviceTier === undefined ? {} : { serviceTier }),
  };
  const startResult = await client.startThread(threadParams);
  const candidateThreadId = startResult?.thread?.id;
  if (typeof candidateThreadId === 'string' && candidateThreadId) {
    if (active.threadIds.includes(candidateThreadId)) fail('thread_reused', 'App-server reused a thread across evaluation arms');
    active.threadIds.push(candidateThreadId);
  }
  const threadId = validateThreadStart(startResult, { cwd, model: prepared.model, serviceTier });
  const items = arm === 'baseline' ? prepared.baselineItems : prepared.optimizedItems;
  await client.injectItems({ threadId, items: structuredClone(items) });
  const turnResult = await client.startTurn({
    approvalPolicy: 'never',
    cwd,
    effort,
    environments: [],
    input: [{ type: 'text', text: prepared.finalPrompt }],
    model: prepared.model,
    outputSchema: prepared.outputSchema,
    runtimeWorkspaceRoots: [],
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    threadId,
    ...(serviceTier === undefined ? {} : { serviceTier }),
  });
  const turnId = turnResult?.turn?.id;
  if (typeof turnId !== 'string' || !turnId) fail('turn_id_missing', 'App-server did not return a turn id');
  active.turn = { threadId, turnId };
  let finalText;
  let completed;
  let usage;
  let priorTotal;
  const deadline = Date.now() + timeoutMs;
  while (!completed || finalText === undefined || !usage) {
    const event = await stream.next(Math.max(1, deadline - Date.now()));
    const violation = forbiddenEvent(event, threadId);
    if (violation) fail('forbidden_live_event', `Forbidden app-server event: ${violation}`);
    if (event.kind !== 'notification') continue;
    const message = event.value;
    if (notificationThreadId(message) !== threadId) continue;
    if (message.method === 'item/completed' && message.params?.turnId === turnId) {
      const item = message.params.item;
      if (item?.type === 'agentMessage' && (!item.phase || item.phase === 'final_answer')) finalText = item.text;
    } else if (message.method === 'thread/tokenUsage/updated' && message.params?.turnId === turnId) {
      const total = validateUsageBreakdown(message.params.tokenUsage?.total);
      if (priorTotal && USAGE_FIELDS.some((field) => total[field] < priorTotal[field])) {
        fail('usage_telemetry_non_monotonic', 'Whole-thread token usage decreased');
      }
      priorTotal = total;
      usage = validateUsageBreakdown(message.params.tokenUsage?.last);
    } else if (message.method === 'turn/completed' && message.params?.turn?.id === turnId) {
      completed = message.params.turn;
    }
  }
  if (completed.status !== 'completed') fail('turn_not_completed', `Turn ended with status ${completed.status}`);
  const quality = scoreLiveAnswer(finalText, prepared.expected);
  if (!quality.perfect) fail('quality_gate_failed', `${arm} answer failed exact scoring: ${quality.reason}`);
  active.turn = null;
  return { arm, threadId, turnId, answer: finalText, quality, usage };
}

export async function runLiveAbEvaluation({
  client,
  prepared,
  cwd,
  effort,
  serviceTier,
  live = false,
  claudeIdleConfirmed = false,
  maxUsedPercent = 80,
  threadConfig,
  baselineThreadConfig,
  optimizedThreadConfig,
  timeoutMs = 120000,
  seed = randomBytes(8).toString('hex'),
  closeClient = true,
} = {}) {
  if (!live) fail('live_opt_in_required', 'Live evaluation is disabled by default');
  if (!claudeIdleConfirmed) fail('claude_idle_confirmation_required', 'Claude must be explicitly confirmed idle before shared subscription turns');
  if (!client || typeof client.onEvent !== 'function') fail('event_capable_client_required', 'An event-capable app-server client is required');
  if (!prepared || !Array.isArray(prepared.baselineItems) || !Array.isArray(prepared.optimizedItems)) {
    fail('prepared_evaluation_required', 'Prepared baseline and optimized arms are required');
  }
  if (!path.isAbsolute(cwd ?? '')) fail('absolute_isolated_cwd_required', 'An absolute isolated working directory is required');
  if (typeof effort !== 'string' || !effort) fail('explicit_effort_required', 'An explicit reasoning effort is required');
  const order = seededOrder(seed);
  const active = { turn: null, threadIds: [] };
  let stream;
  try {
    await client.start();
    const planType = validateAccount(await client.readAccount());
    const headroom = validateRateLimitHeadroom(await client.readRateLimits(), { maxUsedPercent });
    stream = createEventStream(client);
    const results = {};
    for (const arm of order) {
      const armConfig = arm === 'baseline' ? baselineThreadConfig : optimizedThreadConfig;
      results[arm] = await runArm({
        client,
        stream,
        prepared,
        arm,
        cwd,
        effort,
        serviceTier,
        timeoutMs,
        active,
        threadConfig: armConfig === undefined ? threadConfig : armConfig,
      });
    }
    if (results.optimized.usage.inputTokens >= results.baseline.usage.inputTokens) {
      fail('native_input_not_reduced', 'Optimized native input was not lower than baseline');
    }
    return {
      valid: true,
      seed: String(seed),
      order,
      planType,
      headroom,
      model: prepared.model,
      effort,
      serviceTier: serviceTier ?? null,
      localReduction: {
        baselineTokens: prepared.localReport.baselineTokens,
        compiledTokens: prepared.localReport.compiledTokens,
        savedPercent: prepared.localReport.savedPercent,
      },
      baseline: results.baseline,
      optimized: results.optimized,
      nativeInputSavedTokens: results.baseline.usage.inputTokens - results.optimized.usage.inputTokens,
      cachedInputTokens: {
        baseline: results.baseline.usage.cachedInputTokens,
        optimized: results.optimized.usage.cachedInputTokens,
      },
    };
  } catch (error) {
    if (active.turn) {
      try { await client.interruptTurn(active.turn); } catch {}
    }
    throw error;
  } finally {
    stream?.close();
    for (const threadId of active.threadIds) {
      try { await client.unsubscribeThread(threadId); } catch {}
    }
    if (closeClient) client?.close?.();
  }
}
