function toolName(tool) {
  return tool?.name ?? tool?.function?.name ?? '';
}

function toolDescription(tool) {
  return tool?.description ?? tool?.function?.description ?? '';
}

function words(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
}

export const EVIDENCE_TOOL = {
  type: 'function',
  name: 'evidence_get',
  description: 'Retrieve exact stored PostToolUse evidence by a context-compiler SHA-256 handle.',
  parameters: {
    type: 'object',
    properties: { handle: { type: 'string' } },
    required: ['handle'],
    additionalProperties: false,
  },
};

export const CAPABILITY_TOOL = {
  type: 'function',
  name: 'capabilities_search',
  description: 'Search tool capabilities not loaded into this bounded request.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
};

export function routeTools(tools = [], query = '', required = [], maxTools = 6, includeLocalTools = true) {
  const queryWords = words(query);
  const requiredSet = new Set(required);
  const builtInNames = new Set([EVIDENCE_TOOL.name, CAPABILITY_TOOL.name]);
  const scored = tools.filter((tool) => !builtInNames.has(toolName(tool))).map((tool, index) => {
    const name = toolName(tool);
    const haystack = words(`${name} ${toolDescription(tool)}`);
    let score = requiredSet.has(name) ? 1000 : 0;
    for (const word of queryWords) if (haystack.has(word)) score += 1;
    return { tool, name, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = scored.slice(0, Math.max(0, maxTools)).map((x) => x.tool);
  const omitted = scored.slice(Math.max(0, maxTools)).map((x) => ({
    name: x.name,
    description: toolDescription(x.tool).slice(0, 240),
  }));
  return {
    selected: includeLocalTools ? [...selected, EVIDENCE_TOOL, CAPABILITY_TOOL] : selected,
    omitted,
  };
}

export function nameOfTool(tool) {
  return toolName(tool);
}
