import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicWritePrivate, boundedResponseText, exclusiveWrite, privateTempDir, safeChild } from '../eval/lib/io-safety.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('evaluation I/O safety', () => {
  it('creates private random directories and exclusive files', () => {
    const root = privateTempDir('test'); roots.push(root);
    const file = path.join(root, 'value'); exclusiveWrite(file, 'one');
    expect(fs.readFileSync(file, 'utf8')).toBe('one');
    expect(() => exclusiveWrite(file, 'two')).toThrow();
    if (process.platform !== 'win32') {
      expect(fs.statSync(root).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });
  it('keeps destinations below their root and replaces files atomically', () => {
    const root = privateTempDir('atomic'); roots.push(root);
    expect(() => safeChild(root, '../escape')).toThrow();
    const file = safeChild(root, 'result.json'); atomicWritePrivate(file, 'one'); atomicWritePrivate(file, 'two');
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
  });
  it('bounds streamed HTTP response bodies', async () => {
    const response = new Response('small');
    expect(await boundedResponseText(response, 5)).toBe('small');
    await expect(boundedResponseText(new Response('too large'), 4)).rejects.toThrow('size limit');
  });
});
