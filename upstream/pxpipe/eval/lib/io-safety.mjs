import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export function privateTempDir(prefix) {
  if (!/^[a-z0-9-]{1,48}$/i.test(prefix)) throw new Error('invalid temporary-directory prefix');
  return mkdtempSync(join(tmpdir(), `pxpipe-${prefix}-`));
}

export function exclusiveWrite(file, data) {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, data); } finally { closeSync(fd); }
}

export function atomicWritePrivate(file, data) {
  const parent = dirname(resolve(file)); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temp = join(parent, `.pxpipe-${process.pid}-${randomUUID()}.tmp`);
  try { exclusiveWrite(temp, data); renameSync(temp, file); } finally { rmSync(temp, { force: true }); }
}

export function safeChild(root, segment) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)) throw new Error(`unsafe file segment: ${segment}`);
  const base = resolve(root); const candidate = resolve(base, segment);
  if (!candidate.startsWith(base + sep)) throw new Error('destination escaped its root');
  return candidate;
}

export async function boundedResponseText(response, maxBytes = 16 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) throw new Error('response exceeds size limit');
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('response exceeds size limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export const sha256Text = (value) => createHash('sha256').update(value).digest('hex');
