import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceVault } from '../src/vault.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runCli(args, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/cli.mjs', ...args], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test('CLI native compiler needs no credential and writes protocol JSON only to stdout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-compiler-cli-'));
  try {
    const message = JSON.stringify({
      id: 7,
      method: 'compile_request',
      params: { request: { input: [{ type: 'message', role: 'user', content: 'hello' }], tools: [] } },
    });
    const result = await runCli(['native-compiler', '--stdio', '--vault-root', path.join(root, 'vault')], `${message}\n`);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    const row = JSON.parse(result.stdout.trim());
    assert.equal(row.id, 7);
    assert.equal(row.result.accounting.modelCallsAdded, 0);
    assert.equal(row.result.accounting.usageBilledCallsAdded, 0);
    assert.doesNotMatch(result.stdout, /benchmark/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI native compiler rejects unknown options with exit code 2', async () => {
  const result = await runCli(['native-compiler', '--unknown']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown native-compiler option/);
});

test('CLI reports the 0.6.4 release version', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), 'native-context-compiler 0.6.4');
});

test('CLI retrieves exact compiler evidence by handle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-compiler-evidence-'));
  try {
    const vault = await new EvidenceVault(root).init();
    const raw = 'exact evidence without an added newline';
    const handle = await vault.put(raw);
    const result = await runCli(['evidence-get', handle, '--vault-root', root]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI retrieves bounded evidence slices and searches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-compiler-evidence-'));
  try {
    const vault = await new EvidenceVault(root).init();
    const handle = await vault.put(['alpha', 'beta marker', 'gamma', 'delta'].join('\n'));
    const slice = await runCli(['evidence-slice', handle, '--start-line', '2', '--lines', '2', '--vault-root', root]);
    assert.equal(slice.code, 0);
    assert.equal(slice.stdout.trim(), '2: beta marker\n3: gamma');
    const find = await runCli(['evidence-find', handle, 'marker', '--context', '1', '--vault-root', root]);
    assert.equal(find.code, 0);
    assert.match(find.stdout, /1: alpha/);
    assert.match(find.stdout, /2: beta marker/);
    assert.match(find.stdout, /3: gamma/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI prepares the live fixture locally without starting a model turn', async () => {
  const result = await runCli(['live-eval-prepare']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const row = JSON.parse(result.stdout.trim());
  assert.equal(row.mode, 'local_only');
  assert.equal(row.liveTurnsMade, 0);
  assert.ok(row.optimizedItems < row.baselineItems);
  assert.equal(row.report.withinBudget, true);
  assert.deepEqual(row.liveBlockedReasons, [
    'claude_idle_confirmation_required',
  ]);
});

test('CLI live evaluation requires an explicit model and Claude-idle confirmation', async () => {
  const missingModel = await runCli(['live-eval']);
  assert.equal(missingModel.code, 2);
  assert.match(missingModel.stderr, /requires --model/);

  const missingIdle = await runCli(['live-eval', '--model', 'fixture-model']);
  assert.equal(missingIdle.code, 2);
  assert.match(missingIdle.stderr, /requires --claude-idle/);
});
