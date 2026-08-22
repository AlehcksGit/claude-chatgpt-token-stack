#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCodexSubscription } from '../src/codex-app-server.mjs';
import { hookEvalPath } from '../src/paths.mjs';
import { EvidenceVault } from '../src/vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const userCodexHome = path.join(process.env.USERPROFILE ?? os.homedir(), '.codex');
const hookScript = path.join(packageRoot, 'src', 'codex-hook.mjs');

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function parseHookEvalOptions(args) {
  let model;
  let effort = 'low';
  let claudeIdle = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model' && args[index + 1]) model = args[++index];
    else if (arg === '--effort' && args[index + 1]) effort = args[++index];
    else if (arg === '--claude-idle') claudeIdle = true;
    else return { error: `Unknown hook-eval option: ${arg}` };
  }
  if (!model) return { error: 'hook-eval requires --model <model>' };
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) return { error: 'hook-eval model contains unsupported characters' };
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(effort)) return { error: 'hook-eval effort contains unsupported characters' };
  if (!claudeIdle) return { error: 'hook-eval requires --claude-idle' };
  return { model, effort };
}

function codexLaunch() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const script = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync(script)) return { command: process.execPath, prefix: [script] };
    return { command: 'codex.exe', prefix: [] };
  }
  return { command: 'codex', prefix: [] };
}

function parseJsonLines(text) {
  return String(text).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function usageFrom(records) {
  for (const record of [...records].reverse()) {
    const value = record?.usage ?? record?.params?.tokenUsage?.last ?? record?.tokenUsage?.last;
    if (!value || typeof value !== 'object') continue;
    const inputTokens = value.input_tokens ?? value.inputTokens;
    const outputTokens = value.output_tokens ?? value.outputTokens;
    const reportedTotal = value.total_tokens ?? value.totalTokens;
    const totalTokens = Number.isInteger(reportedTotal) ? reportedTotal : inputTokens + outputTokens;
    if ([inputTokens, outputTokens, totalTokens].every(Number.isInteger)) return { inputTokens, outputTokens, totalTokens };
  }
  return null;
}

function answerFrom(records) {
  for (const record of [...records].reverse()) {
    if (record?.type === 'item.completed' && record?.item?.type === 'agent_message') return record.item.text;
  }
  return null;
}

function commandCount(records) {
  return records.filter((record) => record?.type === 'item.completed' && record?.item?.type === 'command_execution').length;
}

async function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function prepareHome(root, enabled, { model, effort }) {
  const codexHome = path.join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  await copyFile(path.join(userCodexHome, 'auth.json'), path.join(codexHome, 'auth.json'));
  await writeFile(path.join(codexHome, 'config.toml'), `model = ${JSON.stringify(model)}\nmodel_reasoning_effort = ${JSON.stringify(effort)}\n`, { encoding: 'utf8', mode: 0o600 });
  const hooks = enabled ? {
    description: 'Disposable Native Context Compiler PostToolUse A/B.',
    hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{
      type: 'command',
      command: `${quote(process.execPath)} ${quote(hookScript)}`,
      commandWindows: `node.exe ${quote(hookScript)}`,
      timeout: 15,
      additionalContextLimit: 2500,
    }] }] },
  } : { description: 'Disposable control with no hooks.', hooks: {} };
  await writeFile(path.join(codexHome, 'hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return codexHome;
}

async function runArm({ enabled, root, canary, options }) {
  const name = enabled ? 'optimized' : 'control';
  const codexHome = await prepareHome(path.join(root, name), enabled, options);
  const dataRoot = path.join(root, `${name}-data`);
  const launch = codexLaunch();
  const prompt = [
    'Run exactly this command once: node large-output.mjs',
    'Do not inspect the script and do not run any other tool.',
    `If the command output visibly contains ${canary}, reply with exactly ${canary}.`,
    'If that exact value is not visible in the tool result, reply with exactly UNAVAILABLE.',
    'Return no other text.',
  ].join(' ');
  const env = { ...process.env, CODEX_HOME: codexHome, NCC_DATA_ROOT: dataRoot };
  for (const key of Object.keys(env)) if (/^(OPENAI_API_KEY|AZURE_OPENAI_API_KEY)$/i.test(key)) delete env[key];
  const result = await runProcess(launch.command, [
    ...launch.prefix, 'exec', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust', '--skip-git-repo-check', '--json',
    '--model', options.model, '-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`,
    '--cd', root, prompt,
  ], { cwd: root, env, windowsHide: true, shell: false });
  const records = parseJsonLines(result.stdout);
  let health = null;
  try { health = JSON.parse(await readFile(path.join(dataRoot, 'hook-health-posttooluse.json'), 'utf8')); } catch {}
  let evidenceRetained = false;
  try {
    const metrics = (await readFile(path.join(dataRoot, 'hook-metrics.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    const handle = metrics.findLast((entry) => entry.kind === 'post_tool_compaction')?.handle;
    const evidence = await new EvidenceVault(path.join(dataRoot, 'vault')).get(handle);
    evidenceRetained = evidence.includes(canary) && evidence.includes('ordinary record 0: ok') && evidence.includes('ordinary record 1999: ok');
  } catch {}
  const answer = answerFrom(records)?.trim() ?? null;
  return {
    arm: name,
    exitCode: result.code,
    usage: usageFrom(records),
    commands: commandCount(records),
    sawCanary: answer === canary,
    answeredUnavailable: answer === 'UNAVAILABLE',
    hookObserved: health?.changed === true,
    evidenceRetained,
    stderrPresent: Boolean(result.stderr.trim()),
  };
}

async function appendResult(record) {
  const file = hookEvalPath();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function main(args = process.argv.slice(2), io = process) {
  const options = parseHookEvalOptions(args);
  if (options.error) { io.stderr.write(`${options.error}\n`); return 2; }
  const subscription = await checkCodexSubscription({ clientOptions: { cwd: packageRoot } });
  if (!subscription.eligible) {
    io.stderr.write(`hook-eval blocked: ${subscription.reason}\n`);
    return 3;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-hook-eval-'));
  try {
    const canary = `VALUE_${randomBytes(16).toString('hex')}`;
    const fixture = [
      'for (let index = 0; index < 2000; index += 1) {',
      `  if (index === 1777) console.log(${JSON.stringify(canary)});`,
      '  else console.log(`ordinary record ${index}: ok`);',
      '}',
      '',
    ].join('\n');
    await writeFile(path.join(root, 'large-output.mjs'), fixture, 'utf8');
    const order = randomBytes(1)[0] % 2 ? [false, true] : [true, false];
    const results = [];
    for (const enabled of order) results.push(await runArm({ enabled, root, canary, options }));
    const control = results.find((value) => value.arm === 'control');
    const optimized = results.find((value) => value.arm === 'optimized');
    const valid = control.exitCode === 0 && optimized.exitCode === 0
      && control.commands === 1 && optimized.commands === 1
      && control.sawCanary && optimized.answeredUnavailable && optimized.hookObserved && optimized.evidenceRetained
      && Number.isInteger(control.usage?.inputTokens) && Number.isInteger(optimized.usage?.inputTokens)
      && optimized.usage.inputTokens < control.usage.inputTokens;
    const savedTokens = control.usage && optimized.usage ? control.usage.inputTokens - optimized.usage.inputTokens : null;
    const savedPercent = Number.isInteger(savedTokens) ? 100 * savedTokens / control.usage.inputTokens : null;
    const versionResult = await runProcess(codexLaunch().command, [...codexLaunch().prefix, '--version'], {
      cwd: root, env: process.env, windowsHide: true, shell: false,
    });
    const record = {
      at: new Date().toISOString(), kind: 'hook_ab', valid,
      codexVersion: versionResult.stdout.trim() || null,
      model: options.model, effort: options.effort,
      baselineInputTokens: control.usage?.inputTokens ?? null,
      optimizedInputTokens: optimized.usage?.inputTokens ?? null,
      savedTokens, savedPercent,
      controlCanaryVisible: control.sawCanary,
      optimizedCanaryHidden: optimized.answeredUnavailable,
      exactEvidenceRetained: optimized.evidenceRetained,
      order: results.map((value) => value.arm),
    };
    if (valid) await appendResult(record);
    io.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return valid ? 0 : 1;
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
