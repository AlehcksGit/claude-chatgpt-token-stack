#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { migrateCodexInstallation } from './migrate-codex.mjs';
import { installCodexStack } from './install-codex-stack.mjs';
import { uninstallDesktopBridge } from './install-desktop-bridge.mjs';

const execFileAsync = promisify(execFile);
const VERSION = '0.6.2';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function findNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('npm-cli.js was not found; install Node.js with npm first');
}

async function findGlobalInstall(npmCli) {
  const result = await execFileAsync(process.execPath, [npmCli, 'prefix', '--global'], {
    windowsHide: true,
    shell: false,
  });
  const prefix = result.stdout.trim();
  if (!prefix) throw new Error('npm returned an empty global prefix');
  const cliShim = path.join(prefix, 'ncc.cmd');
  const cliModule = path.join(prefix, 'node_modules', 'native-context-compiler', 'src', 'cli.mjs');
  await access(cliShim);
  await access(cliModule);
  return { prefix, cliShim, cliModule };
}

export async function installAll({
  migrateCodex = migrateCodexInstallation,
  installStack = installCodexStack,
  restoreBridge = uninstallDesktopBridge,
} = {}) {
  if (process.platform !== 'win32') throw new Error('The all-in-one 0.6.2 installer currently supports Windows only');
  const npmCli = await findNpmCli();
  await execFileAsync(process.execPath, [npmCli, 'install', '--global', projectRoot, '--ignore-scripts', '--install-links'], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  const globalInstall = await findGlobalInstall(npmCli);
  const verification = await execFileAsync(process.execPath, [globalInstall.cliModule, '--version'], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
  });
  if (verification.stdout.trim() !== `native-context-compiler ${VERSION}`) {
    throw new Error(`Version verification failed: ${verification.stdout.trim()}`);
  }
  const migration = await migrateCodex();
  const desktopBridge = await restoreBridge();
  const stack = await installStack({
    nodePath: process.execPath,
    hookScript: path.join(path.dirname(globalInstall.cliModule), 'codex-hook.mjs'),
    enableLeanBridge: false,
  });
  if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required to write the installation receipt');
  const receiptRoot = path.join(process.env.LOCALAPPDATA, 'NativeContextCompiler');
  await mkdir(receiptRoot, { recursive: true });
  const receipt = {
    product: 'native-context-compiler',
    version: VERSION,
    installedAt: new Date().toISOString(),
    cli: 'ncc',
    cliPath: globalInstall.cliShim,
    mode: 'native-hook-stack',
    migration,
    stack,
    desktopBridge,
  };
  await writeFile(path.join(receiptRoot, 'install.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  try {
    const receipt = await installAll();
    process.stdout.write(`${JSON.stringify({ installed: true, receipt }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}
