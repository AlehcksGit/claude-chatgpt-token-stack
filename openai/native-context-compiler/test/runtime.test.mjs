import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextRuntime } from '../src/runtime.mjs';

test('runtime retrieves exact evidence and omitted capabilities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-runtime-test-'));
  try {
    const runtime = await new ContextRuntime({ vaultRoot: root, compiler: { maxTools: 1 } }).init();
    const raw = Array.from({ length: 500 }, (_, i) => `src/a.ts:${i}: value-${i}`).join('\n');
    const result = await runtime.compile({
      input: [
        { type: 'custom_tool_call', call_id: 'x', name: 'shell', input: '{"cmd":"rg value src"}' },
        { type: 'custom_tool_call_output', call_id: 'x', output: raw },
        { type: 'message', role: 'user', content: 'inspect repository tests' },
      ],
      tools: [
        { type: 'function', name: 'repo_inspect', description: 'inspect repository files' },
        { type: 'function', name: 'tests_run', description: 'run repository tests' },
      ],
    }, { aggressive: true });
    const handle = result.receipts[0].handle;
    const evidence = await runtime.invokeLocalTool('evidence_get', { handle });
    assert.equal(evidence.content, raw);
    const capabilities = await runtime.invokeLocalTool('capabilities_search', { query: 'tests' });
    assert.equal(capabilities.results[0].name, 'tests_run');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
