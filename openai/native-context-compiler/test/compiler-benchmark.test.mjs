import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBenchmark } from '../src/benchmark.mjs';
import { compileResponsesRequest } from '../src/compiler.mjs';
import { EvidenceVault } from '../src/vault.mjs';

test('long-agent replay clears every offline reduction gate', { timeout: 120000 }, async () => {
  const result = await runBenchmark({ turns: 36, maxInputTokens: 12000 });
  assert.equal(result.gates.allWithinBudget, true);
  assert.equal(result.gates.allToolPairsValid, true);
  assert.equal(result.gates.latestUsersByteExact, true);
  assert.equal(result.gates.evidenceRoundTrips, true);
  assert.ok(result.savedPercent >= 80, `expected >=80%, got ${result.savedPercent}`);
});

test('safe mode refuses to prune encrypted reasoning without an opaque compaction boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-opaque-test-'));
  try {
    const vault = await new EvidenceVault(root).init();
    const input = [
      { type: 'message', role: 'user', content: 'start' },
      { type: 'reasoning', encrypted_content: 'opaque'.repeat(5000) },
      { type: 'message', role: 'assistant', content: 'work' },
      { type: 'message', role: 'user', content: 'continue' },
      { type: 'message', role: 'assistant', content: 'latest' },
      { type: 'message', role: 'user', content: 'now' },
    ];
    const result = await compileResponsesRequest({ input, tools: [] }, {
      vault,
      maxInputTokens: 200,
      aggressive: false,
    });
    assert.equal(result.report.needsOpaqueCompactionBoundary, true);
    assert.equal(result.request.input.some((item) => item.encrypted_content), true);
    assert.equal(result.report.withinBudget, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
