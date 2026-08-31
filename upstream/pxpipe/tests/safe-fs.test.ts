import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readStableRegularFile } from '../src/safe-fs.js';

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-safe-fs-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('stable local file reads', () => {
  it('reads a bounded regular file and rejects oversized input', () => {
    const file = path.join(temp(), 'value.txt'); fs.writeFileSync(file, 'value');
    expect(readStableRegularFile(file, 5)).toMatchObject({ kind: 'ok', data: Buffer.from('value') });
    expect(readStableRegularFile(file, 4)).toEqual({ kind: 'oversized' });
  });
  it('rejects hard links and symbolic links', () => {
    const root = temp(); const file = path.join(root, 'value.txt'); const hard = path.join(root, 'hard.txt');
    fs.writeFileSync(file, 'private'); fs.linkSync(file, hard);
    expect(readStableRegularFile(file, 100).kind).toBe('inaccessible');
    const target = path.join(root, 'target.txt'); const link = path.join(root, 'link.txt'); fs.writeFileSync(target, 'target');
    try { fs.symlinkSync(target, link); expect(readStableRegularFile(link, 100).kind).toBe('inaccessible'); } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
  });
});
