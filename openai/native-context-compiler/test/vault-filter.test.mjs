import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compactToolOutput } from '../src/filters.mjs';
import { EvidenceVault } from '../src/vault.mjs';

test('compacts diagnostics and preserves exact raw evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-vault-test-'));
  try {
    const vault = await new EvidenceVault(root).init();
    const raw = Array.from({ length: 500 }, (_, i) => `test ${i}: passed  `).join('\r\n')
      + '\r\nFAIL exact-id-c0ffee0913a7 at C:\\repo\\src\\app.ts:120\r\nTest Summary: 499 passed, 1 failed\r\n';
    const result = await compactToolOutput({ command: 'npm test', output: raw, exitCode: 1, vault });
    assert.equal(result.changed, true);
    assert.match(result.text, /1 failed/);
    assert.match(result.text, /exit_code: 1/);
    assert.equal(await vault.get(result.handle), raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded retrieval uses the line-oriented output view while full evidence remains exact JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-vault-json-view-'));
  try {
    const vault = await new EvidenceVault(root).init();
    const response = {
      output: Array.from({ length: 1000 }, (_, index) => `PASS test ${index + 1}`).join('\n'),
      exitCode: 0,
    };
    const exact = JSON.stringify(response, null, 2);
    const handle = await vault.put(exact, { evidenceFormat: 'canonical-json' });
    const found = await vault.find(handle, 'PASS test 1000', { context: 1 });
    assert.match(found, /999: PASS test 999/);
    assert.match(found, /1000: PASS test 1000/);
    assert.ok(found.length < 200);
    assert.equal(await vault.slice(handle, { startLine: 998, lines: 3 }), [
      '998: PASS test 998',
      '999: PASS test 999',
      '1000: PASS test 1000',
    ].join('\n'));
    assert.equal(await vault.get(handle), exact);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
