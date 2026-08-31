import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uninstallAll } from '../scripts/uninstall-all.mjs';
import { installAgentsBlock } from '../scripts/install-codex-stack.mjs';

test('uninstall removes only stack hooks and receipt, preserves data, and is repeatable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-uninstall-'));
  try {
    const codex = path.join(root, '.codex');
    const data = path.join(root, 'data');
    await mkdir(codex); await mkdir(data);
    const user = { type: 'command', command: 'user-policy-check' };
    await writeFile(path.join(codex, 'hooks.json'), JSON.stringify({ hooks: {
      PostToolUse: [{ matcher: '*', hooks: [user, { command: 'node codex-hook.mjs' }] }],
    } }));
    await writeFile(path.join(codex, 'AGENTS.md'), installAgentsBlock('Keep my preferences.'));
    await writeFile(path.join(data, 'install.json'), '{}');
    await writeFile(path.join(data, 'evidence.json'), 'keep evidence');
    const options = { home: root, localDataRoot: data, removePackage: false, restoreBridge: async () => ({ restored: false }) };
    const result = await uninstallAll(options);
    assert.equal(result.hookRemoved, 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(codex, 'hooks.json'), 'utf8')).hooks.PostToolUse,
      [{ matcher: '*', hooks: [user] }]);
    assert.equal(await readFile(path.join(codex, 'AGENTS.md'), 'utf8'), 'Keep my preferences.\n');
    assert.equal(await readFile(path.join(data, 'evidence.json'), 'utf8'), 'keep evidence');
    await assert.rejects(access(path.join(data, 'install.json')), { code: 'ENOENT' });
    assert.equal((await uninstallAll(options)).hookRemoved, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
