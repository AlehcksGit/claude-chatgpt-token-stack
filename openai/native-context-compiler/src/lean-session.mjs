import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexAppServerClient } from './codex-app-server.mjs';
import { leanCodexConfig } from './lean-config.mjs';
import { NativeContextCompiler } from './native-context-compiler.mjs';
import { ContextRuntime } from './runtime.mjs';
import { dataRoot } from './paths.mjs';
import { recordLeanTurn } from './turn-telemetry.mjs';

const ALLOWED_PLANS = new Set(['pro', 'business', 'enterprise', 'edu']);
const USAGE_FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOOL_ITEM_TYPES = new Set(['commandExecution', 'dynamicToolCall', 'fileChange', 'mcpToolCall', 'webSearch']);

const INSTRUCTIONS = Object.freeze({
  answer: [
    'Answer the user accurately from the supplied conversation history and current prompt.',
    'No tools are available. Preserve exact identifiers and stated facts. Keep the final answer focused.',
  ].join(' '),
  workspace: [
    'Complete the user request inside the supplied workspace.',
    'Inspect before editing, preserve unrelated user changes, batch independent local operations, and verify changes in proportion to risk.',
    'Do not use the network or access files outside the workspace. Keep the final answer focused and identify material limitations.',
  ].join(' '),
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function inputMessage(role, text) {
  return {
    type: 'message',
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
  };
}

function validateUsage(value) {
  if (!value || USAGE_FIELDS.some((field) => !Number.isInteger(value[field]) || value[field] < 0)) {
    fail('usage_telemetry_invalid', 'Codex did not return complete per-turn token telemetry');
  }
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, value[field]]));
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
    next(timeoutMs) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiters.push(waiter);
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          const error = new Error('Lean Codex turn timed out');
          error.code = 'turn_timeout';
          reject(error);
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
        waiter.reject(new Error('Lean Codex event stream closed'));
      }
    },
  };
}

function sessionsRoot(root = dataRoot()) {
  return path.join(root, 'lean-sessions');
}

export function leanSessionPath(name, root = dataRoot()) {
  if (!SESSION_NAME.test(name ?? '')) fail('invalid_session_name', 'Session names may contain letters, numbers, dot, dash, and underscore');
  return path.join(sessionsRoot(root), `${name}.json`);
}

async function readSession(name, root) {
  const file = leanSessionPath(name, root);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.messages)) fail('invalid_session_file', 'The lean session file is invalid');
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, name, createdAt: new Date().toISOString(), messages: [] };
    throw error;
  }
}

async function writeSession(session, root) {
  const directory = sessionsRoot(root);
  await mkdir(directory, { recursive: true });
  const target = leanSessionPath(session.name, root);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
  return target;
}

function validateAccount(result) {
  const account = result?.account;
  const planType = typeof account?.planType === 'string' ? account.planType.toLowerCase() : null;
  if (account?.type !== 'chatgpt') fail('chatgpt_auth_required', 'Lean mode requires Codex ChatGPT subscription authentication, not an API key');
  if (!planType || !ALLOWED_PLANS.has(planType)) fail('subscription_plan_ineligible', 'Lean mode requires ChatGPT Pro or an eligible higher-tier workspace plan');
  return planType;
}

async function compileHistory({ messages, model, vaultRoot }) {
  if (!messages.length) {
    return { items: [], report: { mode: 'empty', baselineTokens: 0, compiledTokens: 0, savedPercent: 0 } };
  }
  const runtime = await new ContextRuntime({ vaultRoot }).init();
  const compiler = new NativeContextCompiler({ runtime });
  const request = {
    model,
    instructions: INSTRUCTIONS.answer,
    input: messages.map((entry) => inputMessage(entry.role, entry.text)),
    tools: [],
  };
  const result = await compiler.compileRequest(request, {
    maxInputTokens: 6000,
    recentTokens: 3200,
    checkpointTokens: 1800,
    maxTools: 0,
    includeLocalTools: false,
    aggressive: false,
  });
  if (result.mode !== 'compiled') {
    return {
      items: request.input,
      report: {
        mode: 'passthrough',
        baselineTokens: result.report?.baselineTokens ?? 0,
        compiledTokens: result.report?.compiledTokens ?? result.report?.baselineTokens ?? 0,
        savedPercent: 0,
      },
    };
  }
  return { items: result.request.input, report: { mode: 'compiled', ...result.report } };
}

export async function runLeanSessionTurn({
  prompt,
  sessionName = 'default',
  initialMessages = [],
  cwd,
  model,
  effort,
  profile = 'workspace',
  dataDirectory = dataRoot(),
  timeoutMs = 180000,
  client = new CodexAppServerClient({ cwd, requestTimeoutMs: timeoutMs }),
  closeClient = true,
} = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) fail('prompt_required', 'Lean mode requires a non-empty prompt');
  if (!path.isAbsolute(cwd ?? '')) fail('absolute_cwd_required', 'Lean mode requires an absolute workspace path');
  if (!Object.hasOwn(INSTRUCTIONS, profile)) fail('invalid_profile', 'Lean profile must be answer or workspace');
  const session = await readSession(sessionName, dataDirectory);
  if (session.cwd && path.resolve(session.cwd).toLowerCase() !== path.resolve(cwd).toLowerCase()) {
    fail('session_workspace_mismatch', 'This session belongs to a different workspace');
  }
  if (!Array.isArray(initialMessages)) fail('invalid_initial_messages', 'Lean initialMessages must be an array');
  if (!session.messages.length && initialMessages.length) {
    session.messages = initialMessages.flatMap((message) => {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim()) return [];
      return [{ role: message.role, text: message.text.trim() }];
    });
  }
  const stream = createEventStream(client);
  let threadId;
  let turnId;
  try {
    await client.start();
    const planType = validateAccount(await client.readAccount());
    const start = await client.startThread({
      allowProviderModelFallback: false,
      approvalPolicy: 'never',
      baseInstructions: INSTRUCTIONS[profile],
      config: leanCodexConfig(profile),
      cwd,
      developerInstructions: null,
      dynamicTools: [],
      environments: [],
      ephemeral: true,
      ...(model ? { model } : {}),
      runtimeWorkspaceRoots: profile === 'workspace' ? [cwd] : [],
      sandbox: profile === 'workspace' ? 'workspace-write' : 'read-only',
      selectedCapabilityRoots: [],
    });
    threadId = start?.thread?.id;
    const selectedModel = start?.model;
    if (typeof threadId !== 'string' || !threadId) fail('thread_id_missing', 'Codex did not create a lean thread');
    if (typeof selectedModel !== 'string' || !selectedModel) fail('model_missing', 'Codex did not report the selected model');
    if (model && selectedModel !== model) fail('model_mismatch', 'Codex changed the requested model');
    const history = await compileHistory({
      messages: session.messages,
      model: selectedModel,
      vaultRoot: path.join(dataDirectory, 'vault'),
    });
    if (history.items.length) await client.injectItems({ threadId, items: structuredClone(history.items) });
    const turn = await client.startTurn({
      approvalPolicy: 'never',
      cwd,
      ...(effort ? { effort } : {}),
      environments: [],
      input: [{ type: 'text', text: prompt }],
      model: selectedModel,
      runtimeWorkspaceRoots: profile === 'workspace' ? [cwd] : [],
      sandboxPolicy: profile === 'workspace'
        ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false }
        : { type: 'readOnly', networkAccess: false },
      threadId,
    });
    turnId = turn?.turn?.id;
    if (typeof turnId !== 'string' || !turnId) fail('turn_id_missing', 'Codex did not create a lean turn');
    let answer;
    let completed;
    let usage;
    let toolCalls = 0;
    const deadline = Date.now() + timeoutMs;
    while (!completed || answer === undefined || !usage) {
      const event = await stream.next(Math.max(1, deadline - Date.now()));
      if (event.kind === 'serverRequest') fail('unexpected_server_request', `Lean mode rejected an unexpected Codex request: ${event.value?.method ?? 'unknown'}`);
      if (event.kind !== 'notification') continue;
      const message = event.value;
      if (message.params?.threadId !== threadId) continue;
      if (message.method === 'item/completed' && message.params?.turnId === turnId) {
        const item = message.params.item;
        if (item?.type === 'agentMessage' && (!item.phase || item.phase === 'final_answer')) answer = item.text;
        else if (TOOL_ITEM_TYPES.has(item?.type)) toolCalls += 1;
      } else if (message.method === 'thread/tokenUsage/updated' && message.params?.turnId === turnId) {
        usage = validateUsage(message.params.tokenUsage?.last);
      } else if (message.method === 'turn/completed' && message.params?.turn?.id === turnId) {
        completed = message.params.turn;
      }
    }
    if (completed.status !== 'completed') fail('turn_not_completed', `Lean turn ended with status ${completed.status}`);
    session.cwd = path.resolve(cwd);
    session.model = selectedModel;
    session.effort = effort ?? null;
    session.profile = profile;
    session.updatedAt = new Date().toISOString();
    session.messages.push({ role: 'user', text: prompt }, { role: 'assistant', text: answer });
    const sessionFile = await writeSession(session, dataDirectory);
    const result = {
      answer,
      session: sessionName,
      sessionFile,
      model: selectedModel,
      effort: effort ?? null,
      profile,
      planType,
      usage,
      toolCalls,
      history: history.report,
      modelCallsAddedByCompiler: 0,
      apiKeyUsed: false,
    };
    await recordLeanTurn(path.join(dataDirectory, 'lean-turn-metrics.jsonl'), result);
    return result;
  } catch (error) {
    if (threadId && turnId) {
      try { await client.interruptTurn({ threadId, turnId }); } catch {}
    }
    throw error;
  } finally {
    stream.close();
    if (threadId) {
      try { await client.unsubscribeThread(threadId); } catch {}
    }
    if (closeClient) client.close();
  }
}
