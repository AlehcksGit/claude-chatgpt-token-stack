#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dataRoot } from '../src/paths.mjs';
import { removeLegacyNccHooks } from './migrate-codex.mjs';
import { removeAgentsBlock } from './install-codex-stack.mjs';
import { uninstallDesktopBridge } from './install-desktop-bridge.mjs';

const execFileAsync = promisify(execFile);

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(file, text) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}
export function removeCompilerHook(document) {
  return removeLegacyNccHooks(document);
}
async function findNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw new Error('npm-cli.js was not found; remove native-context-compiler with npm when npm is available');
}

export async function uninstallAll({ removePackage = true } = {}) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error('USERPROFILE or HOME is required');
  const hooksFile = path.join(home, '.codex', 'hooks.json');
  const source = await readOptional(hooksFile);
  let hookRemoved = 0, backup = null;
  if (source !== null) {
    const result = removeCompilerHook(JSON.parse(source));
    hookRemoved = result.removed;
    if (hookRemoved) {
      const backupRoot = path.join(dataRoot(), 'backups', `uninstall-${new Date().toISOString().replaceAll(':', '-')}`);
      await mkdir(backupRoot, { recursive: true });
      backup = path.join(backupRoot, 'hooks.json');
      await copyFile(hooksFile, backup);
      await atomicWrite(hooksFile, `${JSON.stringify(result.document, null, 2)}\n`);
    }
  }
  const agentsFile = path.join(home, '.codex', 'AGENTS.md');
  const agentsSource = await readOptional(agentsFile);
  let agentsBlockRemoved = false;
  let agentsBackup = null;
  if (agentsSource !== null) {
    const next = removeAgentsBlock(agentsSource);
    if (next !== agentsSource) {
      const backupRoot = path.join(dataRoot(), 'backups', `uninstall-${new Date().toISOString().replaceAll(':', '-')}`);
      await mkdir(backupRoot, { recursive: true });
      agentsBackup = path.join(backupRoot, 'AGENTS.md');
      await copyFile(agentsFile, agentsBackup);
      await atomicWrite(agentsFile, next);
      agentsBlockRemoved = true;
    }
  }
  const desktopBridge = await uninstallDesktopBridge();
  if (removePackage) {
    const npmCli = await findNpmCli();
    await execFileAsync(process.execPath, [npmCli, 'uninstall', '--global', 'native-context-compiler'], { windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 });
  }
  return { removed: true, hookRemoved, agentsBlockRemoved, desktopBridge, packageRemoved: removePackage, dataPreserved: true, backup, agentsBackup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { process.stdout.write(`${JSON.stringify(await uninstallAll(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ removed: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; }
}
