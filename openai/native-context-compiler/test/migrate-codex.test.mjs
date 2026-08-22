import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  migrateCodexInstallation,
  removeLegacyNccHooks,
  retireLegacyCodexTask,
  stripCodexRtkInstructions,
  stripLegacyCodexConfig,
} from '../scripts/migrate-codex.mjs';

test('legacy NCC hooks are removed while unrelated hooks are preserved', () => {
  const unrelated = { matcher: 'Bash', hooks: [{ type: 'command', command: 'policy-check' }] };
  const source = {
    hooks: {
      PostToolUse: [
        unrelated,
        { matcher: '*', hooks: [{ type: 'command', commandWindows: 'node.exe "C:\\NCC\\codex-hook.mjs"' }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'node codex-hook.mjs' }] },
      ],
    },
  };
  const result = removeLegacyNccHooks(source);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.document.hooks.PostToolUse, [unrelated]);
  assert.deepEqual(result.document.hooks.UserPromptSubmit, []);
  assert.equal(source.hooks.PostToolUse.length, 2);
});

test('legacy Codex provider and plugin wiring are removed without changing model settings', () => {
  const config = `# claude-chatgpt-token-stack:native-model-provider:start
model_provider = "pxpipe"
# claude-chatgpt-token-stack:native-model-provider:end

model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"

[plugins."claude-chatgpt-token-stack@personal"]
enabled = true

[plugins."sites@openai-bundled"]
enabled = true

# claude-chatgpt-token-stack:native-provider-table:start
[model_providers.pxpipe]
base_url = "http://127.0.0.1:47831/backend-api/codex"
# claude-chatgpt-token-stack:native-provider-table:end
`;
  const migrated = stripLegacyCodexConfig(config);
  assert.doesNotMatch(migrated, /pxpipe|claude-chatgpt-token-stack/);
  assert.match(migrated, /model = "gpt-5\.6-sol"/);
  assert.match(migrated, /model_reasoning_effort = "xhigh"/);
  assert.match(migrated, /sites@openai-bundled/);
});

test('only the managed RTK instruction block is removed from AGENTS.md', () => {
  const source = `Keep this preference.\n\n<!-- openai-token-stack:rtk:start -->\nAlways prefix with rtk.\n<!-- openai-token-stack:rtk:end -->\nAfter.\n`;
  assert.equal(stripCodexRtkInstructions(source), 'Keep this preference.\n\nAfter.\n');
});

test('migration removes obsolete Codex integrations with recoverable backups', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-codex-migrate-'));
  try {
    const codexHome = path.join(root, '.codex');
    const backupRoot = path.join(root, 'backups');
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, 'hooks.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          { hooks: [{ type: 'command', command: 'node codex-hook.mjs' }] },
          { hooks: [{ type: 'command', command: 'keep-me' }] },
        ],
      },
    }));
    await writeFile(path.join(codexHome, 'config.toml'), `# claude-chatgpt-token-stack:native-model-provider:start\nmodel_provider = "pxpipe"\n# claude-chatgpt-token-stack:native-model-provider:end\nmodel = "gpt-5.6-sol"\n`);
    await writeFile(path.join(codexHome, 'AGENTS.md'), `Keep.\n<!-- openai-token-stack:rtk:start -->\nrtk\n<!-- openai-token-stack:rtk:end -->\n`);
    await writeFile(path.join(codexHome, 'openai-token-stack-RTK.md'), 'legacy');
    const migrated = await migrateCodexInstallation({
      userProfile: root,
      codexHome,
      backupRoot,
      retireTask: async () => ({ taskName: 'fixture', removed: false, reason: 'test' }),
    });
    assert.equal(migrated.mode, 'native-work-stack');
    assert.equal(migrated.legacyHooksRemoved, 1);
    assert.equal(migrated.legacyProviderRemoved, true);
    assert.equal(migrated.rtkInstructionsRemoved, true);
    assert.equal(migrated.rtkReferenceRemoved, true);
    assert.equal(migrated.backups.length, 4);
    const hooks = JSON.parse(await readFile(path.join(codexHome, 'hooks.json'), 'utf8'));
    assert.equal(hooks.hooks.PostToolUse.length, 1);
    assert.equal(hooks.hooks.PostToolUse[0].hooks[0].command, 'keep-me');
    assert.doesNotMatch(await readFile(path.join(codexHome, 'config.toml'), 'utf8'), /pxpipe/);
    assert.equal(await readFile(path.join(codexHome, 'AGENTS.md'), 'utf8'), 'Keep.\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy Codex task retirement backs up before deleting', async () => {
  if (process.platform !== 'win32') return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-task-retire-'));
  const calls = [];
  try {
    const result = await retireLegacyCodexTask({
      backupRoot: root,
      run: async (file, args) => {
        calls.push({ file, args });
        return args[0] === '/Query' ? { stdout: Buffer.from('<Task />', 'utf16le') } : { stdout: '' };
      },
    });
    assert.equal(result.removed, true);
    assert.deepEqual(calls.map((call) => call.args[0]), ['/Query', '/Delete']);
    assert.deepEqual(await readFile(result.backup), Buffer.from('<Task />', 'utf16le'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
