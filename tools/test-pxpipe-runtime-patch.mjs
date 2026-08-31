#!/usr/bin/env node
// Isolated supply-chain and runtime-patch test. Never touches the user's prefix.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.13.2';
const INTEGRITY = 'sha512-utMkpkWAjgQyldB62ebWrTFKhTmMKTiwXIktqbHxLixrtgw/g+r9/0nzG2Vz1prKSvH2Q7x9JNrG4LwEmlHQ+g==';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patcher = path.join(repo, 'stack', 'bin', 'lib', 'pxpipe-runtime-patch.js');
const tempBase = path.resolve(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempBase, 'cts-pxpipe-test-'));
const prefix = path.join(temp, 'prefix');
fs.mkdirSync(prefix, { mode: 0o700 });

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('npm-cli.js could not be located');
  return path.resolve(found);
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

const npm = npmCli();
const npmEnv = { ...process.env, NPM_CONFIG_PREFIX: prefix };
const runNpm = (args) => run(process.execPath, [npm, ...args], { env: npmEnv });
const runPatcher = (mode, packageRoot) => JSON.parse(run(process.execPath, [patcher, mode, packageRoot]));

try {
  const packed = JSON.parse(runNpm(['pack', `pxpipe-proxy@${VERSION}`, '--ignore-scripts', '--json', '--pack-destination', temp, '--registry=https://registry.npmjs.org/']));
  assert.equal(packed.length, 1);
  assert.equal(packed[0].name, 'pxpipe-proxy');
  assert.equal(packed[0].version, VERSION);
  assert.equal(packed[0].integrity, INTEGRITY);
  assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const archive = path.resolve(temp, packed[0].filename);
  assert.equal(path.dirname(archive), temp);
  const actualIntegrity = `sha512-${crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
  assert.equal(actualIntegrity, INTEGRITY);

  const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  assert(entries.includes('package/package.json'));
  for (const entry of entries) {
    assert.match(entry, /^package(?:\/|$)/);
    assert(!entry.includes('\\') && !entry.includes(':') && !/(^|\/)\.\.(\/|$)/.test(entry));
  }

  runNpm(['install', '--global', archive, '--ignore-scripts', '--no-audit', '--no-fund', '--install-strategy=nested']);
  const globalRoot = runNpm(['root', '--global']);
  const packageRoot = path.join(globalRoot, 'pxpipe-proxy');
  const original = runPatcher('inspect', packageRoot);
  assert.equal(original.state, 'original');
  assert.equal(original.dependencyVerified, true);

  const cli = path.join(packageRoot, 'bin', 'cli.js');
  const cliBytes = fs.readFileSync(cli);
  const protectedFile = path.join(packageRoot, 'dist', 'node.js');
  const protectedBefore = crypto.createHash('sha256').update(fs.readFileSync(protectedFile)).digest('hex');
  fs.appendFileSync(cli, '\n// deliberate test tamper\n');
  assert.throws(() => runPatcher('apply', packageRoot));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(protectedFile)).digest('hex'), protectedBefore);
  fs.writeFileSync(cli, cliBytes);

  const applied = runPatcher('apply', packageRoot);
  assert.equal(applied.state, 'patched');
  assert.equal(applied.dependencyVerified, true);
  assert.deepEqual(runPatcher('apply', packageRoot), applied);
  assert.deepEqual(runPatcher('verify', packageRoot), applied);
  assert.equal(run(process.execPath, [cli, '--version']), VERSION);

  const safeText = await import(`${pathToFileURL(path.join(packageRoot, 'dist', 'core', 'safe-text.js')).href}?test=${Date.now()}`);
  assert.equal(safeText.stripVariantTags(`${'x'.repeat(2_000_000)}[variant]tail`).endsWith('tail'), true);
  assert.equal(safeText.trimTrailingSlashes(`value${'/'.repeat(2_000_000)}`), 'value');

  const dependencyManifest = path.join(packageRoot, 'node_modules', 'gpt-tokenizer', 'package.json');
  fs.appendFileSync(dependencyManifest, ' ');
  assert.throws(() => runPatcher('verify', packageRoot));
  console.log('PASS isolated pxpipe archive, full-tree verification, runtime patch, and tamper refusal');
} finally {
  const resolved = path.resolve(temp);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('cts-pxpipe-test-')) throw new Error(`unsafe cleanup path: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}
