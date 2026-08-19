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
 * Run:  node --experimental-transform-types warpd.ts
 * Env:  PXPIPE_WARP_PORT (default 47822)   PXPIPE_PORT (pxpipe proxy, default 47821)
 */
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CertificateAuthority } from './ca.ts';
import { createWarpHandlers } from './connect.ts';
import { parseRoute, routeDestination } from './route.ts';

const port = Number(process.env.PXPIPE_WARP_PORT ?? 47822);
const pxpipePort = Number(process.env.PXPIPE_PORT ?? 47821);

const routes = [parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${pxpipePort}`)];
const ca = CertificateAuthority.loadOrCreate(join(homedir(), '.pxpipe'));

const handlers = createWarpHandlers({
  routes,
  ca,
  onDivert: (host, path, target) => console.error(`[warpd] divert ${host}${path} -> ${target}`),
});

const server = createServer(handlers.handleAbsoluteForm);
server.on('connect', handlers.handleConnect);
server.on('error', (err) => {
  console.error(`[warpd] listener failed: ${(err as Error).message}`);
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
    console.error(`[warpd] connection error ${code} (continuing)`);
    return;
  }
  console.error(`[warpd] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
};
process.on('uncaughtException', tolerate);
process.on('unhandledRejection', tolerate);

server.listen(port, '127.0.0.1', () => {
  for (const route of routes) console.error(`[warpd] route ${route.pattern} -> ${routeDestination(route)}`);
  console.error(`[warpd] CA ${ca.certPath}`);
  console.error(`[warpd] listening http://127.0.0.1:${port} (loopback only)`);
});
