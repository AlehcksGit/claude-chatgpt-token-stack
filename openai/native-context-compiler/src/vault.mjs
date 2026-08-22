import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HANDLE_PREFIX = 'ev:sha256:';

function digest(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function parseHandle(handle) {
  if (typeof handle !== 'string' || !handle.startsWith(HANDLE_PREFIX)) {
    throw new Error(`Invalid evidence handle: ${String(handle)}`);
  }
  const hash = handle.slice(HANDLE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid evidence digest');
  return hash;
}

function textParts(value) {
  if (!Array.isArray(value)) return '';
  return value.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (!part || typeof part !== 'object') return [];
    for (const key of ['text', 'output_text', 'content']) {
      if (typeof part[key] === 'string') return [part[key]];
    }
    return [];
  }).join('\n');
}

export function searchableEvidence(content) {
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object') return content;
    for (const candidate of [value.output, value.text, textParts(value.content)]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
  } catch {}
  return content;
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(tmp, file);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

export class EvidenceVault {
  constructor(root) {
    this.root = path.resolve(root);
    this.blobs = path.join(this.root, 'blobs');
    this.meta = path.join(this.root, 'meta');
  }

  async init() {
    await mkdir(this.blobs, { recursive: true });
    await mkdir(this.meta, { recursive: true });
    return this;
  }

  async put(content, metadata = {}) {
    if (typeof content !== 'string') throw new TypeError('Evidence content must be text');
    await this.init();
    const hash = digest(content);
    const blobFile = path.join(this.blobs, `${hash}.txt`);
    const metaFile = path.join(this.meta, `${hash}.json`);
    try {
      await readFile(blobFile, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await atomicWrite(blobFile, content);
    }
    const record = {
      sha256: hash,
      bytes: Buffer.byteLength(content, 'utf8'),
      createdAt: new Date().toISOString(),
      ...metadata,
    };
    try {
      await readFile(metaFile, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await atomicWrite(metaFile, `${JSON.stringify(record, null, 2)}\n`);
    }
    return `${HANDLE_PREFIX}${hash}`;
  }

  async get(handle) {
    const hash = parseHandle(handle);
    const content = await readFile(path.join(this.blobs, `${hash}.txt`), 'utf8');
    if (digest(content) !== hash) throw new Error(`Evidence integrity failure: ${handle}`);
    return content;
  }

  async metadata(handle) {
    const hash = parseHandle(handle);
    return JSON.parse(await readFile(path.join(this.meta, `${hash}.json`), 'utf8'));
  }

  async slice(handle, { startLine = 1, lines = 80 } = {}) {
    if (!Number.isInteger(startLine) || startLine < 1) throw new Error('startLine must be a positive integer');
    if (!Number.isInteger(lines) || lines < 1 || lines > 500) throw new Error('lines must be an integer from 1 to 500');
    const content = searchableEvidence(await this.get(handle));
    const all = content.split(/\r?\n/);
    return all.slice(startLine - 1, startLine - 1 + lines)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n');
  }

  async find(handle, pattern, { max = 20, context = 1 } = {}) {
    if (typeof pattern !== 'string' || !pattern) throw new Error('A non-empty evidence pattern is required');
    if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error('max must be an integer from 1 to 100');
    if (!Number.isInteger(context) || context < 0 || context > 10) throw new Error('context must be an integer from 0 to 10');
    const content = searchableEvidence(await this.get(handle));
    const all = content.split(/\r?\n/);
    const needle = pattern.toLowerCase();
    const ranges = [];
    let matches = 0;
    for (let index = 0; index < all.length && matches < max; index += 1) {
      if (!all[index].toLowerCase().includes(needle)) continue;
      matches += 1;
      ranges.push([Math.max(0, index - context), Math.min(all.length - 1, index + context)]);
    }
    const selected = new Set();
    for (const [start, end] of ranges) for (let index = start; index <= end; index += 1) selected.add(index);
    const body = [...selected].sort((a, b) => a - b).map((index) => `${index + 1}: ${all[index]}`);
    if (!body.length) return `No evidence lines matched: ${pattern}`;
    return [`Matches shown: ${matches}${matches === max ? ' (limit reached)' : ''}`, ...body].join('\n');
  }
}
