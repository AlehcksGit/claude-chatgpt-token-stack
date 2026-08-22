#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runBenchmark } from './benchmark.mjs';
import { CodexAppServerClient, checkCodexSubscription } from './codex-app-server.mjs';
import { compileResponsesRequest } from './compiler.mjs';
import { createLiveEvaluationFixture, prepareLiveEvaluation, runLiveAbEvaluation } from './live-eval.mjs';
import { NativeContextCompiler } from './native-context-compiler.mjs';
import { runNativeCompilerStdio } from './native-protocol.mjs';
import { ContextRuntime } from './runtime.mjs';
import { createLongAgentRequests } from './scenario.mjs';
import { leanCodexConfig } from './lean-config.mjs';
import { runLeanSessionTurn } from './lean-session.mjs';
import { EvidenceVault } from './vault.mjs';
import {
  dataRoot,
  bridgeMessagesPath,
  desktopBridgeRoot,
  hookHealthPath,
  hookMetricsPath,
  leanMetricsPath,
  settingsPath,
  wholeTurnEvalPath,
  vaultRoot as defaultVaultRoot,
} from './paths.mjs';
import { ensureSettings, readSettings, updateSettings } from './settings.mjs';
import { recordWholeTurnEvaluation } from './turn-telemetry.mjs';

const VERSION = '0.6.2';
const execFileAsync = promisify(execFile);

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}

function printBenchmark(result, output) {
  writeLine(output, 'Native Context Compiler offline benchmark');
  writeLine(output, `  Fixture: ${result.fixture}`);
  writeLine(output, `  Requests: ${result.turns}`);
  writeLine(output, `  Baseline tokens: ${Math.round(result.baselineTokens).toLocaleString()}`);
  writeLine(output, `  Compiled tokens: ${Math.round(result.compiledTokens).toLocaleString()}`);
  writeLine(output, `  Saved: ${result.savedPercent.toFixed(2)}%`);
  writeLine(output, `  Average/request: ${Math.round(result.averageBaselineTokens).toLocaleString()} -> ${Math.round(result.averageCompiledTokens).toLocaleString()}`);
  writeLine(output, `  Max compiled request: ${Math.round(result.maxCompiledTokens).toLocaleString()} / ${result.maxInputTokens.toLocaleString()}`);
  writeLine(output, `  Compacted tool outputs: ${result.compactedOutputs}`);
  writeLine(output, `  Evidence objects: ${result.uniqueEvidenceObjects}`);
  writeLine(output, '  Gates:');
  for (const [name, passed] of Object.entries(result.gates)) writeLine(output, `    ${passed ? 'PASS' : 'FAIL'} ${name}`);
  writeLine(output, '  Measured-session design envelope (projection, not a live result):');
  writeLine(output, `    Same 91 calls, raw tokens: ${result.projections.same91CallsRawSavedPercent.toFixed(2)}% saved`);
  writeLine(output, `    15 checkpoint calls, cache/output-weighted: ${result.projections.fifteenCheckpointTurnsEffectiveSavedPercent.toFixed(2)}% saved`);
}

function parseNativeCompilerOptions(args) {
  let stdio = false;
  let vaultRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--stdio') {
      stdio = true;
    } else if (arg === '--vault-root' && args[index + 1]) {
      vaultRoot = args[index + 1];
      index += 1;
    } else {
      return { error: `Unknown native-compiler option: ${arg}` };
    }
  }
  if (!stdio) return { error: 'native-compiler requires --stdio' };
  if (!vaultRoot) return { error: 'native-compiler requires an explicit --vault-root' };
  return { stdio, vaultRoot };
}

function parseLiveEvalOptions(args) {
  let model;
  let effort = 'low';
  let serviceTier;
  let maxUsedPercent = 80;
  let claudeIdle = false;
  let lean = false;
  let noiseTurns = 18;
  let noiseRepeat = 45;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model' && args[index + 1]) {
      model = args[++index];
    } else if (arg === '--effort' && args[index + 1]) {
      effort = args[++index];
    } else if (arg === '--service-tier' && args[index + 1]) {
      serviceTier = args[++index];
    } else if (arg === '--max-used-percent' && args[index + 1]) {
      maxUsedPercent = Number(args[++index]);
    } else if (arg === '--claude-idle') {
      claudeIdle = true;
    } else if (arg === '--lean') {
      lean = true;
    } else if (arg === '--noise-turns' && args[index + 1]) {
      noiseTurns = Number(args[++index]);
    } else if (arg === '--noise-repeat' && args[index + 1]) {
      noiseRepeat = Number(args[++index]);
    } else {
      return { error: `Unknown live-eval option: ${arg}` };
    }
  }
  if (!model) return { error: 'live-eval requires --model <model>' };
  if (!claudeIdle) return { error: 'live-eval requires --claude-idle' };
  if (!Number.isFinite(maxUsedPercent) || maxUsedPercent < 0 || maxUsedPercent > 100) {
    return { error: 'live-eval --max-used-percent must be between 0 and 100' };
  }
  if (!Number.isInteger(noiseTurns) || noiseTurns < 1 || noiseTurns > 100) {
    return { error: 'live-eval --noise-turns must be an integer from 1 to 100' };
  }
  if (!Number.isInteger(noiseRepeat) || noiseRepeat < 1 || noiseRepeat > 500) {
    return { error: 'live-eval --noise-repeat must be an integer from 1 to 500' };
  }
  return { model, effort, serviceTier, maxUsedPercent, lean, noiseTurns, noiseRepeat };
}

function parseEvidenceOptions(args) {
  let handle;
  let vaultRoot = defaultVaultRoot();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!handle && !arg.startsWith('--')) {
      handle = arg;
    } else if (arg === '--vault-root' && args[index + 1]) {
      vaultRoot = args[++index];
    } else {
      return { error: `Unknown evidence-get option: ${arg}` };
    }
  }
  if (!handle) return { error: 'evidence-get requires an ev:sha256 handle' };
  return { handle, vaultRoot };
}

function parseEvidenceSliceOptions(args) {
  let handle;
  let startLine = 1;
  let lines = 80;
  let vaultRoot = defaultVaultRoot();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!handle && !arg.startsWith('--')) handle = arg;
    else if (arg === '--start-line' && args[index + 1]) startLine = Number(args[++index]);
    else if (arg === '--lines' && args[index + 1]) lines = Number(args[++index]);
    else if (arg === '--vault-root' && args[index + 1]) vaultRoot = args[++index];
    else return { error: `Unknown evidence-slice option: ${arg}` };
  }
  if (!handle) return { error: 'evidence-slice requires an ev:sha256 handle' };
  if (!Number.isInteger(startLine) || startLine < 1) return { error: '--start-line must be a positive integer' };
  if (!Number.isInteger(lines) || lines < 1 || lines > 500) return { error: '--lines must be an integer from 1 to 500' };
  return { handle, startLine, lines, vaultRoot };
}

function parseEvidenceFindOptions(args) {
  let handle;
  let pattern;
  let max = 20;
  let context = 1;
  let vaultRoot = defaultVaultRoot();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!handle && !arg.startsWith('--')) handle = arg;
    else if (!pattern && !arg.startsWith('--')) pattern = arg;
    else if (arg === '--max' && args[index + 1]) max = Number(args[++index]);
    else if (arg === '--context' && args[index + 1]) context = Number(args[++index]);
    else if (arg === '--vault-root' && args[index + 1]) vaultRoot = args[++index];
    else return { error: `Unknown evidence-find option: ${arg}` };
  }
  if (!handle || !pattern) return { error: 'evidence-find requires an ev:sha256 handle and a quoted pattern' };
  if (!Number.isInteger(max) || max < 1 || max > 100) return { error: '--max must be an integer from 1 to 100' };
  if (!Number.isInteger(context) || context < 0 || context > 10) return { error: '--context must be an integer from 0 to 10' };
  return { handle, pattern, max, context, vaultRoot };
}

function parseLeanOptions(args) {
  let prompt;
  let promptFile;
  let cwd = process.cwd();
  let session;
  let model;
  let effort;
  let profile = 'workspace';
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--prompt' && args[index + 1]) prompt = args[++index];
    else if (arg === '--prompt-file' && args[index + 1]) promptFile = args[++index];
    else if (arg === '--cwd' && args[index + 1]) cwd = path.resolve(args[++index]);
    else if (arg === '--session' && args[index + 1]) session = args[++index];
    else if (arg === '--model' && args[index + 1]) model = args[++index];
    else if (arg === '--effort' && args[index + 1]) effort = args[++index];
    else if (arg === '--read-only') profile = 'answer';
    else if (arg === '--json') json = true;
    else return { error: `Unknown lean option: ${arg}` };
  }
  if (prompt && promptFile) return { error: 'lean accepts either --prompt or --prompt-file, not both' };
  if (!prompt && !promptFile) return { error: 'lean requires --prompt <text> or --prompt-file <path>' };
  const defaultSession = `workspace-${createHash('sha256').update(cwd.toLowerCase()).digest('hex').slice(0, 12)}`;
  return { prompt, promptFile, cwd, session: session ?? defaultSession, model, effort, profile, json };
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function hasHookCommand(value) {
  if (typeof value === 'string') return value.includes('codex-hook.mjs');
  if (Array.isArray(value)) return value.some(hasHookCommand);
  return value && typeof value === 'object' && Object.values(value).some(hasHookCommand);
}

function pathExists(file) {
  try { realpathSync(file); return true; } catch { return false; }
}

async function userCodexCliPath() {
  if (process.platform !== 'win32') return null;
  try {
    const result = await execFileAsync('reg.exe', ['query', 'HKCU\\Environment', '/v', 'CODEX_CLI_PATH'], { windowsHide: true, shell: false });
    const match = result.stdout.match(/^\s*CODEX_CLI_PATH\s+REG_[A-Z_]+\s+(.*)$/mi);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

async function statusReport() {
  const liveWindowMs = 15 * 60 * 1000;
  const isProbe = (value) => value?.probe === true || /^ncc-/i.test(String(value?.sessionId ?? ''));
  const isLive = (value) => {
    if (!value || isProbe(value)) return false;
    const ms = Date.parse(value.lastInvocationAt ?? '');
    return Number.isFinite(ms) && Date.now() >= ms && Date.now() - ms <= liveWindowMs;
  };
  const home = process.env.USERPROFILE ?? os.homedir();
  const hookFile = path.join(home, '.codex', 'hooks.json');
  const configFile = path.join(home, '.codex', 'config.toml');
  const hookText = await readOptional(hookFile);
  const configText = await readOptional(configFile);
  const leanMetricsText = await readOptional(leanMetricsPath());
  const wholeTurnText = await readOptional(wholeTurnEvalPath());
  const hookMetricsText = await readOptional(hookMetricsPath());
  const preHealthText = await readOptional(hookHealthPath('pretooluse'));
  const postHealthText = await readOptional(hookHealthPath('posttooluse'));
  const sessionStartHealthText = await readOptional(hookHealthPath('sessionstart'));
  const promptHealthText = await readOptional(hookHealthPath('userpromptsubmit'));
  const bridgeReceiptText = await readOptional(path.join(desktopBridgeRoot(), 'desktop-bridge.json'));
  const bridgeMessagesText = await readOptional(bridgeMessagesPath());
  const leanMetrics = (leanMetricsText ?? '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((row) => row.kind === 'lean_turn');
  const wholeTurnMetrics = (wholeTurnText ?? '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((row) => row.kind === 'whole_turn_ab');
  const hookMetrics = (hookMetricsText ?? '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((row) => !isProbe(row));
  const postMetrics = hookMetrics.filter((row) => row.kind === 'post_tool_compaction');
  const rtkMetrics = hookMetrics.filter((row) => row.kind === 'rtk_rewrite');
  const budgetMetrics = hookMetrics.filter((row) => row.kind === 'turn_budget_context');
  const bridgeMetrics = hookMetrics.filter((row) => row.kind === 'lean_bridge_turn');
  const parseObject = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const preHealth = parseObject(preHealthText);
  const postHealth = parseObject(postHealthText);
  const sessionStartHealth = parseObject(sessionStartHealthText);
  const promptHealth = parseObject(promptHealthText);
  const liveEvents = {
    preToolUse: isLive(preHealth),
    postToolUse: isLive(postHealth),
    sessionStart: isLive(sessionStartHealth),
    userPromptSubmit: isLive(promptHealth),
  };
  const bridgeReceipt = parseObject(bridgeReceiptText) ?? {};
  const configuredCodexCliPath = await userCodexCliPath();
  const bridgeLauncher = typeof bridgeReceipt.launcher === 'string' ? bridgeReceipt.launcher : null;
  const bridgeConfigured = Boolean(bridgeLauncher && configuredCodexCliPath && path.resolve(bridgeLauncher).toLowerCase() === path.resolve(configuredCodexCliPath).toLowerCase());
  const activeBridgeMessages = new Set();
  for (const line of (bridgeMessagesText ?? '').split(/\r?\n/).filter(Boolean)) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.op === 'upsert' && row.threadId && row.turnId) activeBridgeMessages.add(`${row.threadId}\0${row.turnId}`);
    else if (row.op === 'delete_thread' && row.threadId) {
      for (const key of activeBridgeMessages) if (key.startsWith(`${row.threadId}\0`)) activeBridgeMessages.delete(key);
    }
  }
  let hookDocument = null;
  try { hookDocument = hookText ? JSON.parse(hookText) : null; } catch {}
  return {
    product: 'native-context-compiler',
    version: VERSION,
    dataRoot: dataRoot(),
    vaultRoot: defaultVaultRoot(),
    integration: {
      mode: 'native-hook-stack',
      ordinaryCodexTasks: 'native OpenAI path with no nested whole-turn model call',
      nativeHooksConfigured: hookDocument ? hasHookCommand(hookDocument) : false,
      postToolUseReplacementSupported: true,
      modelCallsAddedByCompiler: 0,
      liveWindowMinutes: liveWindowMs / 60000,
    },
    desktopBridge: {
      installed: Boolean(bridgeLauncher && pathExists(bridgeLauncher)),
      configured: bridgeConfigured,
      sourceOnlyBuild: bridgeReceipt.sourceOnlyBuild === true,
      codexVersion: bridgeReceipt.codexVersion ?? null,
      persistedReplies: activeBridgeMessages.size,
      appRestartRequiredAfterInstall: false,
      compatibility: bridgeConfigured ? 'legacy-experimental-app-server-layer' : 'disabled',
    },
    settings: {
      path: settingsPath(),
      value: await readSettings(),
    },
    hooks: {
      trustOwnedByCodex: true,
      preToolUse: {
        observed: Boolean(preHealth?.lastInvocationAt),
        liveObserved: liveEvents.preToolUse,
        probe: isProbe(preHealth),
        lastInvocationAt: preHealth?.lastInvocationAt ?? null,
        lastRewriteAt: [...rtkMetrics].reverse().find((row) => row.at)?.at ?? null,
        rewrites: rtkMetrics.length,
      },
      postToolUse: {
        observed: Boolean(postHealth?.lastInvocationAt),
        liveObserved: liveEvents.postToolUse,
        probe: isProbe(postHealth),
        lastInvocationAt: postHealth?.lastInvocationAt ?? null,
        compacted: postMetrics.length,
        rawTokens: postMetrics.reduce((sum, row) => sum + (Number(row.rawTokens) || 0), 0),
        compactTokens: postMetrics.reduce((sum, row) => sum + (Number(row.compactTokens) || 0), 0),
        savedTokens: postMetrics.reduce((sum, row) => sum + (Number(row.savedTokens) || 0), 0),
      },
      sessionStart: {
        observed: Boolean(sessionStartHealth?.lastInvocationAt),
        liveObserved: liveEvents.sessionStart,
        probe: isProbe(sessionStartHealth),
        lastInvocationAt: sessionStartHealth?.lastInvocationAt ?? null,
        lastSource: sessionStartHealth?.source ?? null,
      },
      userPromptSubmit: {
        observed: Boolean(promptHealth?.lastInvocationAt),
        liveObserved: liveEvents.userPromptSubmit,
        probe: isProbe(promptHealth),
        lastInvocationAt: promptHealth?.lastInvocationAt ?? null,
        lastResult: promptHealth?.result ?? null,
        lastEffort: promptHealth?.effort ?? null,
      },
    },
    runtime: {
      recentlyObserved: Object.values(liveEvents).filter(Boolean).length,
      expectedEvents: 4,
      events: liveEvents,
    },
    turnBudget: {
      enabled: Boolean((await readSettings()).turnBudget?.enabled),
      contextsApplied: budgetMetrics.length,
      lastInvocationAt: budgetMetrics.at(-1)?.at ?? null,
      lastDetailed: budgetMetrics.at(-1)?.detailed ?? null,
    },
    leanBridge: {
      enabled: Boolean((await readSettings()).leanBridge?.enabled),
      turns: bridgeMetrics.length,
      lastInvocationAt: bridgeMetrics.at(-1)?.at ?? null,
      lastTotalTokens: bridgeMetrics.at(-1)?.totalTokens ?? null,
      lastSeededMessages: bridgeMetrics.at(-1)?.seededMessages ?? null,
      lastEffort: bridgeMetrics.at(-1)?.effort ?? null,
      outerModelTokens: bridgeMetrics.reduce((sum, row) => sum + (Number(row.outerModelTokens) || 0), 0),
      nativeEscapePrefix: (await readSettings()).leanBridge?.nativePrefix ?? '!native',
    },
    lean: {
      command: 'ncc lean',
      turns: leanMetrics.length,
      lastInvocationAt: leanMetrics.at(-1)?.at ?? null,
      lastProfile: leanMetrics.at(-1)?.profile ?? null,
      lastTotalTokens: leanMetrics.at(-1)?.totalTokens ?? null,
      lastHistorySavedPercent: leanMetrics.at(-1)?.historySavedPercent ?? null,
    },
    wholeTurnEvaluation: {
      runs: wholeTurnMetrics.length,
      latestAt: wholeTurnMetrics.at(-1)?.at ?? null,
      latestQualityExact: wholeTurnMetrics.at(-1)?.qualityExact ?? null,
      latestTotalSavedPercent: wholeTurnMetrics.at(-1)?.totalSavedPercent ?? null,
      latestBaselineTotalTokens: wholeTurnMetrics.at(-1)?.baselineTotalTokens ?? null,
      latestOptimizedTotalTokens: wholeTurnMetrics.at(-1)?.optimizedTotalTokens ?? null,
    },
    nativeProvider: {
      legacyPxpipeConfigured: /model_provider\s*=\s*["']pxpipe["']/.test(configText ?? ''),
    },
  };
}

export async function main(argv = process.argv.slice(2), io = process) {
  const command = argv[0] ?? 'benchmark';
  if (command === '--version' || command === 'version') {
    writeLine(io.stdout, `native-context-compiler ${VERSION}`);
    return 0;
  }
  if (command === 'evidence-get') {
    const options = parseEvidenceOptions(argv.slice(1));
    if (options.error) {
      writeLine(io.stderr, options.error);
      return 2;
    }
    const vault = await new EvidenceVault(options.vaultRoot).init();
    io.stdout.write(await vault.get(options.handle));
    return 0;
  }
  if (command === 'evidence-slice') {
    const options = parseEvidenceSliceOptions(argv.slice(1));
    if (options.error) { writeLine(io.stderr, options.error); return 2; }
    const vault = await new EvidenceVault(options.vaultRoot).init();
    writeLine(io.stdout, await vault.slice(options.handle, options));
    return 0;
  }
  if (command === 'evidence-find') {
    const options = parseEvidenceFindOptions(argv.slice(1));
    if (options.error) { writeLine(io.stderr, options.error); return 2; }
    const vault = await new EvidenceVault(options.vaultRoot).init();
    writeLine(io.stdout, await vault.find(options.handle, options.pattern, options));
    return 0;
  }
  if (command === 'evidence-meta') {
    const options = parseEvidenceOptions(argv.slice(1));
    if (options.error) { writeLine(io.stderr, options.error.replaceAll('evidence-get', 'evidence-meta')); return 2; }
    const vault = await new EvidenceVault(options.vaultRoot).init();
    writeLine(io.stdout, JSON.stringify(await vault.metadata(options.handle), null, 2));
    return 0;
  }
  if (command === 'settings') {
    await ensureSettings();
    writeLine(io.stdout, JSON.stringify({ path: settingsPath(), settings: await readSettings() }, null, 2));
    return 0;
  }
  if (command === 'bridge') {
    const action = argv[1] ?? 'status';
    if (!['on', 'off', 'status'].includes(action)) {
      writeLine(io.stderr, 'bridge accepts on, off, or status');
      return 2;
    }
    if (action !== 'status') {
      await updateSettings((current) => ({
        ...current,
        leanBridge: { ...current.leanBridge, enabled: action === 'on' },
      }));
    }
    const value = await readSettings();
    writeLine(io.stdout, JSON.stringify({
      enabled: Boolean(value.leanBridge.enabled),
      profile: value.leanBridge.profile,
      nativeEscapePrefix: value.leanBridge.nativePrefix,
    }, null, 2));
    return 0;
  }
  if (command === 'budget') {
    const action = argv[1] ?? 'status';
    if (!['on', 'off', 'status'].includes(action)) {
      writeLine(io.stderr, 'budget accepts on, off, or status');
      return 2;
    }
    if (action !== 'status') {
      await updateSettings((current) => ({
        ...current,
        turnBudget: { ...current.turnBudget, enabled: action === 'on' },
      }));
    }
    const value = await readSettings();
    writeLine(io.stdout, JSON.stringify({
      enabled: Boolean(value.turnBudget.enabled),
      routineMaxWords: value.turnBudget.routineMaxWords,
      progressMaxWords: value.turnBudget.progressMaxWords,
    }, null, 2));
    return 0;
  }
  if (command === 'status') {
    writeLine(io.stdout, JSON.stringify(await statusReport(), null, 2));
    return 0;
  }
  if (command === 'benchmark') {
    const result = await runBenchmark();
    printBenchmark(result, io.stdout);
    return Object.values(result.gates).every(Boolean) ? 0 : 1;
  }
  if (command === 'demo') {
    const root = await mkdtemp(path.join(os.tmpdir(), 'context-compiler-demo-'));
    try {
      const vault = await new EvidenceVault(path.join(root, 'vault')).init();
      const request = createLongAgentRequests(8).at(-1);
      const compiled = await compileResponsesRequest(request, { vault, aggressive: true });
      writeLine(io.stdout, JSON.stringify(compiled.report, null, 2));
      return 0;
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
  if (command === 'subscription-check') {
    const result = await checkCodexSubscription({ clientOptions: { cwd: process.cwd() } });
    writeLine(io.stdout, JSON.stringify(result));
    return result.eligible ? 0 : 3;
  }
  if (command === 'lean') {
    const options = parseLeanOptions(argv.slice(1));
    if (options.error) {
      writeLine(io.stderr, options.error);
      return 2;
    }
    try {
      const prompt = options.prompt ?? await readFile(path.resolve(options.promptFile), 'utf8');
      const result = await runLeanSessionTurn({
        prompt,
        sessionName: options.session,
        cwd: options.cwd,
        model: options.model,
        effort: options.effort,
        profile: options.profile,
      });
      if (options.json) writeLine(io.stdout, JSON.stringify(result));
      else {
        writeLine(io.stdout, result.answer);
        writeLine(io.stdout, `\n[lean session ${result.session} · ${result.usage.totalTokens.toLocaleString()} total tokens · ${result.history.mode} history]`);
      }
      return 0;
    } catch (error) {
      writeLine(io.stderr, JSON.stringify({
        error: {
          code: error?.code ?? 'lean_turn_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
      return 4;
    }
  }
  if (command === 'live-eval-prepare') {
    const root = await mkdtemp(path.join(os.tmpdir(), 'context-live-eval-'));
    try {
      const prepared = await prepareLiveEvaluation({
        vaultRoot: path.join(root, 'vault'),
        model: 'fixture-model',
      });
      writeLine(io.stdout, JSON.stringify({
        mode: 'local_only',
        liveTurnsMade: 0,
        baselineItems: prepared.baselineItems.length,
        optimizedItems: prepared.optimizedItems.length,
        report: prepared.localReport,
        liveBlockedReasons: [
          'claude_idle_confirmation_required',
        ],
      }));
      return 0;
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
  if (command === 'live-eval') {
    const options = parseLiveEvalOptions(argv.slice(1));
    if (options.error) {
      writeLine(io.stderr, options.error);
      return 2;
    }
    const root = await mkdtemp(path.join(os.tmpdir(), 'native-live-eval-'));
    const client = new CodexAppServerClient({ cwd: root, requestTimeoutMs: 120000 });
    try {
      const prepared = await prepareLiveEvaluation({
        vaultRoot: path.join(root, 'vault'),
        model: options.model,
        fixture: createLiveEvaluationFixture({
          noiseTurns: options.noiseTurns,
          noiseRepeat: options.noiseRepeat,
        }),
      });
      const result = await runLiveAbEvaluation({
        client,
        prepared,
        cwd: root,
        effort: options.effort,
        serviceTier: options.serviceTier,
        maxUsedPercent: options.maxUsedPercent,
        optimizedThreadConfig: options.lean ? leanCodexConfig('answer') : undefined,
        live: true,
        claudeIdleConfirmed: true,
      });
      await recordWholeTurnEvaluation(wholeTurnEvalPath(), result, {
        profile: options.lean ? 'lean' : 'standard',
      });
      writeLine(io.stdout, JSON.stringify(result));
      return 0;
    } catch (error) {
      writeLine(io.stderr, JSON.stringify({
        error: {
          code: error?.code ?? 'live_eval_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
      return 4;
    } finally {
      client.close();
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
  if (command === 'native-compiler') {
    const options = parseNativeCompilerOptions(argv.slice(1));
    if (options.error) {
      writeLine(io.stderr, options.error);
      return 2;
    }
    const runtime = await new ContextRuntime({ vaultRoot: options.vaultRoot }).init();
    const compiler = new NativeContextCompiler({ runtime });
    await runNativeCompilerStdio({ compiler, input: io.stdin, output: io.stdout });
    return 0;
  }
  writeLine(io.stderr, `Unknown command: ${command}`);
  return 2;
}

function isEntrypoint(metaUrl, argvPath) {
  if (!argvPath) return false;
  const modulePath = fileURLToPath(metaUrl);
  const entryPath = path.resolve(argvPath);
  if (modulePath === entryPath) return true;
  try {
    return realpathSync(modulePath).toLowerCase() === realpathSync(entryPath).toLowerCase();
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url, process.argv[1])) process.exitCode = await main();
