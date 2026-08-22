import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { desktopBridgeRoot } from '../src/paths.mjs';

const execFileAsync = promisify(execFile);
const ENVIRONMENT_KEY = 'HKCU\\Environment';
const ENVIRONMENT_NAME = 'CODEX_CLI_PATH';

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

export async function readUserEnvironment(name = ENVIRONMENT_NAME) {
  try {
    const result = await execFileAsync('reg.exe', ['query', ENVIRONMENT_KEY, '/v', name], { windowsHide: true, shell: false });
    const match = result.stdout.match(new RegExp(`^\\s*${name}\\s+(REG_[A-Z_]+)\\s+(.*)$`, 'mi'));
    return match ? { exists: true, type: match[1], value: match[2].trim() } : { exists: false, type: null, value: null };
  } catch (error) {
    if (error?.code === 1) return { exists: false, type: null, value: null };
    throw error;
  }
}

async function writeUserEnvironment(value, { name = ENVIRONMENT_NAME, type = 'REG_SZ' } = {}) {
  await execFileAsync('reg.exe', ['add', ENVIRONMENT_KEY, '/v', name, '/t', type, '/d', value, '/f'], { windowsHide: true, shell: false });
}

async function deleteUserEnvironment(name = ENVIRONMENT_NAME) {
  try {
    await execFileAsync('reg.exe', ['delete', ENVIRONMENT_KEY, '/v', name, '/f'], { windowsHide: true, shell: false });
  } catch (error) {
    if (error?.code !== 1) throw error;
  }
}

async function broadcastEnvironmentChange() {
  const script = [
    'Add-Type -Namespace NCC -Name Native -MemberDefinition',
    "'[DllImport(\"user32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'",
    '$result = [UIntPtr]::Zero',
    '[void][NCC.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result)',
  ].join('; ');
  const shell = process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!shell) return;
  try { await execFileAsync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, shell: false }); }
  catch {}
}

async function findCompiler() {
  if (!process.env.SystemRoot) throw new Error('SystemRoot is required to locate the Windows C# compiler');
  const candidates = [
    path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error('The built-in Windows .NET Framework C# compiler was not found');
}

export function previousEnvironmentForInstall(priorReceipt, currentEnvironment) {
  const reinstallingOwnedBridge = Boolean(
    priorReceipt?.launcher
    && currentEnvironment?.exists
    && path.resolve(currentEnvironment.value).toLowerCase() === path.resolve(priorReceipt.launcher).toLowerCase()
  );
  return reinstallingOwnedBridge
    ? priorReceipt.previousEnvironment ?? { exists: false, type: null, value: null }
    : currentEnvironment;
}

export async function installDesktopBridge({
  nodePath = process.execPath,
  proxyScript,
  outputRoot = desktopBridgeRoot(),
  setEnvironment = true,
} = {}) {
  if (process.platform !== 'win32') throw new Error('The seamless desktop bridge currently supports Windows only');
  if (!path.isAbsolute(nodePath ?? '')) throw new Error('An absolute Node.js path is required');
  if (!path.isAbsolute(proxyScript ?? '')) throw new Error('An absolute proxy script path is required');
  await access(nodePath);
  await access(proxyScript);
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop-bridge', 'BridgeLauncher.cs');
  const compiler = await findCompiler();
  await mkdir(outputRoot, { recursive: true });
  const launcher = path.join(outputRoot, 'ncc-codex-bridge.exe');
  const config = path.join(outputRoot, 'launcher.conf');
  const receiptFile = path.join(outputRoot, 'desktop-bridge.json');
  const priorReceiptSource = await readOptional(receiptFile);
  let priorReceipt = null;
  try { priorReceipt = priorReceiptSource ? JSON.parse(priorReceiptSource) : null; } catch {}
  await execFileAsync(compiler, ['/nologo', '/target:winexe', '/optimize+', `/out:${launcher}`, source], {
    windowsHide: true,
    shell: false,
  });
  await writeFile(config, `${nodePath}\n${proxyScript}\n`, 'utf8');
  const verification = await execFileAsync(launcher, ['--version'], { windowsHide: true, shell: false, timeout: 30000 });
  if (!verification.stdout.trim().startsWith('codex-cli ')) {
    throw new Error(`Desktop bridge verification failed: ${verification.stdout.trim() || 'no version output'}`);
  }
  const currentEnvironment = await readUserEnvironment();
  const previousEnvironment = previousEnvironmentForInstall(priorReceipt, currentEnvironment);
  const receipt = {
    installedAt: new Date().toISOString(),
    launcher,
    config,
    nodePath,
    proxyScript,
    codexVersion: verification.stdout.trim(),
    previousEnvironment,
    restartRequired: true,
    sourceOnlyBuild: true,
  };
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  if (setEnvironment) {
    await writeUserEnvironment(launcher);
    await broadcastEnvironmentChange();
  }
  return receipt;
}

export async function uninstallDesktopBridge({ outputRoot = desktopBridgeRoot() } = {}) {
  const receiptFile = path.join(outputRoot, 'desktop-bridge.json');
  const source = await readOptional(receiptFile);
  if (!source) return { restored: false, reason: 'desktop_bridge_receipt_missing' };
  const receipt = JSON.parse(source);
  const current = await readUserEnvironment();
  if (!current.exists || path.resolve(current.value).toLowerCase() !== path.resolve(receipt.launcher).toLowerCase()) {
    return { restored: false, reason: 'environment_changed_by_user', current };
  }
  const previous = receipt.previousEnvironment;
  if (previous?.exists) await writeUserEnvironment(previous.value, { type: previous.type || 'REG_SZ' });
  else await deleteUserEnvironment();
  await broadcastEnvironmentChange();
  return { restored: true, previous: previous ?? { exists: false } };
}
