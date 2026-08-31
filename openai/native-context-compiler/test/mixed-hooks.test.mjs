import test from 'node:test';
import assert from 'node:assert/strict';
import { removeLegacyNccHooks } from '../scripts/migrate-codex.mjs';
import { mergeCodexHooks } from '../scripts/install-codex-stack.mjs';

test('upgrade and removal preserve user handlers in mixed groups, metadata, and source', () => {
  const userHook = { type: 'command', command: 'company-policy-check' };
  const managedHook = { type: 'command', commandWindows: 'node.exe "C:\\NCC\\codex-hook.mjs"' };
  const group = { matcher: 'Bash', description: 'User policy', hooks: [userHook, managedHook] };
  const source = { hooks: { PreToolUse: [group], PostToolUse: [group] } };
  const expected = { matcher: 'Bash', description: 'User policy', hooks: [userHook] };
  const removal = removeLegacyNccHooks(source);
  assert.equal(removal.removed, 2);
  assert.deepEqual(removal.document.hooks.PreToolUse, [expected]);
  const additions = { PreToolUse: [{ hooks: [managedHook] }] };
  const upgraded = mergeCodexHooks(source, additions);
  assert.deepEqual(upgraded.hooks.PreToolUse, [expected, ...additions.PreToolUse]);
  assert.deepEqual(mergeCodexHooks(upgraded, additions), upgraded);
  assert.equal(source.hooks.PreToolUse[0].hooks.length, 2);
});
