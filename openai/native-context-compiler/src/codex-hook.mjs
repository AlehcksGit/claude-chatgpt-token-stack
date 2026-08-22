#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { compactToolOutput } from './filters.mjs';
import { consumeBridgeTurnContext } from './bridge-context.mjs';
import { runLeanSessionTurn } from './lean-session.mjs';
import { EvidenceVault } from './vault.mjs';
import { hookErrorPath, hookHealthPath, hookMetricsPath, vaultRoot } from './paths.mjs';
import { readSettings } from './settings.mjs';
import { readConversationTranscript } from './transcript.mjs';

const execFileAsync = promisify(execFile);
const BOUNDED_EVIDENCE = /\bncc(?:\.cmd)?\s+evidence-(?:find|slice|meta)\b/i;
const ALREADY_RTK = /^\s*(?:rtk(?:\.exe)?)(?:\s|$)/i;
const EXPLICIT_DETAIL = /\b(?:deep[ -]?dive|detailed|thorough|exhaustive|comprehensive|step[ -]?by[ -]?step|full (?:analysis|explanation|report)|do not abbreviate|don't abbreviate)\b/i;

function numericSetting(value, fallback, { min, max }) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function canonicalJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function toolResponseView(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value?.output === 'string') return value.output;
  if (typeof value?.text === 'string') return value.text;
  if (Array.isArray(value?.content)) {
    const text = value.content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
    if (text) return text;
  }
  return canonicalJson(value);
}

function evidenceFor(value) {
  return typeof value === 'string'
    ? { text: value, format: 'text' }
    : { text: canonicalJson(value), format: 'canonical-json' };
}

function commandFor(input) {
  const command = input?.tool_input?.command;
  return typeof command === 'string' && command.trim() ? command : String(input?.tool_name ?? '<unknown-tool>');
}

function exitCodeFor(response) {
  for (const value of [response?.exit_code, response?.exitCode, response?.code]) {
    if (Number.isInteger(value)) return value;
  }
  return undefined;
}

function fingerprint(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

function commandFamily(command) {
  const match = /^\s*([^\s;&|]+)/.exec(String(command));
  return match ? path.basename(match[1]).toLowerCase() : '<unknown>';
}

function isProbeInvocation(input) {
  return String(input?.session_id ?? '').startsWith('ncc-');
}

async function appendJsonLine(file, record) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

async function writeHealth(event, record, file = hookHealthPath(event)) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } catch {}
}

async function rewriteWithRtk(command, settings, run = execFileAsync) {
  if (ALREADY_RTK.test(command) || BOUNDED_EVIDENCE.test(command)) return null;
  const args = ['rewrite'];
  if (settings.ultraCompact) args.push('--ultra-compact');
  args.push(command);
  try {
    const result = await run(settings.rtkCommand || 'rtk', args, {
      windowsHide: true,
      shell: false,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const rewritten = String(result.stdout ?? '').trim();
    return rewritten && rewritten !== command.trim() ? rewritten : null;
  } catch (error) {
    const rewritten = String(error?.stdout ?? '').trim();
    return rewritten && rewritten !== command.trim() ? rewritten : null;
  }
}

export async function processPreToolUse(input, options = {}) {
  if (!input || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return null;
  const settings = options.settings ?? await readSettings(options.settingsFile);
  const command = commandFor(input);
  const probe = isProbeInvocation(input);
  const enabled = settings.enabled && settings.preToolUse.enabled && settings.preToolUse.rtk;
  let rewritten = null;
  if (enabled) rewritten = await rewriteWithRtk(command, settings.preToolUse, options.runRtk);
  await writeHealth('pretooluse', {
    lastInvocationAt: new Date().toISOString(),
    sessionId: input.session_id ?? null,
    turnId: input.turn_id ?? null,
    toolName: input.tool_name,
    enabled,
    changed: Boolean(rewritten),
    rtkAvailable: enabled ? options.rtkAvailable ?? null : null,
    commandFamily: commandFamily(command),
    probe,
  }, options.healthFile);
  if (!rewritten) return null;
  await appendJsonLine(options.metricsFile ?? hookMetricsPath(), {
    at: new Date().toISOString(),
    kind: 'rtk_rewrite',
    sessionId: input.session_id ?? null,
    turnId: input.turn_id ?? null,
    toolName: input.tool_name,
    commandFamily: commandFamily(command),
    commandFingerprint: fingerprint(command),
    rewrittenFingerprint: fingerprint(rewritten),
    probe,
  });
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...input.tool_input, command: rewritten },
    },
  };
}

export async function processPostToolUse(input, options = {}) {
  if (!input || input.hook_event_name !== 'PostToolUse' || !('tool_response' in input)) return null;
  const settings = options.settings ?? await readSettings(options.settingsFile);
  const command = commandFor(input);
  const response = input.tool_response;
  const probe = isProbeInvocation(input);
  const output = toolResponseView(response);
  const evidence = evidenceFor(response);
  const configured = settings.enabled && settings.postToolUse.enabled;
  const minTokens = numericSetting(options.minTokens ?? settings.postToolUse.minTokens, 800, { min: 64, max: 1000000 });
  const minReduction = numericSetting(options.minReduction ?? settings.postToolUse.minReduction, 0.35, { min: 0.05, max: 0.95 });
  if (!configured) {
    await writeHealth('posttooluse', {
      lastInvocationAt: new Date().toISOString(),
      sessionId: input.session_id ?? null,
      turnId: input.turn_id ?? null,
      toolName: input.tool_name ?? null,
      enabled: false,
      changed: false,
      probe,
    }, options.healthFile);
    return null;
  }
  const store = options.vault ?? await new EvidenceVault(options.vaultRoot ?? vaultRoot()).init();
  const exact = BOUNDED_EVIDENCE.test(command);
  const result = await compactToolOutput({
    command,
    output,
    evidence: evidence.text,
    evidenceFormat: evidence.format,
    exitCode: exitCodeFor(response),
    vault: store,
    exact,
    hostWrapperNote: true,
    minTokens,
    minReduction,
    metadata: {
      hook: 'PostToolUse',
      toolName: String(input.tool_name ?? '<unknown-tool>'),
      sessionId: input.session_id ?? null,
      turnId: input.turn_id ?? null,
    },
  });
  await writeHealth('posttooluse', {
    lastInvocationAt: new Date().toISOString(),
    sessionId: input.session_id ?? null,
    turnId: input.turn_id ?? null,
    toolName: input.tool_name ?? null,
    enabled: true,
    changed: result.changed,
    rawTokens: result.rawTokens,
    compactTokens: result.compactTokens,
    probe,
  }, options.healthFile);
  if (!result.changed) return null;
  await appendJsonLine(options.metricsFile ?? hookMetricsPath(), {
    at: new Date().toISOString(),
    kind: 'post_tool_compaction',
    sessionId: input.session_id ?? null,
    turnId: input.turn_id ?? null,
    toolName: input.tool_name ?? null,
    filter: result.kind,
    rawTokens: result.rawTokens,
    compactTokens: result.compactTokens,
    savedTokens: result.rawTokens - result.compactTokens,
    handle: result.handle,
    probe,
  });
  return {
    decision: 'block',
    reason: result.text,
  };
}

export async function processSessionStart(input, options = {}) {
  if (!input || input.hook_event_name !== 'SessionStart') return null;
  const settings = options.settings ?? await readSettings(options.settingsFile);
  await writeHealth('sessionstart', {
    lastInvocationAt: new Date().toISOString(),
    sessionId: input.session_id ?? null,
    source: input.source ?? null,
    enabled: settings.enabled,
    probe: isProbeInvocation(input),
  }, options.healthFile);
  if (input.source !== 'compact' || !settings.enabled || !settings.compaction.reinforceAfterCompact) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'Efficiency mode remains active after compaction. Keep responses concise; use bounded tool queries; trust compact NCC receipts; retrieve only the needed evidence with ncc evidence-find or ncc evidence-slice.',
    },
  };
}

function bridgeSessionName(sessionId) {
  const suffix = String(sessionId ?? 'default').replace(/[^A-Za-z0-9._-]/g, '-');
  return `work-${suffix}`.slice(0, 64);
}

export function turnBudgetContext(prompt, settings) {
  const budget = settings?.turnBudget ?? {};
  if (!settings?.enabled || !budget.enabled || !String(prompt ?? '').trim()) return null;
  const detailed = EXPLICIT_DETAIL.test(prompt);
  if (detailed) {
    return {
      detailed: true,
      text: "Efficiency budget: preserve the user's requested detail, but batch independent checks and avoid repeating tool output, progress narration, or the request itself.",
    };
  }
  const routineMaxWords = numericSetting(budget.routineMaxWords, 180, { min: 60, max: 1000 });
  const progressMaxWords = numericSetting(budget.progressMaxWords, 40, { min: 10, max: 200 });
  return {
    detailed: false,
    text: `Routine turn budget: keep progress updates under ${progressMaxWords} words; batch independent checks; avoid repeating tool output; keep final prose under ${routineMaxWords} words unless correctness or explicit user detail requires more. Requested code and data are exempt.`,
  };
}

export async function processUserPromptSubmit(input, options = {}) {
  if (!input || input.hook_event_name !== 'UserPromptSubmit') return null;
  const settings = options.settings ?? await readSettings(options.settingsFile);
  const bridge = settings.leanBridge ?? {};
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const enabled = Boolean(settings.enabled && bridge.enabled);
  const nativePrefix = String(bridge.nativePrefix || '!native').trim();
  const proxyContext = enabled && prompt
    ? await (options.consumeBridgeContext ?? consumeBridgeTurnContext)({ sessionId: input.session_id, prompt })
    : null;
  const prefixBypassed = Boolean(nativePrefix && prompt.toLowerCase().startsWith(nativePrefix.toLowerCase()));
  const proxyBypassed = Boolean(proxyContext?.bypass);
  const bypassed = prefixBypassed || proxyBypassed;
  const probe = isProbeInvocation(input);
  const healthFile = options.healthFile ?? hookHealthPath('userpromptsubmit');
  if (!prompt || bypassed) {
    await writeHealth('userpromptsubmit', {
      lastInvocationAt: new Date().toISOString(),
      sessionId: input.session_id ?? null,
      enabled,
      bypassed,
      bypassReason: proxyBypassed ? proxyContext.bypassReason : (prefixBypassed ? 'native_prefix' : null),
      result: bypassed ? (proxyBypassed ? 'proxy_bypass' : 'native_bypass') : 'empty_prompt',
      probe,
    }, healthFile);
    return null;
  }
  if (!enabled) {
    const context = turnBudgetContext(prompt, settings);
    if (!context) {
      await writeHealth('userpromptsubmit', {
        lastInvocationAt: new Date().toISOString(),
        sessionId: input.session_id ?? null,
        enabled: false,
        bypassed: false,
        result: 'passthrough',
        probe,
      }, healthFile);
      return null;
    }
    await appendJsonLine(options.metricsFile ?? hookMetricsPath(), {
      at: new Date().toISOString(),
      kind: 'turn_budget_context',
      sessionId: input.session_id ?? null,
      turnId: input.turn_id ?? null,
      detailed: context.detailed,
      promptChars: prompt.length,
      contextChars: context.text.length,
      probe,
    });
    await writeHealth('userpromptsubmit', {
      lastInvocationAt: new Date().toISOString(),
      sessionId: input.session_id ?? null,
      enabled: true,
      bypassed: false,
      result: 'turn_budget',
      detailed: context.detailed,
      probe,
    }, healthFile);
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context.text,
      },
    };
  }
  const maxMessages = numericSetting(bridge.seedMaxMessages, 200, { min: 0, max: 1000 });
  const timeoutMs = numericSetting(bridge.timeoutMs, 240000, { min: 10000, max: 600000 });
  const profile = bridge.profile === 'answer' ? 'answer' : 'workspace';
  try {
    const initialMessages = await (options.readTranscript ?? readConversationTranscript)(input.transcript_path, {
      excludeTrailingPrompt: prompt,
      maxMessages,
    });
    const result = await (options.runLean ?? runLeanSessionTurn)({
      prompt,
      sessionName: bridgeSessionName(input.session_id),
      initialMessages,
      cwd: input.cwd,
      model: input.model,
      effort: proxyContext?.effort ?? undefined,
      profile,
      timeoutMs,
    });
    if (typeof result?.answer !== 'string' || !result.answer.trim()) throw new Error('Lean Bridge returned an empty answer');
    await appendJsonLine(options.metricsFile ?? hookMetricsPath(), {
      at: new Date().toISOString(),
      kind: 'lean_bridge_turn',
      sessionId: input.session_id ?? null,
      turnId: input.turn_id ?? null,
      profile,
      effort: proxyContext?.effort ?? null,
      seededMessages: initialMessages.length,
      totalTokens: Number(result.usage?.totalTokens) || 0,
      historySavedPercent: Number(result.history?.savedPercent) || 0,
      outerModelTokens: 0,
      probe,
    });
    await writeHealth('userpromptsubmit', {
      lastInvocationAt: new Date().toISOString(),
      sessionId: input.session_id ?? null,
      enabled: true,
      bypassed: false,
      result: 'lean_response',
      profile,
      effort: proxyContext?.effort ?? null,
      seededMessages: initialMessages.length,
      totalTokens: Number(result.usage?.totalTokens) || 0,
      probe,
    }, healthFile);
    return { decision: 'block', reason: result.answer.trim() };
  } catch (error) {
    await writeHealth('userpromptsubmit', {
      lastInvocationAt: new Date().toISOString(),
      sessionId: input.session_id ?? null,
      enabled: true,
      bypassed: false,
      result: 'error',
      error: error instanceof Error ? error.message : String(error),
      probe,
    }, healthFile);
    await (options.recordFailure ?? recordFailure)(error);
    if (bridge.failMode === 'native') return null;
    return {
      decision: 'block',
      reason: `Lean Bridge could not complete this turn. Retry with ${nativePrefix || '!native'} at the start to use native Work mode.`,
    };
  }
}

async function readStdin(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return text;
}

export async function runCodexHook({ input = process.stdin, output = process.stdout, options = {} } = {}) {
  const payload = JSON.parse(await readStdin(input));
  let result = null;
  if (payload.hook_event_name === 'PreToolUse') result = await processPreToolUse(payload, options);
  else if (payload.hook_event_name === 'PostToolUse') result = await processPostToolUse(payload, options);
  else if (payload.hook_event_name === 'SessionStart') result = await processSessionStart(payload, options);
  else if (payload.hook_event_name === 'UserPromptSubmit') result = await processUserPromptSubmit(payload, options);
  if (result) output.write(`${JSON.stringify(result)}\n`);
}

async function recordFailure(error) {
  try {
    await appendJsonLine(hookErrorPath(), {
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {}
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  try { await runCodexHook(); }
  catch (error) {
    await recordFailure(error);
    process.exitCode = 0;
  }
}
