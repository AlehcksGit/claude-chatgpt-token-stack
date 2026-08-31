import { describe, expect, it } from 'vitest';
import { stripVariantTags, trimTrailingSlashes } from '../src/core/safe-text.js';
import { chatCompletionsUrl } from '../src/core/messages-chat-bridge.js';
import { extractEnvFields } from '../src/core/transform.js';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { createServer, request, type Server } from 'node:http';
import { createWarpHandlers as upstreamHandlers } from '../src/warp/connect.js';
import { createWarpHandlers as installedHandlers } from '../../../stack/bin/lib/warpd/connect.ts';

describe('release security hardening', () => {
  for (const [name, factory] of [['vendored', upstreamHandlers], ['installed', installedHandlers]] as const) {
    it(`${name} proxy safely forwards special header names on both hops`, async () => {
      const upstream = createServer((req, res) => {
        res.setHeader('constructor', 'response-marker');
        res.end(JSON.stringify({ value: req.headers['constructor'], custom: req.headers['x-test'], protoHeader: Object.hasOwn(req.headers, '__proto__') }));
      });
      const handlers = factory({ routes: [], ca: {} as never });
      const proxy = createServer(handlers.handleAbsoluteForm);
      const listen = (server: Server) => new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as {port: number}).port));
      });
      try {
        const upstreamPort = await listen(upstream);
        const proxyPort = await listen(proxy);
        const headers = Object.create(null);
        headers['__proto__'] = 'request-marker';
        headers['constructor'] = 'request-marker';
        headers['x-test'] = 'ordinary-header';
        await new Promise<void>((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port: proxyPort, path: `http://127.0.0.1:${upstreamPort}/`, headers, agent: false }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try {
                expect(res.headers['constructor']).toBe('response-marker');
                expect(JSON.parse(body)).toEqual({ value: 'request-marker', custom: 'ordinary-header', protoHeader: false });
                resolve();
              } catch (error) { reject(error); }
            });
          });
          req.on('error', reject);
          req.setTimeout(5000, () => req.destroy(new Error('proxy timed out')));
          req.end();
        });
      } finally {
        for (const server of [proxy, upstream]) {
          server.closeAllConnections();
          if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    });
  }
  it('preserves bracket-tag semantics, including unmatched and nested brackets', () => {
    for (const value of ['', 'gpt-5[1m]', 'a[x]b[y]c', '[[x]tail', 'a[[[', 'x]y[z]']) {
      expect(stripVariantTags(value)).toBe(value.replace(/\[[^\]]*\]/g, ''));
    }
  });
  it('normalizes upstream URLs without changing endpoint construction', () => {
    expect(trimTrailingSlashes('https://host///')).toBe('https://host');
    expect(chatCompletionsUrl('https://host/v1///')).toBe('https://host/v1/chat/completions');
    expect(chatCompletionsUrl('https://host/v1/chat/completions///')).toBe('https://host/v1/chat/completions');
    expect(trimTrailingSlashes('///x')).toBe('///x');
  });
  it('extracts environment fields with blank lines and keeps branch precedence', () => {
    expect(extractEnvFields('<env>\n\n Working directory: /example path \n Is directory a git repo: Yes\n Platform: win32\n OS Version: test os\n Today\'s date: 2026-08-31\n</env>\nCurrent branch: secondary\n\n On branch main')).toMatchObject({ cwd: '/example path', isGitRepo: true, platform: 'win32', osVersion: 'test os', today: '2026-08-31', gitBranch: 'main' });
  });
  it('finishes hostile input within a bounded worker, without hanging the test runner', async () => {
    const safeSource = readFileSync(fileURLToPath(new URL('../src/core/safe-text.ts', import.meta.url)), 'utf8');
    const envSource = readFileSync(fileURLToPath(new URL('../src/core/transform.ts', import.meta.url)), 'utf8');
    const start = envSource.indexOf('function firstTagBody(');
    const end = envSource.indexOf('/** Strip the per-turn', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const transformed = transformSync(safeSource + '\n' + envSource.slice(start, end), { loader: 'ts', format: 'cjs' }).code;
    const body = `const { parentPort } = require('node:worker_threads');
      ${transformed}
      const brackets = '['.repeat(500000);
      if (module.exports.stripVariantTags(brackets) !== brackets) throw Error('unmatched input changed');
      if (module.exports.trimTrailingSlashes('/'.repeat(500000) + 'x').length !== 500001) throw Error('URL changed');
      if (module.exports.extractEnvFields('<env>' + '\\n'.repeat(500000) + '</env>').gitBranch !== undefined) throw Error('unexpected branch');
      parentPort.postMessage('done');`;
    const worker = new Worker(body, { eval: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('long input stalled')), 5000);
        worker.once('message', () => { clearTimeout(timer); resolve(); });
        worker.once('error', (err) => { clearTimeout(timer); reject(err); });
      });
    } finally { await worker.terminate(); }
  }, 10000);
});
