import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_ALLOWED_PLANS = Object.freeze(['pro', 'business', 'enterprise', 'edu']);
const SAFE_ENV_KEYS = new Set([
  'APPDATA', 'CODEX_HOME', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'LANG', 'LC_ALL', 'LOCALAPPDATA', 'NO_COLOR', 'OS', 'PATH', 'PATHEXT',
  'PROCESSOR_ARCHITECTURE', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TERM',
  'TMP', 'TMPDIR', 'USERNAME', 'USERPROFILE', 'WINDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
].map((key) => key.toUpperCase()));

export function sanitizedCodexEnvironment(source = process.env) {
  const sanitized = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!SAFE_ENV_KEYS.has(key.toUpperCase()) || typeof value !== 'string') continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function defaultCodexLaunch() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const script = path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (existsSync(script)) return { command: process.execPath, prefixArgs: [script] };
    return { command: 'codex.exe', prefixArgs: [] };
  }
  return { command: 'codex', prefixArgs: [] };
}

export class CodexAppServerClient {
  constructor({
    command,
    args,
    cwd,
    env = process.env,
    spawnImpl = spawn,
    requestTimeoutMs = 10000,
  } = {}) {
    const launch = command ? { command, prefixArgs: [] } : defaultCodexLaunch();
    this.command = launch.command;
    this.args = [...launch.prefixArgs, ...(args ?? ['app-server', '--stdio'])];
    this.cwd = cwd;
    this.env = sanitizedCodexEnvironment(env);
    this.spawn = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.events = [];
    this.eventSequence = 0;
    this.child = null;
    this.lines = null;
  }

  async start() {
    if (this.child) return;
    this.child = this.spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.handleLine(line));
    this.child.on('error', (error) => {
      this.emitEvent('processError', { error });
      this.rejectPending(error);
    });
    this.child.on('exit', (code) => {
      this.emitEvent('processExit', { code });
      if (this.pending.size) this.rejectPending(new Error(`Codex app-server exited with code ${code}`));
    });
    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'native_context_compiler',
          title: 'Native Context Compiler',
          version: '0.6.2',
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      this.notify('initialized', {});
    } catch (error) {
      this.close();
      throw error;
    }
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch {
      this.emitEvent('protocolError', { code: 'invalid_json' });
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) {
        this.emitEvent('serverRequest', message);
        try {
          this.send({
            id: message.id,
            error: { code: -32601, message: 'Client-side server requests are disabled' },
          });
        } catch {}
      } else {
        this.emitEvent('notification', message);
      }
      return;
    }
    if (!Object.hasOwn(message, 'id')) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
    } else {
      pending.resolve(message.result);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  emitEvent(kind, value) {
    const event = { sequence: ++this.eventSequence, kind, value };
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    for (const listener of this.eventListeners) {
      try { listener(event); } catch {}
    }
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  eventCursor() {
    return this.eventSequence;
  }

  waitForEvent({ after = 0, predicate = () => true, timeoutMs = this.requestTimeoutMs } = {}) {
    const existing = this.events.find((event) => event.sequence > after && predicate(event));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let timer;
      const dispose = this.onEvent((event) => {
        if (event.sequence <= after || !predicate(event)) return;
        clearTimeout(timer);
        dispose();
        resolve(event);
      });
      timer = setTimeout(() => {
        dispose();
        reject(new Error('Codex app-server event wait timed out'));
      }, timeoutMs);
    });
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server stdin is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send({ method, params });
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async readAccount() {
    await this.start();
    return this.request('account/read', { refreshToken: false });
  }

  async readRateLimits() {
    await this.start();
    return this.request('account/rateLimits/read', {});
  }

  async startThread(params) {
    await this.start();
    return this.request('thread/start', params);
  }

  injectItems(params) {
    return this.request('thread/inject_items', params);
  }

  startTurn(params) {
    return this.request('turn/start', params);
  }

  interruptTurn(params) {
    return this.request('turn/interrupt', params);
  }

  unsubscribeThread(threadId) {
    return this.request('thread/unsubscribe', { threadId });
  }

  close() {
    if (!this.child) return;
    this.rejectPending(new Error('Codex app-server client closed'));
    this.lines?.close();
    try { this.child.stdin.end(); } catch {}
    try { this.child.kill(); } catch {}
    this.child = null;
    this.lines = null;
    this.eventListeners.clear();
  }
}

export async function checkCodexSubscription({
  allowedPlanTypes = DEFAULT_ALLOWED_PLANS,
  clientOptions = {},
} = {}) {
  const client = new CodexAppServerClient(clientOptions);
  try {
    const result = await client.readAccount();
    const account = result?.account ?? null;
    const authType = typeof account?.type === 'string' ? account.type : null;
    const planType = typeof account?.planType === 'string' ? account.planType.toLowerCase() : null;
    const allowed = new Set(allowedPlanTypes.map((value) => String(value).toLowerCase()));
    let reason = 'eligible';
    if (authType !== 'chatgpt') reason = authType === 'apiKey' ? 'usage_billed_api_auth_forbidden' : 'chatgpt_auth_required';
    else if (!planType) reason = 'subscription_plan_unverified';
    else if (!allowed.has(planType)) reason = 'pro_or_eligible_workspace_subscription_required';
    return {
      eligible: reason === 'eligible',
      authType,
      planType,
      reason,
      platformApiBillingAllowed: false,
      paidCreditsAllowed: false,
      modelCallsMade: 0,
    };
  } finally {
    client.close();
  }
}
