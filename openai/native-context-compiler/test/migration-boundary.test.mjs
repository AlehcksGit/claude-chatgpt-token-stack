import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('native stack contains no legacy API transport, agent loop, aliases, or scripts', async () => {
  const sourceFiles = await readdir(path.join(root, 'src'));
  assert.equal(sourceFiles.includes('openai-transport.mjs'), false);
  assert.equal(sourceFiles.includes('agent-loop.mjs'), false);
  assert.equal(sourceFiles.includes('native-sidecar.mjs'), false);
  assert.equal(sourceFiles.includes('sidecar-protocol.mjs'), false);
  assert.equal(sourceFiles.includes('native-context-compiler.mjs'), true);
  assert.equal(sourceFiles.includes('native-protocol.mjs'), true);

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'native-context-compiler');
  assert.equal(packageJson.version, '0.6.4');
  assert.equal(Object.hasOwn(packageJson.scripts, 'sidecar'), false);
  assert.equal(Object.hasOwn(packageJson.scripts, 'native-compiler'), true);
  assert.equal(packageJson.dependencies['@openai/codex'], '0.149.0');

  const source = (await Promise.all(sourceFiles
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => readFile(path.join(root, 'src', name), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /OpenAIResponsesTransport|ContextAgentLoop|api\.openai\.com/);
  assert.doesNotMatch(source, /method === ['"]transform['"]|method === ['"]local_tool['"]/);
  assert.match(source, /runDesktopBridge/);
});
