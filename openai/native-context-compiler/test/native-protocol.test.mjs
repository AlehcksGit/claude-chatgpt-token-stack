import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { runNativeCompilerStdio } from '../src/native-protocol.mjs';

test('native compiler stdio returns one correlated JSON result per nonblank input and continues after errors', async () => {
  const input = new PassThrough();
  const chunks = [];
  const output = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  let transforms = 0;
  const operations = [];
  const compiler = {
    compileRequest: async (request) => {
      transforms += 1;
      return { mode: 'compiled', request, accounting: { modelCallsAdded: 0 } };
    },
    invokeLocalOperation: async (name, params) => {
      operations.push({ name, params });
      return { ok: true, name };
    },
  };
  input.end([
    '{bad json',
    JSON.stringify({ id: 'a', method: 'unknown' }),
    JSON.stringify({ id: 'b', method: 'external_shell' }),
    JSON.stringify({ id: 'd', method: 'evidence_get', params: { handle: 'sha256:fixture' } }),
    JSON.stringify({ id: 'e', method: 'capabilities_search', params: { query: 'database' } }),
    JSON.stringify({ id: 'c', method: 'compile_request', params: { request: { input: [] } } }),
  ].join('\n'));
  await runNativeCompilerStdio({ compiler, input, output });
  const rows = chunks.join('').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].error.code, 'invalid_json');
  assert.equal(rows[1].id, 'a');
  assert.equal(rows[1].error.code, 'unsupported_method');
  assert.equal(rows[2].error.code, 'unsupported_method');
  assert.equal(rows[3].result.name, 'evidence_get');
  assert.equal(rows[4].result.name, 'capabilities_search');
  assert.equal(rows[5].id, 'c');
  assert.equal(rows[5].result.accounting.modelCallsAdded, 0);
  assert.equal(transforms, 1);
  assert.deepEqual(operations, [
    { name: 'evidence_get', params: { handle: 'sha256:fixture' } },
    { name: 'capabilities_search', params: { query: 'database' } },
  ]);
});
