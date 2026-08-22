/**
 * warpd - a fixed-port, long-lived adaptation of pxpipe 0.13.2
 * `src/warp/index.ts` (MIT; see LICENSE.pxpipe).
 *
 * pxpipe's own `warp` binds a random port and lives only as long as the one child
 * process it spawns. The Claude desktop app spawns its engine itself, so nothing can
 * wrap it - but the engine does honor HTTPS_PROXY + NODE_EXTRA_CA_CERTS. warpd runs
 * the same CONNECT proxy (ca.ts / connect.ts / route.ts / der.ts are copied from
 * pxpipe 0.13.2 src/warp with TypeScript import-suffix changes) on a stable port so
 * those two env vars can be supplied through ~/.claude/settings.json `env`, which is
 * scoped to Claude Code processes only.
 *
 * Behaviour (unchanged from warp): only api.anthropic.com is TLS-terminated, and only
 * /v1/messages* on it is diverted into the local pxpipe proxy; every other path on that
 * host is re-originated untouched, WebSocket upgrades are spliced raw, and every other
 * host is a blind TCP tunnel. Loopback clients only. Nothing is added to the Windows
 * certificate store: the CA lives at ~/.pxpipe/warp-ca.pem and is trusted only by
 * processes that are handed NODE_EXTRA_CA_CERTS.
 *
 * Added on top of warp (this file only, the vendored files are untouched):
 *   - fail-open: pxpipe is probed every 2 s; while it is down the divert route is
 *     removed, so api.anthropic.com is blind-tunneled and Claude keeps working
 *     (uncompressed) instead of getting 502s. The route comes back only while the
 *     same controller-verified pxpipe identity owns the listener again.
 *   - no in-process respawn: process replacement belongs to the receipt-aware
 *     controller, which restarts pxpipe and warpd together with a fresh identity.
 *   - GET http://127.0.0.1:47822/healthz -> JSON status (used by `pxpipe-ctl doctor`).
 *
 * Run:  node --experimental-transform-types warpd.ts
 * Env:  PXPIPE_WARP_PORT (default 47822)   PXPIPE_PORT (pxpipe proxy, default 47821)
 *       PXPIPE_EXPECTED_PID + PXPIPE_EXPECTED_START_TICKS (Windows) or
 *       PXPIPE_EXPECTED_START_ID (Unix), supplied by the owning controller.
 */
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CertificateAuthority } from './ca.ts';
import { createWarpHandlers } from './connect.ts';
import { parseRoute, routeDestination, type Route } from './route.ts';

const port = Number(process.env.PXPIPE_WARP_PORT ?? 47822);
const pxpipePort = Number(process.env.PXPIPE_PORT ?? 47821);
const expectedPxpipePid = Number(process.env.PXPIPE_EXPECTED_PID || 0);
const expectedPxpipeStartTicks = process.env.PXPIPE_EXPECTED_START_TICKS || '';
const expectedPxpipeStartId = process.env.PXPIPE_EXPECTED_START_ID || '';
const instanceNonce = process.env.CTS_INSTANCE_NONCE || '';
const home = join(homedir(), '.pxpipe');

const PROBE_MS = 2000;
const PROBE_TIMEOUT_MS = 700;

const divertRoute = parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${pxpipePort}`);
// Mutable on purpose: connect.ts consults this array per request, so emptying it is
// the fail-open switch (no route -> host is not intercepted -> blind tunnel).
// Start in passthrough. The divert route is installed only after the listener
// and its immutable process identity have both been verified.
const routes: Route[] = [];
const ca = CertificateAuthority.loadOrCreate(home);

const log = (msg: string): void => console.error(`[warpd] ${msg}`);

if (instanceNonce && !/^[0-9a-f]{32}$/.test(instanceNonce)) {
  throw new Error('CTS_INSTANCE_NONCE must be a 128-bit lowercase hex value');
}
if (expectedPxpipePid && (!Number.isSafeInteger(expectedPxpipePid) || expectedPxpipePid <= 0)) {
  throw new Error('PXPIPE_EXPECTED_PID is invalid');
}
if (expectedPxpipePid && process.platform === 'win32' && !/^\d+$/.test(expectedPxpipeStartTicks)) {
  throw new Error('PXPIPE_EXPECTED_START_TICKS is required with PXPIPE_EXPECTED_PID on Windows');
}
if (expectedPxpipePid && process.platform !== 'win32' && !/^(proc|ps):[^\r\n]+$/.test(expectedPxpipeStartId)) {
  throw new Error('PXPIPE_EXPECTED_START_ID is required with PXPIPE_EXPECTED_PID on Unix');
}

// ---- pxpipe liveness + fail-open ------------------------------------------------
const started = Date.now();
let pxpipeUp: boolean | null = null; // null until the first probe answers
let lastChange = new Date().toISOString();

const setUp = (up: boolean, why: string): void => {
  if (up === pxpipeUp) return;
  pxpipeUp = up;
  lastChange = new Date().toISOString();
  if (up) {
    if (routes.length === 0) routes.push(divertRoute);
    log(`pxpipe UP (${why}) - diverting /v1/messages -> ${routeDestination(divertRoute)}`);
  } else {
    routes.length = 0;
    log(`pxpipe DOWN (${why}) - fail-open: api.anthropic.com passes through untouched`);
  }
};

const tcpProbe = (): Promise<'up' | 'refused' | 'other'> =>
  new Promise((resolve) => {
    const s = netConnect({ host: '127.0.0.1', port: pxpipePort });
    const done = (r: 'up' | 'refused' | 'other') => { s.destroy(); resolve(r); };
    s.setTimeout(PROBE_TIMEOUT_MS, () => done('other'));
    s.once('connect', () => done('up'));
    s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'other'));
  });

const verifyExpectedProcess = (): Promise<boolean> => new Promise((resolve) => {
  if (!expectedPxpipePid) { resolve(false); return; }
  if (process.platform === 'linux') {
    try {
      const statText = readFileSync(`/proc/${expectedPxpipePid}/stat`, 'utf8');
      const close = statText.lastIndexOf(')');
      if (close < 0) { resolve(false); return; }
      const fields = statText.slice(close + 2).trim().split(/\s+/);
      resolve(expectedPxpipeStartId === `proc:${fields[19] ?? ''}`);
    } catch { resolve(false); }
    return;
  }
  if (process.platform === 'darwin') {
    execFile('/bin/ps', ['-ww', '-p', String(expectedPxpipePid), '-o', 'lstart='],
      { timeout: 3000, windowsHide: true }, (err, stdout) => {
        resolve(!err && expectedPxpipeStartId === `ps:${stdout.trim()}`);
      });
    return;
  }
  if (process.platform !== 'win32') { resolve(false); return; }
  const script = `(Get-Process -Id ${expectedPxpipePid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 3000, windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.trim() === expectedPxpipeStartTicks);
    });
});

const verifyLinuxListenerOwner = async (): Promise<'up' | 'refused' | 'other'> => {
  try {
    const expectedLocal = `0100007F:${pxpipePort.toString(16).toUpperCase().padStart(4, '0')}`;
    const listenerInodes = new Set<string>();
    for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text = '';
      try { text = readFileSync(table, 'utf8'); } catch { continue; }
      for (const line of text.split(/\r?\n/).slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length >= 10 && fields[1] === expectedLocal && fields[3] === '0A') listenerInodes.add(fields[9]);
      }
    }
    if (listenerInodes.size === 0) return 'refused';
    const ownedInodes = new Set<string>();
    for (const fd of readdirSync(`/proc/${expectedPxpipePid}/fd`)) {
      try {
        const target = readlinkSync(`/proc/${expectedPxpipePid}/fd/${fd}`);
        const match = target.match(/^socket:\[(\d+)\]$/);
        if (match) ownedInodes.add(match[1]);
      } catch { /* descriptors may close while enumerating */ }
    }
    if ([...listenerInodes].some((inode) => !ownedInodes.has(inode))) return 'other';
    return (await verifyExpectedProcess()) ? 'up' : 'other';
  } catch { return 'other'; }
};

const verifyDarwinListenerOwner = (): Promise<'up' | 'refused' | 'other'> => new Promise((resolve) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP@127.0.0.1:${pxpipePort}`, '-sTCP:LISTEN', '-Fpn'],
    { timeout: 3000, windowsHide: true, maxBuffer: 1e6 }, async (err, stdout) => {
      const owners = new Set<number>();
      for (const line of stdout.split(/\r?\n/)) if (/^p\d+$/.test(line)) owners.add(Number(line.slice(1)));
      if (owners.size === 0) { resolve(err ? 'other' : 'refused'); return; }
      if (owners.size !== 1 || !owners.has(expectedPxpipePid)) { resolve('other'); return; }
      resolve((await verifyExpectedProcess()) ? 'up' : 'other');
    });
});

const verifyListenerOwner = (): Promise<'up' | 'refused' | 'other'> => new Promise((resolve) => {
  // An open port is never identity. Controllers must pass their verified proxy
  // PID + immutable start token; without both, warpd remains in passthrough.
  if (!expectedPxpipePid) { void tcpProbe().then((value) => resolve(value === 'refused' ? 'refused' : 'other')); return; }
  if (process.platform === 'linux') { void verifyLinuxListenerOwner().then(resolve); return; }
  if (process.platform === 'darwin') { void verifyDarwinListenerOwner().then(resolve); return; }
  if (process.platform !== 'win32') { resolve('other'); return; }
  execFile('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 3000, windowsHide: true, maxBuffer: 4e6 }, async (err, stdout) => {
    if (err) { resolve('other'); return; }
    const owners = new Set<number>();
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP' || parts[3].toUpperCase() !== 'LISTENING') continue;
      const local = parts[1];
      const match = local.match(/^(127\.0\.0\.1|\[::1\]|::1):(\d+)$/i);
      if (match && Number(match[2]) === pxpipePort) owners.add(Number(parts[4]));
    }
    if (owners.size === 0) { resolve('refused'); return; }
    if (owners.size !== 1 || !owners.has(expectedPxpipePid)) { resolve('other'); return; }
    resolve((await verifyExpectedProcess()) ? 'up' : 'other');
  });
});

const probe = (): Promise<'up' | 'refused' | 'other'> => verifyListenerOwner();

const tick = async (): Promise<void> => {
  const r = await probe();
  // Listener identity is authorization. Any mismatch or inability to prove it
  // removes diversion on the first probe; transient inspection failures prefer
  // provider passthrough over sending decrypted traffic to an untrusted port.
  if (r === 'up') setUp(true, 'verified listener owner');
  else setUp(false, r === 'refused' ? 'connection refused' : 'listener identity unverified');
};
setInterval(() => { void tick(); }, PROBE_MS).unref();
void tick();

// ---- HTTP surface --------------------------------------------------------------
const handlers = createWarpHandlers({
  routes,
  ca,
  onDivert: (host, path, target) => log(`divert ${host}${path} -> ${target}`),
});

const health = (req: IncomingMessage, res: ServerResponse): boolean => {
  const u = (req.url ?? '').split('?')[0];
  if (u !== '/healthz' && u !== '/healthz/') return false;
  if (instanceNonce && req.headers.authorization !== `Bearer ${instanceNonce}`) {
    res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return true;
  }
  const body = {
    ok: true,
    instance_nonce: instanceNonce || null,
    warpd: 'up',
    warp_port: port,
    pxpipe: pxpipeUp === null ? 'unknown' : pxpipeUp ? 'up' : 'down',
    pxpipe_port: pxpipePort,
    mode: routes.length ? 'divert' : 'passthrough',
    last_change: lastChange,
    uptime_s: Math.round((Date.now() - started) / 1000),
    ca: ca.certPath,
  };
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
};

const server = createServer((req, res) => {
  if (health(req, res)) return;
  handlers.handleAbsoluteForm(req, res);
});
server.on('connect', handlers.handleConnect);
server.on('error', (err) => {
  log(`listener failed: ${(err as Error).message}`);
  process.exit(1);
});

// Same tolerance as pxpipe warp: a dropped socket is not a daemon failure.
const NET_ERRNO = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENETDOWN', 'ENOTCONN', 'EAI_AGAIN', 'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END', 'ERR_SOCKET_CONNECTION_TIMEOUT',
]);
const tolerate = (err: unknown): void => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && NET_ERRNO.has(code)) {
    log(`connection error ${code} (continuing)`);
    return;
  }
  log(`fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
};
process.on('uncaughtException', tolerate);
process.on('unhandledRejection', tolerate);

server.listen(port, '127.0.0.1', () => {
  log(`route ${divertRoute.pattern} -> ${routeDestination(divertRoute)} (active only while pxpipe answers on ${pxpipePort})`);
  log(`CA ${ca.certPath}`);
  log('process replacement is controller-owned; warpd never spawns or kills pxpipe');
  log(`listening http://127.0.0.1:${port} (loopback only)  health: /healthz`);
});
