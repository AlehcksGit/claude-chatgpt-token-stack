import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processPostToolUse, processPreToolUse, processSessionStart, processUserPromptSubmit } from '../src/codex-hook.mjs';
import { DEFAULT_SETTINGS } from '../src/settings.mjs';
import { EvidenceVault } from '../src/vault.mjs';

function settings() {
  return structuredClone(DEFAULT_SETTINGS);
}

test('PreToolUse transparently applies an RTK rewrite and preserves other tool input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-pre-hook-'));
  try {
    const result = await processPreToolUse({
      hook_event_name: 'PreToolUse',
      session_id: 'session',
      turn_id: 'turn',
      tool_name: 'Bash',
      tool_input: { command: 'git status', justification: 'fixture' },
    }, {
      settings: settings(),
      healthFile: path.join(root, 'health.json'),
      metricsFile: path.join(root, 'metrics.jsonl'),
      runRtk: async () => ({ stdout: 'rtk git status\n' }),
    });
    assert.equal(result.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(result.hookSpecificOutput.updatedInput.command, 'rtk git status');
    assert.equal(result.hookSpecificOutput.updatedInput.justification, 'fixture');
    const metric = JSON.parse((await readFile(path.join(root, 'metrics.jsonl'), 'utf8')).trim());
    assert.equal(metric.kind, 'rtk_rewrite');
    assert.equal(metric.commandFamily, 'git');
    assert.equal('command' in metric, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PostToolUse replaces oversized output and stores exact evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-post-hook-'));
  try {
    const vault = await new EvidenceVault(path.join(root, 'vault')).init();
    const response = { output: Array.from({ length: 1000 }, (_, index) => `PASS test ${index}`).join('\n'), exitCode: 0 };
    const result = await processPostToolUse({
      hook_event_name: 'PostToolUse',
      session_id: 'session',
      turn_id: 'turn',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: response,
    }, {
      settings: settings(),
      vault,
      healthFile: path.join(root, 'health.json'),
      metricsFile: path.join(root, 'metrics.jsonl'),
      minTokens: 100,
      minReduction: 0.2,
    });
    assert.equal(result.decision, 'block');
    assert.match(result.reason, /command already completed/);
    assert.match(result.reason, /evidence-find/);
    const handle = /raw_evidence: (ev:sha256:[a-f0-9]{64})/.exec(result.reason)[1];
    assert.equal(await vault.get(handle), JSON.stringify(response, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SessionStart after compaction restores only concise efficiency context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-compact-hook-'));
  try {
    const result = await processSessionStart({
      hook_event_name: 'SessionStart',
      source: 'compact',
    }, { settings: settings(), healthFile: path.join(root, 'health.json') });
    assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(result.hookSpecificOutput.additionalContext, /evidence-find/);
    assert.ok(result.hookSpecificOutput.additionalContext.length < 300);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit adds a lightweight routine budget without blocking the native turn', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-budget-'));
  try {
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'ncc-installed-probe',
      turn_id: 'turn',
      prompt: 'Check the project status.',
    }, {
      settings: settings(),
      healthFile: path.join(root, 'health.json'),
      metricsFile: path.join(root, 'metrics.jsonl'),
    });
    assert.equal(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(result.hookSpecificOutput.additionalContext, /under 180 words/);
    assert.equal('decision' in result, false);
    const health = JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8'));
    assert.equal(health.result, 'turn_budget');
    assert.equal(health.probe, true);
    const metric = JSON.parse((await readFile(path.join(root, 'metrics.jsonl'), 'utf8')).trim());
    assert.equal(metric.kind, 'turn_budget_context');
    assert.equal(metric.detailed, false);
    assert.equal(metric.probe, true);
    assert.equal('prompt' in metric, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit preserves explicitly requested detail', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-detailed-'));
  try {
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session',
      prompt: 'Do a comprehensive deep dive and explain every issue.',
    }, {
      settings: settings(),
      healthFile: path.join(root, 'health.json'),
      metricsFile: path.join(root, 'metrics.jsonl'),
    });
    assert.match(result.hookSpecificOutput.additionalContext, /preserve the user's requested detail/);
    assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /180/);
    const health = JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8'));
    assert.equal(health.detailed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit routes one turn through Lean and blocks the outer model call', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-hook-'));
  try {
    const value = settings();
    value.leanBridge.enabled = true;
    let leanInput;
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session/id',
      turn_id: 'turn',
      transcript_path: path.join(root, 'transcript.jsonl'),
      cwd: root,
      model: 'fixture-model',
      prompt: 'Finish the task.',
    }, {
      settings: value,
      healthFile: path.join(root, 'health.json'),
      metricsFile: path.join(root, 'metrics.jsonl'),
      consumeBridgeContext: async () => ({ effort: 'xhigh', bypass: false }),
      readTranscript: async () => [{ role: 'user', text: 'Earlier request' }],
      runLean: async (input) => {
        leanInput = input;
        return {
          answer: 'Finished.',
          usage: { totalTokens: 123 },
          history: { savedPercent: 81 },
        };
      },
    });
    assert.deepEqual(result, { decision: 'block', reason: 'Finished.' });
    assert.equal(leanInput.sessionName, 'work-session-id');
    assert.equal(leanInput.profile, 'workspace');
    assert.equal(leanInput.effort, 'xhigh');
    assert.deepEqual(leanInput.initialMessages, [{ role: 'user', text: 'Earlier request' }]);
    const metric = JSON.parse((await readFile(path.join(root, 'metrics.jsonl'), 'utf8')).trim());
    assert.equal(metric.kind, 'lean_bridge_turn');
    assert.equal(metric.outerModelTokens, 0);
    assert.equal('prompt' in metric, false);
    assert.equal('answer' in metric, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit supports a visible native escape prefix', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-bypass-'));
  try {
    const value = settings();
    value.leanBridge.enabled = true;
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session',
      prompt: '!native use the browser',
    }, { settings: value, healthFile: path.join(root, 'health.json') });
    assert.equal(result, null);
    const health = JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8'));
    assert.equal(health.result, 'native_bypass');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit bypasses Lean for unsupported desktop inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-proxy-bypass-'));
  try {
    const value = settings();
    value.leanBridge.enabled = true;
    let called = false;
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session',
      prompt: 'Inspect this image',
    }, {
      settings: value,
      healthFile: path.join(root, 'health.json'),
      consumeBridgeContext: async () => ({ bypass: true, bypassReason: 'non_text_input' }),
      runLean: async () => { called = true; },
    });
    assert.equal(result, null);
    assert.equal(called, false);
    const health = JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8'));
    assert.equal(health.result, 'proxy_bypass');
    assert.equal(health.bypassReason, 'non_text_input');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit can fail closed when explicitly configured', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-failure-'));
  try {
    const value = settings();
    value.leanBridge.enabled = true;
    value.leanBridge.failMode = 'block';
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session',
      cwd: root,
      prompt: 'Change the workspace.',
    }, {
      settings: value,
      healthFile: path.join(root, 'health.json'),
      readTranscript: async () => [],
      runLean: async () => { throw new Error('fixture failure'); },
      recordFailure: async () => {},
    });
    assert.equal(result.decision, 'block');
    assert.match(result.reason, /!native/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UserPromptSubmit fails open to native Work by default', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-prompt-fail-open-'));
  try {
    const value = settings();
    value.leanBridge.enabled = true;
    const result = await processUserPromptSubmit({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session',
      cwd: root,
      prompt: 'Continue natively if Lean is unavailable.',
    }, {
      settings: value,
      healthFile: path.join(root, 'health.json'),
      readTranscript: async () => [],
      runLean: async () => { throw new Error('fixture failure'); },
      recordFailure: async () => {},
    });
    assert.equal(result, null);
    assert.equal(JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8')).result, 'error');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
