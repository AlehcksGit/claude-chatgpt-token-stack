import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settingsPath as defaultSettingsPath } from './paths.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 3,
  enabled: true,
  surface: 'chatgpt-work-local-only',
  preToolUse: {
    enabled: true,
    rtk: true,
    rtkCommand: 'rtk',
    ultraCompact: false,
  },
  postToolUse: {
    enabled: true,
    minTokens: 800,
    minReduction: 0.35,
  },
  compaction: {
    reinforceAfterCompact: true,
  },
  turnBudget: {
    enabled: true,
    routineMaxWords: 180,
    progressMaxWords: 40,
  },
  leanBridge: {
    enabled: false,
    profile: 'workspace',
    nativePrefix: '!native',
    seedMaxMessages: 200,
    timeoutMs: 240000,
    failMode: 'native',
  },
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeSettings(value) {
  const source = object(value);
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    preToolUse: { ...DEFAULT_SETTINGS.preToolUse, ...object(source.preToolUse) },
    postToolUse: { ...DEFAULT_SETTINGS.postToolUse, ...object(source.postToolUse) },
    compaction: { ...DEFAULT_SETTINGS.compaction, ...object(source.compaction) },
    turnBudget: { ...DEFAULT_SETTINGS.turnBudget, ...object(source.turnBudget) },
    leanBridge: { ...DEFAULT_SETTINGS.leanBridge, ...object(source.leanBridge) },
  };
}

export async function readSettings(file = defaultSettingsPath()) {
  try {
    return mergeSettings(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return mergeSettings();
    throw error;
  }
}

export async function ensureSettings(file = defaultSettingsPath()) {
  let exists = true;
  try { await readFile(file, 'utf8'); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    exists = false;
  }
  if (!exists) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  }
  return readSettings(file);
}

export async function updateSettings(update, file = defaultSettingsPath()) {
  const current = await readSettings(file);
  const next = mergeSettings(typeof update === 'function' ? update(current) : update);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return next;
}
