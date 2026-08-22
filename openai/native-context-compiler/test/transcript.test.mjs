import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readConversationTranscript } from '../src/transcript.mjs';

test('transcript import keeps conversation messages and excludes tool noise and the submitted prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncc-transcript-'));
  try {
    const file = path.join(root, 'session.jsonl');
    const rows = [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First' }] } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'large noise' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Next prompt\n' }] } },
    ];
    await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    assert.deepEqual(await readConversationTranscript(file, { excludeTrailingPrompt: 'Next prompt' }), [
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'Done' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
