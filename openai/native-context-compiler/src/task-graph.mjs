export function validateTaskGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('Task graph requires nodes');
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== 'string') throw new Error('Each task node needs an id');
    if (ids.has(node.id)) throw new Error(`Duplicate task node: ${node.id}`);
    ids.add(node.id);
  }
  for (const node of graph.nodes) {
    for (const dep of node.dependsOn ?? []) if (!ids.has(dep)) throw new Error(`Unknown dependency ${dep}`);
  }
  return true;
}

export function taskBatches(graph) {
  validateTaskGraph(graph);
  const remaining = new Map(graph.nodes.map((node) => [node.id, node]));
  const completed = new Set();
  const batches = [];
  while (remaining.size) {
    const batch = [...remaining.values()].filter((node) => (node.dependsOn ?? []).every((id) => completed.has(id)));
    if (!batch.length) throw new Error('Task graph contains a cycle');
    batches.push(batch);
    for (const node of batch) {
      remaining.delete(node.id);
      completed.add(node.id);
    }
  }
  return batches;
}

export async function executeTaskGraph(graph, executor) {
  if (typeof executor !== 'function') throw new Error('An explicit executor is required');
  const results = new Map();
  const batches = taskBatches(graph);
  for (const batch of batches) {
    const values = await Promise.all(batch.map(async (node) => {
      const dependencies = Object.fromEntries((node.dependsOn ?? []).map((id) => [id, results.get(id)]));
      return [node.id, await executor(node, dependencies)];
    }));
    for (const [id, value] of values) results.set(id, value);
  }
  return { batches: batches.map((batch) => batch.map((node) => node.id)), results: Object.fromEntries(results) };
}
