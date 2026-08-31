import * as fs from 'node:fs';

export type StableFileResult =
  | { readonly kind: 'ok'; readonly data: Buffer; readonly mtimeMs: number }
  | { readonly kind: 'oversized' | 'inaccessible' };

const sameFile = (a: fs.Stats, b: fs.Stats): boolean => a.dev === b.dev && a.ino === b.ino;
// Node 22 on Windows Server 2025 can report different file IDs for fstat and
// lstat. Compare like APIs there while retaining descriptor/path equality on
// platforms where the kernel exposes a consistent inode identity.
const sameOpenPath = (opened: fs.Stats, named: fs.Stats): boolean => process.platform === 'win32' || sameFile(opened, named);
const unchangedOpenPath = (opened: fs.Stats, named: fs.Stats, finished: fs.Stats, renamed: fs.Stats): boolean =>
  sameFile(opened, finished) && sameFile(named, renamed) && (process.platform === 'win32' || sameFile(opened, renamed));

/** Open first, validate the descriptor and current path, read a fixed size, then
 * revalidate. This prevents check-then-read path swaps and unbounded growth. */
export function readStableRegularFile(file: string, maxBytes: number): StableFileResult {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(fd); const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== 1 || named.nlink !== 1 || !sameOpenPath(opened, named)) return { kind: 'inaccessible' };
    if (!Number.isSafeInteger(opened.size) || opened.size < 0 || opened.size > maxBytes) return { kind: 'oversized' };
    const data = Buffer.alloc(opened.size); let offset = 0;
    while (offset < data.length) { const count = fs.readSync(fd, data, offset, data.length - offset, offset); if (!count) break; offset += count; }
    const finished = fs.fstatSync(fd); const renamed = fs.lstatSync(file);
    if (offset !== data.length || !unchangedOpenPath(opened, named, finished, renamed) || finished.size !== opened.size || renamed.size !== opened.size || renamed.isSymbolicLink()) return { kind: 'inaccessible' };
    return { kind: 'ok', data, mtimeMs: opened.mtimeMs };
  } catch {
    return { kind: 'inaccessible' };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
