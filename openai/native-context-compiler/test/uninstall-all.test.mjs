import assert from 'node:assert/strict';
import test from 'node:test';
import { removeCompilerHook } from '../scripts/uninstall-all.mjs';
import { installAgentsBlock, removeAgentsBlock } from '../scripts/install-codex-stack.mjs';

test('uninstaller removes only Native Context Compiler hook groups', () => {
  const input = {
    hooks: {
      PostToolUse: [
        { matcher: '*', hooks: [{ type: 'command', commandWindows: 'node.exe "C:\\ncc\\codex-hook.mjs"' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook' }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', commandWindows: 'node.exe "C:\\ncc\\codex-hook.mjs"' }] },
      ],
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'keep-me' }] }],
    },
  };
  const result = removeCompilerHook(input);
  assert.equal(result.removed, 2);
  assert.equal(result.document.hooks.PostToolUse.length, 1);
  assert.equal(result.document.hooks.UserPromptSubmit.length, 0);
  assert.equal(result.document.hooks.PostToolUse[0].hooks[0].command, 'other-hook');
  assert.equal(result.document.hooks.SessionStart[0].hooks[0].command, 'keep-me');
  assert.equal(input.hooks.PostToolUse.length, 2);
});

test('uninstaller is idempotent when compiler hook is absent', () => {
  const result = removeCompilerHook({ hooks: { PostToolUse: [] } });
  assert.equal(result.removed, 0);
  assert.deepEqual(result.document.hooks.PostToolUse, []);
});

test('uninstaller removes only the managed AGENTS block', () => {
  const source = 'Keep user guidance.\n';
  assert.equal(removeAgentsBlock(installAgentsBlock(source)), source);
});
