/**
 * warpd - a fixed-port, long-lived variant of `pxpipe warp`.
 *
 * pxpipe's own `warp` binds a random port and lives only as long as the one child
 * process it spawns. The Claude desktop app spawns its engine itself, so nothing can
 * wrap it - but the engine does honor HTTPS_PROXY + NODE_EXTRA_CA_CERTS. warpd runs
 * the very same CONNECT proxy (ca.ts / connect.ts / route.ts / der.ts are vendored
 * verbatim from pxpipe 0.13.1 src/warp, MIT - see LICENSE.pxpipe) on a stable port so
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
 *     (uncompressed) instead of getting 502s. The route comes back when pxpipe does.
 *   - supervisor: if PXPIPE_CLI points at pxpipe's cli.js, warpd respawns pxpipe when
 *     it dies (exponential backoff, 1 s .. 30 s), logging to PXPIPE_LOG_OUT/_ERR.
 *   - GET http://127.0.0.1:47822/healthz -> JSON status (used by `pxpipe-ctl doctor`).
 *
 * Run:  node --experimental-transform-types warpd.ts
 * Env:  PXPIPE_WARP_PORT (default 47822)   PXPIPE_PORT (pxpipe proxy, default 47821)
 *       PXPIPE_CLI (path to pxpipe-proxy/bin/cli.js; enables the supervisor)
 *       PXPIPE_LOG_OUT / PXPIPE_LOG_ERR (child log files, default ~/.pxpipe/proxy*.log)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CertificateAuthority } from './ca.ts';
import { createWarpHandlers } from './connect.ts';
import { parseRoute, routeDestination, type Route } from './route.ts';

const port = Number(process.env.PXPIPE_WARP_PORT ?? 47822);
const pxpipePort = Number(process.env.PXPIPE_PORT ?? 47821);
const pxpipeCli = process.env.PXPIPE_CLI || '';
const home = join(homedir(), '.pxpipe');
const childOut = process.env.PXPIPE_LOG_OUT || join(home, 'proxy.log');
const childErr = process.env.PXPIPE_LOG_ERR || join(home, 'proxy.err.log');

const PROBE_MS = 2000;
const PROBE_TIMEOUT_MS = 700;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const STABLE_MS = 60000; // child alive this long -> backoff resets

const divertRoute = parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${pxpipePort}`);
// Mutable on purpose: connect.ts consults this array per request, so emptying it is
// the fail-open switch (no route -> host is not intercepted -> blind tunnel).
const routes: Route[] = [divertRoute];
const ca = CertificateAuthority.loadOrCreate(home);

const log = (msg: string): void => console.error(`[warpd] ${msg}`);

// ---- pxpipe liveness + fail-open ------------------------------------------------
const started = Date.now();
let pxpipeUp: boolean | null = null; // null until the first probe answers
let softFailures = 0;
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

const probe = (): Promise<'up' | 'refused' | 'other'> =>
  new Promise((resolve) => {
    const s = netConnect({ host: '127.0.0.1', port: pxpipePort });
    const done = (r: 'up' | 'refused' | 'other') => { s.destroy(); resolve(r); };
    s.setTimeout(PROBE_TIMEOUT_MS, () => done('other'));
    s.once('connect', () => done('up'));
    s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'other'));
  });

// ---- supervisor ----------------------------------------------------------------
let child: ChildProcess | null = null;
let childBorn = 0;
let restarts = 0;
let backoffN = 0;
let nextSpawnAt = 0;

const spawnPxpipe = (): void => {
  const out = openSync(childOut, 'a');
  const err = openSync(childErr, 'a');
  const c = spawn(process.execPath, [pxpipeCli], {
    env: { ...process.env, PORT: String(pxpipePort) },
    stdio: ['ignore', out, err],
    windowsHide: true,
  });
  child = c;
  childBorn = Date.now();
  restarts += 1;
  log(`supervisor: spawned pxpipe (pid ${c.pid}, attempt ${restarts})`);
  c.once('exit', (code, signal) => {
    if (child === c) child = null;
    const lived = Date.now() - childBorn;
    if (lived >= STABLE_MS) backoffN = 0; else backoffN += 1;
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** backoffN, BACKOFF_MAX_MS);
    nextSpawnAt = Date.now() + delay;
    log(`supervisor: pxpipe exited (code ${code ?? '-'} signal ${signal ?? '-'}) after ${Math.round(lived / 1000)} s; retry in ${delay / 1000} s`);
  });
  c.once('error', (e) => log(`supervisor: spawn failed: ${e.message}`));
};

const tick = async (): Promise<void> => {
  const r = await probe();
  if (r === 'up') { softFailures = 0; setUp(true, 'probe ok'); }
  else if (r === 'refused') { softFailures = 0; setUp(false, 'connection refused'); }
  else if (++softFailures >= 3) setUp(false, `probe ${r} x${softFailures}`);

  if (!pxpipeCli || pxpipeUp !== false || child) return;
  if (Date.now() < nextSpawnAt) return;
  spawnPxpipe();
};
setInterval(() => { void tick(); }, PROBE_MS).unref();
void tick();

process.on('exit', () => { if (child && !child.killed) child.kill(); });

// ---- HTTP surface --------------------------------------------------------------
const handlers = createWarpHandlers({
  routes,
  ca,
  onDivert: (host, path, target) => log(`divert ${host}${path} -> ${target}`),
});

const health = (req: IncomingMessage, res: ServerResponse): boolean => {
  const u = (req.url ?? '').split('?')[0];
  if (u !== '/healthz' && u !== '/healthz/') return false;
  const body = {
    ok: true,
    warpd: 'up',
    warp_port: port,
    pxpipe: pxpipeUp === null ? 'unknown' : pxpipeUp ? 'up' : 'down',
    pxpipe_port: pxpipePort,
    mode: routes.length ? 'divert' : 'passthrough',
    supervise: Boolean(pxpipeCli),
    child_pid: child?.pid ?? null,
    restarts,
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
  log(`supervisor ${pxpipeCli ? `ON (${pxpipeCli})` : 'off (set PXPIPE_CLI to enable)'}`);
  log(`listening http://127.0.0.1:${port} (loopback only)  health: /healthz`);
});
