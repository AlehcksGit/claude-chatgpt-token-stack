#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  BridgeMessageStore,
  createBridgeRecord,
  feedbackText,
  isLeanBridgeRun,
  patchHistoryResponse,
  syntheticBridgeMessages,
} from './app-server-proxy-protocol.mjs';
import { writeBridgeTurnContext } from './bridge-context.mjs';

function idKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function send(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}

function selectedPrompt(params) {
  const input = Array.isArray(params?.input) ? params.input : [];
  const text = input
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
  const unsupported = input.some((item) => item?.type !== 'text');
  return {
    prompt: text,
    bypass: unsupported || !text.trim(),
    bypassReason: unsupported ? 'non_text_input' : (!text.trim() ? 'empty_text_input' : null),
  };
}

async function realCodexLaunch(args, env = process.env) {
  if (env.NCC_REAL_CODEX_CLI) {
    const command = path.resolve(env.NCC_REAL_CODEX_CLI);
    await access(command);
    return { command, args };
  }
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [
    path.join(sourceRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    env.APPDATA && path.join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ].filter(Boolean);
  for (const script of candidates) {
    try {
      await access(script);
      return { command: process.execPath, args: [script, ...args] };
    } catch {}
  }
  throw new Error('A compatible Codex CLI was not found. Re-run the Native Context Compiler installer.');
}

function bridgeCapable(args) {
  return args.includes('app-server');
}

export async function runDesktopBridge({
  args = process.argv.slice(2),
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  env = process.env,
  spawnImpl = spawn,
  store = new BridgeMessageStore(),
  writeContext = writeBridgeTurnContext,
} = {}) {
  const launch = await realCodexLaunch(args, env);
  const childEnv = { ...env };
  delete childEnv.CODEX_CLI_PATH;
  const child = spawnImpl(launch.command, launch.args, {
    env: childEnv,
    stdio: bridgeCapable(args) ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    shell: false,
  });
  if (!bridgeCapable(args)) {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  }

  await store.load();
  child.stderr.pipe(errorOutput, { end: false });
  const clientRequests = new Map();
  const internalRequests = new Map();
  const pendingBridge = new Map();
  const pendingHookStarted = new Map();
  const threadSessions = new Map();
  let internalSequence = 0;

  const finalizeBridge = async ({ record, turnCompleted }) => {
    await store.remember(record);
    for (const message of syntheticBridgeMessages(record, turnCompleted)) send(output, message);
  };

  const beginInjection = (record, turnCompleted) => {
    const id = `ncc-internal-${process.pid}-${++internalSequence}`;
    const timer = setTimeout(() => {
      const pending = internalRequests.get(idKey(id));
      if (!pending) return;
      internalRequests.delete(idKey(id));
      finalizeBridge(pending).catch((error) => errorOutput.write(`NCC bridge persistence warning: ${error.message}\n`));
    }, 5000);
    internalRequests.set(idKey(id), { record, turnCompleted, timer });
    send(child.stdin, {
      method: 'thread/inject_items',
      id,
      params: {
        threadId: record.threadId,
        items: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: record.text }],
        }],
      },
    });
  };

  let clientQueue = Promise.resolve();
  const clientLines = readline.createInterface({ input, crlfDelay: Infinity });
  clientLines.on('line', (line) => {
    clientQueue = clientQueue.then(async () => {
      let message;
      try { message = JSON.parse(line); }
      catch { child.stdin.write(`${line}\n`); return; }
      if (Object.hasOwn(message, 'id') && typeof message.method === 'string') {
        clientRequests.set(idKey(message.id), { method: message.method, params: message.params ?? {} });
      }
      if (message.method === 'turn/start') {
        const params = message.params ?? {};
        const selected = selectedPrompt(params);
        await writeContext({
          threadId: params.threadId,
          sessionId: threadSessions.get(params.threadId) ?? params.threadId,
          prompt: selected.prompt,
          model: params.model,
          effort: params.effort,
          bypass: selected.bypass,
          bypassReason: selected.bypassReason,
        });
      }
      send(child.stdin, message);
    }).catch((error) => errorOutput.write(`NCC bridge input warning: ${error.message}\n`));
  });
  clientLines.on('close', () => child.stdin.end());

  let serverQueue = Promise.resolve();
  const serverLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  serverLines.on('line', (line) => {
    serverQueue = serverQueue.then(async () => {
      let message;
      try { message = JSON.parse(line); }
      catch { output.write(`${line}\n`); return; }

      if (Object.hasOwn(message, 'id') && !message.method) {
        const internal = internalRequests.get(idKey(message.id));
        if (internal) {
          internalRequests.delete(idKey(message.id));
          clearTimeout(internal.timer);
          await finalizeBridge(internal);
          return;
        }
        const request = clientRequests.get(idKey(message.id));
        if (request) clientRequests.delete(idKey(message.id));
        if (request && !message.error) {
          const thread = message.result?.thread;
          if (thread?.id) threadSessions.set(thread.id, thread.sessionId ?? thread.id);
          if (request.method === 'thread/delete' && request.params?.threadId) {
            await store.forgetThread(request.params.threadId);
          } else if (request.method === 'thread/fork' && request.params?.threadId && thread?.id) {
            await store.cloneThread(request.params.threadId, thread.id, request.params.lastTurnId ?? null);
          }
          const threadId = request.params?.threadId ?? thread?.id;
          if (threadId) message = patchHistoryResponse(message, request, store.forThread(threadId));
        }
        send(output, message);
        return;
      }

      if (message.method === 'hook/started' && isLeanBridgeRun(message.params?.run)) {
        pendingHookStarted.set(message.params.run.id, message);
        return;
      }
      if (message.method === 'hook/completed' && isLeanBridgeRun(message.params?.run)) {
        const run = message.params.run;
        const text = run.status === 'blocked' ? feedbackText(run) : null;
        const started = pendingHookStarted.get(run.id);
        pendingHookStarted.delete(run.id);
        if (text && message.params?.turnId) {
          pendingBridge.set(message.params.turnId, {
            threadId: message.params.threadId,
            turnId: message.params.turnId,
            text,
            completedAtMs: message.emittedAtMs ?? Date.now(),
          });
          return;
        }
        if (started) send(output, started);
        send(output, message);
        return;
      }
      if (message.method === 'turn/completed') {
        const turnId = message.params?.turn?.id;
        const bridge = pendingBridge.get(turnId);
        if (bridge) {
          pendingBridge.delete(turnId);
          beginInjection(createBridgeRecord(bridge), message);
          return;
        }
      }
      send(output, message);
    }).catch((error) => errorOutput.write(`NCC bridge output warning: ${error.message}\n`));
  });

  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      for (const pending of internalRequests.values()) clearTimeout(pending.timer);
      resolve(code ?? 1);
    });
  });
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  try { process.exitCode = await runDesktopBridge(); }
  catch (error) {
    process.stderr.write(`Native Context Compiler desktop bridge failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
