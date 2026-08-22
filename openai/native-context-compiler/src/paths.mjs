import os from 'node:os';
import path from 'node:path';

export function dataRoot(env = process.env) {
  if (env.NCC_DATA_ROOT) return path.resolve(env.NCC_DATA_ROOT);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'NativeContextCompiler');
  if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, 'native-context-compiler');
  return path.join(os.homedir(), '.local', 'share', 'native-context-compiler');
}

export function vaultRoot(env = process.env) {
  return path.join(dataRoot(env), 'vault');
}

export function leanMetricsPath(env = process.env) {
  return path.join(dataRoot(env), 'lean-turn-metrics.jsonl');
}

export function wholeTurnEvalPath(env = process.env) {
  return path.join(dataRoot(env), 'whole-turn-evals.jsonl');
}

export function hookMetricsPath(env = process.env) {
  return path.join(dataRoot(env), 'hook-metrics.jsonl');
}

export function hookEvalPath(env = process.env) {
  return path.join(dataRoot(env), 'hook-evals.jsonl');
}

export function hookHealthPath(event, env = process.env) {
  const name = String(event ?? 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return path.join(dataRoot(env), `hook-health-${name}.json`);
}

export function hookErrorPath(env = process.env) {
  return path.join(dataRoot(env), 'hook-errors.jsonl');
}

export function settingsPath(env = process.env) {
  return path.join(dataRoot(env), 'settings.json');
}

export function bridgeContextPath(env = process.env) {
  return path.join(dataRoot(env), 'bridge-turn-context.json');
}

export function bridgeMessagesPath(env = process.env) {
  return path.join(dataRoot(env), 'bridge-messages.jsonl');
}

export function desktopBridgeRoot(env = process.env) {
  return path.join(dataRoot(env), 'desktop-bridge');
}
