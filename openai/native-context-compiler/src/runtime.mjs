import path from 'node:path';
import { compileResponsesRequest } from './compiler.mjs';
import { executeTaskGraph } from './task-graph.mjs';
import { EvidenceVault } from './vault.mjs';

function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try { return JSON.parse(value); } catch { return {}; }
}

export class ContextRuntime {
  constructor({ vaultRoot = '.context-vault', compiler = {} } = {}) {
    this.vault = new EvidenceVault(path.resolve(vaultRoot));
    this.compilerOptions = compiler;
    this.capabilityIndex = [];
    this.pinnedCapabilities = new Set();
  }

  async init() {
    await this.vault.init();
    return this;
  }

  async compile(request, options = {}) {
    await this.init();
    const result = await compileResponsesRequest(request, {
      ...this.compilerOptions,
      ...options,
      vault: this.vault,
      requiredTools: [...this.pinnedCapabilities, ...(options.requiredTools ?? [])],
    });
    this.capabilityIndex = result.capabilityIndex;
    return result;
  }

  async invokeLocalTool(name, rawArguments) {
    const args = parseArguments(rawArguments);
    if (name === 'evidence_get') {
      if (typeof args.handle !== 'string') throw new Error('evidence_get requires handle');
      return { handle: args.handle, content: await this.vault.get(args.handle) };
    }
    if (name === 'capabilities_search') {
      const words = new Set(String(args.query ?? '').toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
      const results = this.capabilityIndex.map((entry) => {
        const text = `${entry.name} ${entry.description}`.toLowerCase();
        let score = 0;
        for (const word of words) if (text.includes(word)) score += 1;
        return { ...entry, score };
      }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 12);
      for (const entry of results.slice(0, 3)) this.pinnedCapabilities.add(entry.name);
      return { results };
    }
    throw new Error(`Unsupported local runtime tool: ${name}`);
  }

  async executeGraph(graph, executor) {
    return executeTaskGraph(graph, executor);
  }
}
