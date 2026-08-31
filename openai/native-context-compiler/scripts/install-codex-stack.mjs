import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { removeLegacyNccHooks } from './migrate-codex.mjs';
import { dataRoot, settingsPath as defaultSettingsPath } from '../src/paths.mjs';
import { ensureSettings, updateSettings } from '../src/settings.mjs';

export const AGENTS_START = '<!-- native-context-compiler:work-efficiency:start -->';
export const AGENTS_END = '<!-- native-context-compiler:work-efficiency:end -->';

export const WORK_AGENTS_BLOCK = `${AGENTS_START}
For local ChatGPT Work/Codex tasks, keep routine progress and final answers concise. Use narrow, bounded tool queries. Prefer \`rtk <command>\` for supported shell commands; the Native Context Compiler PreToolUse hook also rewrites native Bash calls automatically. Do not bypass the reduction stack. When a receipt contains an evidence handle, retrieve only what is needed with \`ncc evidence-find\` or \`ncc evidence-slice\`; use full \`ncc evidence-get\` only when the complete stored hook input is required. Preserve decisions, blockers, verification results, and the user's requested detail across compaction.
${AGENTS_END}`;

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function handler({ nodePath, hookScript, statusMessage, additionalContextLimit, timeout = 15 }) {
  const value = {
    type: 'command',
    command: `${quote(nodePath)} ${quote(hookScript)}`,
    commandWindows: `node.exe ${quote(hookScript)}`,
    timeout,
    statusMessage,
  };
  if (Number.isInteger(additionalContextLimit)) value.additionalContextLimit = additionalContextLimit;
  return value;
}

export function buildCodexHookGroups({ nodePath, hookScript, enableLeanBridge = false }) {
  return {
    PreToolUse: [{
      matcher: 'Bash',
      hooks: [handler({ nodePath, hookScript, statusMessage: 'Optimizing supported command output' })],
    }],
    PostToolUse: [{
      matcher: '*',
      hooks: [handler({ nodePath, hookScript, statusMessage: 'Reducing oversized tool output' })],
    }],
    SessionStart: [{
      matcher: 'compact',
      hooks: [handler({ nodePath, hookScript, statusMessage: 'Restoring efficiency guidance', additionalContextLimit: 300 })],
    }],
    UserPromptSubmit: [{
      hooks: [handler({
        nodePath,
        hookScript,
        statusMessage: enableLeanBridge ? 'Running the local Lean Bridge' : 'Applying a lightweight turn budget',
        timeout: enableLeanBridge ? 240 : 5,
      })],
    }],
  };
}

export function mergeCodexHooks(existing, groups) {
  if (!object(existing)) throw new Error('Codex hooks.json must contain a JSON object');
  const next = removeLegacyNccHooks(existing).document;
  if (next.hooks != null && !object(next.hooks)) throw new Error('Codex hooks must be an object; existing file preserved');
  if (!object(next.hooks)) next.hooks = {};
  for (const [event, additions] of Object.entries(groups)) {
    if (next.hooks[event] != null && !Array.isArray(next.hooks[event])) throw new Error(`Codex ${event} hooks must be an array; existing file preserved`);
    const current = next.hooks[event] ?? [];
    next.hooks[event] = [...current, ...additions];
  }
  if (!next.description) next.description = 'User lifecycle hooks.';
  return next;
}

export function installAgentsBlock(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const pattern = new RegExp(`\\n?${AGENTS_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${AGENTS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
  const preserved = source.replace(pattern, '\n').trimEnd();
  return `${preserved ? `${preserved}\n\n` : ''}${WORK_AGENTS_BLOCK}\n`;
}

export function removeAgentsBlock(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const pattern = new RegExp(`\\n?${AGENTS_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${AGENTS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
  return source.replace(pattern, '\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd() + (source ? '\n' : '');
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

async function backUp(file, backupRoot) {
  if (await readOptional(file) === null) return null;
  await mkdir(backupRoot, { recursive: true });
  const destination = path.join(backupRoot, path.basename(file));
  await copyFile(file, destination);
  return destination;
}

export async function installCodexStack({
  nodePath = process.execPath,
  hookScript,
  userProfile = process.env.USERPROFILE ?? '',
  codexHome = path.join(userProfile, '.codex'),
  backupRoot = path.join(dataRoot(), 'backups', `install-${new Date().toISOString().replaceAll(':', '-')}`),
  settingsFile = defaultSettingsPath(),
  enableLeanBridge = false,
} = {}) {
  if (!path.isAbsolute(hookScript ?? '')) throw new Error('An absolute Codex hook script path is required');
  if (!path.isAbsolute(codexHome)) throw new Error('An absolute CODEX_HOME path is required');
  await access(nodePath);
  await access(hookScript);
  await mkdir(codexHome, { recursive: true });

  const backups = [];
  const hookFile = path.join(codexHome, 'hooks.json');
  const hookText = await readOptional(hookFile);
  const merged = mergeCodexHooks(hookText ? JSON.parse(hookText) : {}, buildCodexHookGroups({ nodePath, hookScript, enableLeanBridge }));
  const nextHookText = `${JSON.stringify(merged, null, 2)}\n`;
  if (nextHookText !== hookText) {
    const backup = await backUp(hookFile, backupRoot);
    if (backup) backups.push(backup);
    await atomicWrite(hookFile, nextHookText);
  }

  const agentsFile = path.join(codexHome, 'AGENTS.md');
  const agentsText = await readOptional(agentsFile);
  const nextAgentsText = installAgentsBlock(agentsText ?? '');
  if (nextAgentsText !== agentsText) {
    const backup = await backUp(agentsFile, backupRoot);
    if (backup) backups.push(backup);
    await atomicWrite(agentsFile, nextAgentsText);
  }

  await ensureSettings(settingsFile);
  const settings = await updateSettings((current) => ({
    ...current,
    schemaVersion: 3,
    enabled: true,
    preToolUse: { ...current.preToolUse, enabled: true, rtk: true },
    postToolUse: { ...current.postToolUse, enabled: true },
    compaction: { ...current.compaction, reinforceAfterCompact: true },
    turnBudget: { ...current.turnBudget, enabled: true },
    leanBridge: {
      ...current.leanBridge,
      enabled: Boolean(enableLeanBridge),
      failMode: 'native',
    },
  }), settingsFile);
  return {
    hookFile,
    hookScript,
    agentsFile,
    settings,
    trustRequired: true,
    events: ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit'],
    backups,
  };
}
