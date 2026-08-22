function message(role, text) {
  return { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] };
}

function toolDefinitions(count = 42) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'function',
    name: `repo_capability_${index}`,
    description: `Repository capability ${index} for targeted inspection, validation, diagnostics, and structured results. `.repeat(12),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Exact target or query.' },
        options: { type: 'object', additionalProperties: true },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }));
}

function searchOutput(turn) {
  const lines = [];
  for (let file = 0; file < 28; file += 1) {
    for (let match = 0; match < 8; match += 1) {
      lines.push(`src/module-${file}.ts:${100 + match}: const auditField${turn}_${match} = "${String(turn).padStart(4, '0')}-${file}-${match}";`);
    }
  }
  lines.push(`SUMMARY turn=${turn} files=28 matches=224 sha256=${String(turn).padStart(64, 'a')}`);
  return lines.join('\n');
}

function testOutput(turn) {
  const lines = Array.from({ length: 260 }, (_, index) => `test case ${index}: passed in ${20 + (index % 7)}ms`);
  lines.splice(190, 0, `FAIL parser preserves receipt-${turn}-c0ffee0913a7 at C:\\lab\\fixture-${turn}\\receipt.json:120`);
  lines.push(`Test Summary: 259 passed, 1 failed, run=${turn}, port=${47000 + turn}`);
  return lines.join('\n');
}

export function createLongAgentRequests(turns = 91) {
  const instructions = [
    'You are a repository agent. Preserve exact identifiers and verify every result.',
    'System and workflow guidance follows. '.repeat(900),
  ].join('\n');
  const tools = toolDefinitions();
  const history = [message('user', 'Audit the repository, fix the parser, and verify all receipts without losing exact identifiers.')];
  const requests = [];

  for (let turn = 1; turn <= turns; turn += 1) {
    const callId = `call-${turn}`;
    const command = turn % 3 === 0 ? `npm test -- fixture-${turn}` : `rg -n "receipt_${turn}" src tests`;
    history.push(message('assistant', `Decision ${turn}: inspect the next bounded slice and retain the exact evidence handle.`));
    history.push({
      type: 'custom_tool_call',
      call_id: callId,
      name: 'repo_capability_1',
      input: JSON.stringify({ cmd: command }),
    });
    history.push({
      type: 'custom_tool_call_output',
      call_id: callId,
      output: turn % 3 === 0 ? testOutput(turn) : searchOutput(turn),
    });
    history.push(message('user', `Continue audit phase ${turn}; current exact token is phase-${turn}-d34db33f and port ${47000 + turn}.`));
    requests.push({ model: 'fixture-model', instructions, input: structuredClone(history), tools: structuredClone(tools) });
  }
  return requests;
}
