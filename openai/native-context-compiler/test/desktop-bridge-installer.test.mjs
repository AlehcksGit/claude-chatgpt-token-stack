import assert from 'node:assert/strict';
import test from 'node:test';
import { previousEnvironmentForInstall } from '../scripts/install-desktop-bridge.mjs';

test('desktop bridge reinstall preserves the pre-project environment value', () => {
  const prior = {
    launcher: 'C:\\Users\\test\\AppData\\Local\\NativeContextCompiler\\desktop-bridge\\ncc-codex-bridge.exe',
    previousEnvironment: { exists: true, type: 'REG_SZ', value: 'C:\\Tools\\custom-codex.exe' },
  };
  const current = { exists: true, type: 'REG_SZ', value: prior.launcher.toUpperCase() };
  assert.deepEqual(previousEnvironmentForInstall(prior, current), prior.previousEnvironment);
});

test('desktop bridge install records a user-owned current value', () => {
  const current = { exists: true, type: 'REG_EXPAND_SZ', value: 'C:\\Tools\\custom-codex.exe' };
  assert.equal(previousEnvironmentForInstall(null, current), current);
});
