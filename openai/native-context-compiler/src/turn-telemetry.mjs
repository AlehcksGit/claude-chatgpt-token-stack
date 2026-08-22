import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function appendRow(file, row) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function recordLeanTurn(file, result) {
  const history = result.history ?? {};
  await appendRow(file, {
    at: new Date().toISOString(),
    kind: 'lean_turn',
    model: result.model,
    effort: result.effort,
    profile: result.profile,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    reasoningOutputTokens: result.usage?.reasoningOutputTokens ?? 0,
    totalTokens: result.usage?.totalTokens ?? 0,
    toolCalls: result.toolCalls ?? 0,
    historyMode: history.mode ?? 'unknown',
    historyBaselineTokens: history.baselineTokens ?? 0,
    historyCompiledTokens: history.compiledTokens ?? 0,
    historySavedPercent: history.savedPercent ?? 0,
  });
}
export async function recordWholeTurnEvaluation(file, result, { profile = 'standard' } = {}) {
  const baselineTotal = result.baseline.usage.totalTokens;
  const optimizedTotal = result.optimized.usage.totalTokens;
  const baselineInput = result.baseline.usage.inputTokens;
  const optimizedInput = result.optimized.usage.inputTokens;
  await appendRow(file, {
    at: new Date().toISOString(),
    kind: 'whole_turn_ab',
    profile,
    model: result.model,
    effort: result.effort,
    qualityExact: result.baseline.quality.perfect && result.optimized.quality.perfect,
    localBaselineTokens: result.localReduction.baselineTokens,
    localCompiledTokens: result.localReduction.compiledTokens,
    baselineInputTokens: baselineInput,
    optimizedInputTokens: optimizedInput,
    inputSavedTokens: baselineInput - optimizedInput,
    inputSavedPercent: baselineInput ? 100 * (baselineInput - optimizedInput) / baselineInput : 0,
    baselineTotalTokens: baselineTotal,
    optimizedTotalTokens: optimizedTotal,
    totalSavedTokens: baselineTotal - optimizedTotal,
    totalSavedPercent: baselineTotal ? 100 * (baselineTotal - optimizedTotal) / baselineTotal : 0,
  });
}
