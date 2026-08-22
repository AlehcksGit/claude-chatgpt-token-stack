import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTaskGraph } from '../src/task-graph.mjs';

test('batches independent work between decision checkpoints', async () => {
  const graph = {
    nodes: [
      { id: 'status', op: 'git_status' },
      { id: 'search-a', op: 'search' },
      { id: 'search-b', op: 'search' },
      { id: 'verify', op: 'verify', dependsOn: ['status', 'search-a', 'search-b'] },
    ],
  };
  const executed = await executeTaskGraph(graph, async (node, deps) => ({ op: node.op, deps: Object.keys(deps) }));
  assert.deepEqual(executed.batches, [['status', 'search-a', 'search-b'], ['verify']]);
  assert.deepEqual(executed.results.verify.deps.sort(), ['search-a', 'search-b', 'status']);
});
