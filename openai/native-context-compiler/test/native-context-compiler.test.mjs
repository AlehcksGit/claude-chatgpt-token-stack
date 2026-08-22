import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeContextCompiler } from '../src/native-context-compiler.mjs';

function safeReport(overrides = {}) {
  return {
    needsOpaqueCompactionBoundary: false,
    withinBudget: true,
    toolPairsValid: true,
    qualityRisk: false,
    ...overrides,
  };
}

test('native compiler transforms locally without mutating the caller or adding model calls', async () => {
  const request = {
    model: 'native-model',
    input: [{ type: 'message', role: 'user', content: 'hello' }],
    unknownNativeField: { keep: ['exactly'] },
  };
  const before = structuredClone(request);
  let compileCalls = 0;
  const runtime = {
    compile: async (value) => {
      compileCalls += 1;
      return {
        request: { ...value, input: [...value.input, { type: 'message', role: 'assistant', content: 'checkpoint' }] },
        report: safeReport(),
        receipts: [],
      };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network access is forbidden'); };
  try {
    const result = await new NativeContextCompiler({ runtime }).compileRequest(request);
    assert.equal(compileCalls, 1);
    assert.equal(result.mode, 'compiled');
    assert.deepEqual(request, before);
    assert.deepEqual(result.request.unknownNativeField, before.unknownNativeField);
    assert.deepEqual(result.accounting, {
      modelCallsAdded: 0,
      compactionCallsAdded: 0,
      usageBilledCallsAdded: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [field, value, reason] of [
  ['needsOpaqueCompactionBoundary', true, 'opaque_compaction_boundary_required'],
  ['withinBudget', false, 'compiled_request_over_budget'],
  ['toolPairsValid', false, 'invalid_tool_pairing'],
  ['qualityRisk', true, 'quality_risk'],
]) {
  test(`native compiler fails open when ${field} is unsafe`, async () => {
    const request = { input: [{ type: 'message', role: 'user', content: 'latest' }], native: { preserved: true } };
    const runtime = {
      compile: async () => ({
        request: { input: [{ type: 'message', role: 'user', content: 'changed' }] },
        report: safeReport({ [field]: value }),
        receipts: [{ handle: 'must-not-be-used' }],
      }),
    };
    const result = await new NativeContextCompiler({ runtime }).compileRequest(request);
    assert.equal(result.mode, 'passthrough');
    assert.deepEqual(result.request, request);
    assert.deepEqual(result.reasons, [reason]);
    assert.deepEqual(result.receipts, []);
    assert.equal(result.accounting.modelCallsAdded, 0);
  });
}

test('native compiler fails open on local compiler errors', async () => {
  const request = { input: [], native: 'preserve' };
  const runtime = { compile: async () => { throw new Error('local failure'); } };
  const result = await new NativeContextCompiler({ runtime }).compileRequest(request);
  assert.equal(result.mode, 'passthrough');
  assert.deepEqual(result.request, request);
  assert.equal(result.error.code, 'local_compile_error');
  assert.equal(result.accounting.usageBilledCallsAdded, 0);
});
