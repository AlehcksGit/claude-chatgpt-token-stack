import test from 'node:test';
import assert from 'node:assert/strict';
import { leanCodexConfig } from '../src/lean-config.mjs';

test('answer profile removes every optional tool family', () => {
  const config = leanCodexConfig('answer');
  assert.equal(config.features.shell_tool, false);
  assert.equal(config.features.unified_exec, false);
  assert.equal(config.features.plugins, false);
  assert.equal(config.features.browser_use, false);
  assert.equal(config.features.hooks, false);
});

test('workspace profile retains only the local execution pair', () => {
  const config = leanCodexConfig('workspace');
  assert.equal(config.features.shell_tool, true);
  assert.equal(config.features.unified_exec, true);
  assert.equal(config.features.plugins, false);
  assert.equal(config.features.multi_agent, false);
});

test('unknown lean profiles fail closed', () => {
  assert.throws(() => leanCodexConfig('unknown'), /Unknown lean Codex profile/);
});
