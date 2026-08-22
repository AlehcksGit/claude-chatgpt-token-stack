import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AGENTS_END,
  AGENTS_START,
  buildCodexHookGroups,
  installAgentsBlock,
  installCodexStack,
  mergeCodexHooks,
  removeAgentsBlock,
} from '../scripts/install-codex-stack.mjs';

test('hook merge installs the low-latency native Work events and preserves unrelated hooks', () => {
  const unrelated = { matcher: 'Bash', hooks: [{ type: 'command', command: 'keep-me' }] };
  const groups = buildCodexHookGroups({ nodePath: 'C:\\Node\\node.exe', hookScript: 'C:\\NCC\\codex-hook.mjs' });
  const once = mergeCodexHooks({ hooks: { PostToolUse: [unrelated] } }, groups);
  const twice = mergeCodexHooks(once, groups);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.hooks.PostToolUse[0], unrelated);
  assert.match(once.hooks.PreToolUse[0].hooks[0].commandWindows, /^node\.exe /);
  assert.equal(once.hooks.SessionStart[0].matcher, 'compact');
  assert.equal(once.hooks.SessionStart[0].hooks[0].additionalContextLimit, 300);
  assert.equal(once.hooks.UserPromptSubmit.length, 1);
  assert.equal(once.hooks.UserPromptSubmit[0].hooks[0].timeout, 5);
  assert.match(once.hooks.UserPromptSubmit[0].hooks[0].statusMessage, /turn budget/i);
});

test('managed AGENTS block is idempotent and removable without changing user text', () => {
  const source = 'User preference one.\n\nUser preference two.\n';
  const installed = installAgentsBlock(source);
  assert.equal(installAgentsBlock(installed), installed);
  assert.match(installed, new RegExp(AGENTS_START));
  assert.match(installed, new RegExp(AGENTS_END));
  assert.equal(removeAgentsBlock(installed), source);
});

test('installer writes hook, settings, and managed instructions with backups', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-stack-install-'));
  try {
    const codexHome = path.join(root, '.codex');
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep' }] }] } }));
    await writeFile(path.join(codexHome, 'AGENTS.md'), 'Keep this.\n');
    const result = await installCodexStack({
      nodePath: process.execPath,
      hookScript: path.resolve('src/codex-hook.mjs'),
      userProfile: root,
      codexHome,
      backupRoot: path.join(root, 'backups'),
      settingsFile: path.join(root, 'data', 'settings.json'),
    });
    assert.equal(result.trustRequired, true);
    assert.equal(result.backups.length, 2);
    const hooks = JSON.parse(await readFile(path.join(codexHome, 'hooks.json'), 'utf8'));
    assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'keep');
    assert.match(hooks.hooks.PreToolUse[0].hooks[0].commandWindows, /^node\.exe ".*codex-hook\.mjs"$/);
    assert.equal(hooks.hooks.UserPromptSubmit.length, 1);
    assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].timeout, 5);
    assert.match(await readFile(path.join(codexHome, 'AGENTS.md'), 'utf8'), /Keep this[\s\S]*native-context-compiler/);
    const settings = JSON.parse(await readFile(path.join(root, 'data', 'settings.json'), 'utf8'));
    assert.equal(settings.surface, 'chatgpt-work-local-only');
    assert.equal(settings.schemaVersion, 3);
    assert.equal(settings.preToolUse.enabled, true);
    assert.equal(settings.postToolUse.enabled, true);
    assert.equal(settings.turnBudget.enabled, true);
    assert.equal(settings.leanBridge.enabled, false);
    assert.equal(settings.leanBridge.failMode, 'native');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
