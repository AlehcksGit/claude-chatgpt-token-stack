import test from 'node:test';
import assert from 'node:assert/strict';
import { callCommand, outputText, pairToolItems, replaceOutputText } from '../src/wire.mjs';

test('pairs function and custom tool traffic', () => {
  const items = [
    { type: 'function_call', call_id: 'a', name: 'shell', arguments: '{"cmd":"git status"}' },
    { type: 'function_call_output', call_id: 'a', output: 'clean' },
    { type: 'custom_tool_call', call_id: 'b', name: 'exec', input: { command: 'npm test' } },
    { type: 'custom_tool_call_output', call_id: 'b', output: '1 failed' },
  ];
  const result = pairToolItems(items);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.pairs.length, 2);
  assert.equal(callCommand(result.pairs[0].call), 'git status');
  assert.equal(callCommand(result.pairs[1].call), 'npm test');
});

test('replaces output without changing call identity', () => {
  const item = { type: 'custom_tool_call_output', call_id: 'b', output: 'raw' };
  const next = replaceOutputText(item, 'compact');
  assert.equal(outputText(next), 'compact');
  assert.equal(next.call_id, 'b');
  assert.equal(item.output, 'raw');
});

test('reports open calls and orphan outputs', () => {
  const result = pairToolItems([
    { type: 'custom_tool_call', call_id: 'open', name: 'exec', input: '{}' },
    { type: 'custom_tool_call_output', call_id: 'missing', output: 'orphan' },
  ]);
  assert.deepEqual(result.unresolved.map((x) => x.reason).sort(), ['open_call', 'orphan_output']);
});
