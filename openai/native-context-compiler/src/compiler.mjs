import { buildCheckpoint, textOfItem } from './checkpoint.mjs';
import { compactToolOutput } from './filters.mjs';
import { tokenCount, percentSaved } from './tokenizer.mjs';
import { callCommand, callKey, itemType, outputText, pairToolItems, replaceOutputText, validateToolPairs } from './wire.mjs';
import { nameOfTool, routeTools } from './tools.mjs';

function requestTokens(request) {
  return tokenCount({
    instructions: request.instructions,
    input: request.input,
    tools: request.tools,
  });
}

function latestUserText(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'user') return textOfItem(items[index]);
  }
  return '';
}

function latestCompactionIndex(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (['compaction', 'context_compaction'].includes(items[index]?.type)) return index;
  }
  return -1;
}

function tailWithinBudget(items, budget) {
  const out = [];
  let used = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const cost = tokenCount(items[index]);
    if (out.length > 0 && used + cost > budget) break;
    out.unshift(items[index]);
    used += cost;
  }
  let validation = validateToolPairs(out);
  while (!validation.valid) {
    const indices = [...new Set(validation.unresolved.map((entry) => entry.index))].sort((a, b) => b - a);
    for (const index of indices) out.splice(index, 1);
    validation = validateToolPairs(out);
  }
  return out;
}

function removePairAwareAt(items, index) {
  const target = items[index];
  const type = itemType(target);
  const key = callKey(target);
  if (!key || !['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(type)) {
    items.splice(index, 1);
    return 1;
  }
  let removed = 0;
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (callKey(items[at]) === key && ['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(itemType(items[at]))) {
      items.splice(at, 1);
      removed += 1;
    }
  }
  return removed;
}

export async function compileResponsesRequest(request, {
  vault,
  maxInputTokens = 12000,
  recentTokens = 6500,
  checkpointTokens = 1800,
  maxTools = 6,
  includeLocalTools = true,
  requiredTools = [],
  aggressive = false,
} = {}) {
  if (!vault) throw new Error('compileResponsesRequest requires an evidence vault');
  if (!Array.isArray(request.input)) throw new Error('Responses request input must be an array');

  const original = structuredClone(request);
  const next = structuredClone(request);
  const receipts = [];
  const pairing = pairToolItems(next.input);
  for (const pair of pairing.pairs) {
    const raw = outputText(pair.output);
    if (!raw) continue;
    const command = callCommand(pair.call);
    const result = await compactToolOutput({ command, output: raw, vault });
    if (!result.changed) continue;
    next.input[pair.outputIndex] = replaceOutputText(pair.output, result.text);
    receipts.push({ ...result, key: pair.key, command });
  }

  const compactionIndex = latestCompactionIndex(next.input);
  let pruned = 0;
  let qualityRisk = false;
  let needsOpaqueCompactionBoundary = false;
  if (compactionIndex >= 0) {
    pruned = compactionIndex;
    next.input = next.input.slice(compactionIndex);
  } else {
    const opaqueOld = next.input.slice(0, -4).some((item) => item?.type === 'reasoning' && item?.encrypted_content);
    if (opaqueOld && !aggressive) {
      qualityRisk = false;
      needsOpaqueCompactionBoundary = true;
    } else {
      qualityRisk = opaqueOld;
      const tail = tailWithinBudget(next.input, recentTokens);
      const oldCount = next.input.length - tail.length;
      if (oldCount > 0) {
        const checkpoint = buildCheckpoint(next.input.slice(0, oldCount), receipts, checkpointTokens);
        next.input = [checkpoint, ...tail];
        pruned = oldCount;
      }
    }
  }

  const query = latestUserText(next.input);
  const required = [
    ...pairing.pairs.map((pair) => pair.call?.name).filter(Boolean),
    ...requiredTools,
  ];
  const routed = routeTools(next.tools ?? [], query, required, maxTools, includeLocalTools);
  next.tools = routed.selected;

  while (!needsOpaqueCompactionBoundary && requestTokens(next) > maxInputTokens && next.input.length > 2) {
    const removable = next.input.findIndex((item, index) => index < next.input.length - 2
      && item?.role !== 'developer'
      && !['compaction', 'context_compaction'].includes(item?.type));
    if (removable < 0) break;
    pruned += removePairAwareAt(next.input, removable);
  }

  const baselineTokens = requestTokens(original);
  const compiledTokens = requestTokens(next);
  const validation = validateToolPairs(next.input);
  const warnings = [];
  if (pairing.unresolved.length) warnings.push(`${pairing.unresolved.length} unresolved original tool items`);
  if (!validation.valid) warnings.push(`${validation.unresolved.length} unresolved compiled tool items`);
  if (qualityRisk) warnings.push('Aggressive mode pruned encrypted reasoning without a genuine opaque compaction boundary');
  if (needsOpaqueCompactionBoundary) warnings.push('A genuine opaque compaction boundary is required before encrypted reasoning can be pruned safely');
  if (compiledTokens > maxInputTokens) warnings.push('Request could not be reduced below budget without removing protected state');

  return {
    request: next,
    capabilityIndex: routed.omitted,
    receipts,
    report: {
      baselineTokens,
      compiledTokens,
      savedTokens: baselineTokens - compiledTokens,
      savedPercent: percentSaved(baselineTokens, compiledTokens),
      maxInputTokens,
      withinBudget: compiledTokens <= maxInputTokens,
      toolOutputsCompacted: receipts.length,
      itemsPruned: pruned,
      toolPairsValid: validation.valid,
      qualityRisk,
      needsOpaqueCompactionBoundary,
      warnings,
      loadedTools: (next.tools ?? []).map(nameOfTool),
      omittedTools: routed.omitted.length,
    },
  };
}
