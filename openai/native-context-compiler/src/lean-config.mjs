const DISABLED_CAPABILITIES = Object.freeze([
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'current_time_reminder',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'multi_agent_v2',
  'plugins',
  'remote_plugin',
  'skill_search',
  'tool_suggest',
  'view_image',
  'workspace_dependencies',
]);

function featureMap(enabled = []) {
  const features = Object.fromEntries(DISABLED_CAPABILITIES.map((name) => [name, false]));
  for (const name of enabled) features[name] = true;
  return features;
}

export function leanCodexConfig(profile = 'answer') {
  if (profile === 'answer') {
    return {
      features: {
        ...featureMap(),
        code_mode: false,
        code_mode_only: false,
        shell_tool: false,
        unified_exec: false,
      },
    };
  }
  if (profile === 'workspace') {
    return {
      features: {
        ...featureMap(['shell_tool', 'unified_exec']),
        code_mode: false,
        code_mode_only: false,
      },
    };
  }
  throw new Error(`Unknown lean Codex profile: ${profile}`);
}
