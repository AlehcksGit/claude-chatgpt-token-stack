import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataRoot } from '../src/paths.mjs';

const LEGACY_HOOK_MARKER = 'codex-hook.mjs';
const execFileAsync = promisify(execFile);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function groupContainsLegacyNccHook(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((hook) => (
    String(hook?.command ?? '').includes(LEGACY_HOOK_MARKER)
      || String(hook?.commandWindows ?? '').includes(LEGACY_HOOK_MARKER)
  ));
}

export function removeLegacyNccHooks(document) {
  if (!isObject(document)) throw new Error('Codex hooks.json must contain a JSON object');
  const next = structuredClone(document);
  if (!isObject(next.hooks)) return { document: next, removed: 0 };
  let removed = 0;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.flatMap((group) => {
      if (!groupContainsLegacyNccHook(group)) return [group];
      const hooks = group.hooks.filter((hook) => !groupContainsLegacyNccHook({ hooks: [hook] }));
      removed += group.hooks.length - hooks.length;
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    next.hooks[event] = kept;
  }
  return { document: next, removed };
}

export function stripLegacyCodexConfig(text) {
  return String(text)
    .replace(/# claude-chatgpt-token-stack:native-model-provider:start[\s\S]*?# claude-chatgpt-token-stack:native-model-provider:end\r?\n*/g, '')
    .replace(/# claude-chatgpt-token-stack:native-provider-table:start[\s\S]*?# claude-chatgpt-token-stack:native-provider-table:end\r?\n*/g, '')
    .replace(/^\[plugins\."claude-chatgpt-token-stack@personal"\]\r?\nenabled\s*=\s*true\r?\n\r?\n?/m, '')
    .replace(/^\s+/, '');
}

export function stripCodexRtkInstructions(text) {
  return String(text)
    .replace(/\r?\n?<!-- openai-token-stack:rtk:start -->[\s\S]*?<!-- openai-token-stack:rtk:end -->\r?\n?/g, '\n')
    .replace(/\s+$/, '\n');
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

async function backUp(file, backupRoot) {
  const source = await readOptional(file);
  if (source === null) return null;
  await mkdir(backupRoot, { recursive: true });
  const destination = path.join(backupRoot, path.basename(file));
  await copyFile(file, destination);
  return destination;
}

export async function retireLegacyCodexTask({
  backupRoot,
  run = execFileAsync,
  taskName = '\\ClaudeChatGPTTokenStack\\CodexProxy',
} = {}) {
  if (process.platform !== 'win32') return { taskName, removed: false, reason: 'not-windows' };
  let queried;
  try {
    queried = await run('schtasks.exe', ['/Query', '/TN', taskName, '/XML'], {
      windowsHide: true,
      shell: false,
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    if (/cannot find|does not exist/i.test(`${error?.message ?? ''}\n${error?.stderr ?? ''}`)) {
      return { taskName, removed: false, reason: 'not-installed' };
    }
    return { taskName, removed: false, reason: 'query-unavailable',
      warning: 'Legacy task inventory was unavailable; no scheduled task was changed.' };
  }
  await mkdir(backupRoot, { recursive: true });
  const backup = path.join(backupRoot, 'ClaudeChatGPTTokenStack-CodexProxy.xml');
  await writeFile(backup, queried.stdout);
  return { taskName, removed: false, backup, reason: 'ownership-unverified',
    warning: 'A legacy-named task was preserved. Review the backed-up task action before disabling or deleting it.' };
}

export async function migrateCodexInstallation({
  userProfile = process.env.USERPROFILE ?? '',
  codexHome = path.join(userProfile, '.codex'),
  backupRoot = path.join(dataRoot(), 'backups', new Date().toISOString().replaceAll(':', '-')),
  retireTask = retireLegacyCodexTask,
} = {}) {
  if (!path.isAbsolute(codexHome)) throw new Error('An absolute CODEX_HOME path is required');
  await mkdir(codexHome, { recursive: true });

  const backups = [];
  const hookFile = path.join(codexHome, 'hooks.json');
  const hookText = await readOptional(hookFile);
  let legacyHooksRemoved = 0;
  if (hookText !== null) {
    const result = removeLegacyNccHooks(JSON.parse(hookText));
    legacyHooksRemoved = result.removed;
    if (legacyHooksRemoved) {
      backups.push(await backUp(hookFile, backupRoot));
      await atomicWrite(hookFile, `${JSON.stringify(result.document, null, 2)}\n`);
    }
  }

  const configFile = path.join(codexHome, 'config.toml');
  const configText = await readOptional(configFile);
  let legacyProviderRemoved = false;
  if (configText !== null) {
    const migrated = stripLegacyCodexConfig(configText);
    if (migrated !== configText) {
      backups.push(await backUp(configFile, backupRoot));
      await atomicWrite(configFile, migrated);
      legacyProviderRemoved = true;
    }
  }

  const agentsFile = path.join(codexHome, 'AGENTS.md');
  const agentsText = await readOptional(agentsFile);
  let rtkInstructionsRemoved = false;
  if (agentsText !== null) {
    const migrated = stripCodexRtkInstructions(agentsText);
    if (migrated !== agentsText) {
      backups.push(await backUp(agentsFile, backupRoot));
      await atomicWrite(agentsFile, migrated);
      rtkInstructionsRemoved = true;
    }
  }

  const rtkReference = path.join(codexHome, 'openai-token-stack-RTK.md');
  const rtkReferenceText = await readOptional(rtkReference);
  if (rtkReferenceText !== null) {
    backups.push(await backUp(rtkReference, backupRoot));
    await rm(rtkReference);
  }

  const retiredLaunchers = [];
  const localBin = path.join(userProfile, '.local', 'bin');
  for (const name of ['codex-px.cmd', 'codex-px.ps1']) {
    const file = path.join(localBin, name);
    const launcherText = await readOptional(file);
    if (launcherText !== null && /(?:\.openai-token-stack|claude-chatgpt-token-stack)/i.test(launcherText)) {
      const backup = await backUp(file, backupRoot);
      await rm(file);
      retiredLaunchers.push({ file, backup });
      backups.push(backup);
    }
  }

  const legacyTask = await retireTask({ backupRoot });
  return {
    mode: 'native-work-stack',
    legacyHooksRemoved,
    legacyProviderRemoved,
    rtkInstructionsRemoved,
    rtkReferenceRemoved: rtkReferenceText !== null,
    retiredLaunchers,
    legacyTask,
    backups: backups.filter(Boolean),
  };
}
