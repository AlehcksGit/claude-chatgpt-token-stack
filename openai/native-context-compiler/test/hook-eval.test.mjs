import assert from 'node:assert/strict';
import test from 'node:test';
import { main, parseHookEvalOptions } from '../scripts/probe-post-tool-use.mjs';

test('hook evaluation requires explicit model and idle confirmation', async () => {
  assert.deepEqual(parseHookEvalOptions([]), { error: 'hook-eval requires --model <model>' });
  assert.deepEqual(parseHookEvalOptions(['--model', 'fixture']), { error: 'hook-eval requires --claude-idle' });
  assert.deepEqual(parseHookEvalOptions(['--model', 'fixture', '--effort', 'low', '--claude-idle']), { model: 'fixture', effort: 'low' });
  let stderr = '';
  const code = await main([], { stdout: { write() {} }, stderr: { write(value) { stderr += value; } } });
  assert.equal(code, 2);
  assert.match(stderr, /requires --model/);
});
