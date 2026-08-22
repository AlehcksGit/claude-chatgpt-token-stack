import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileResponsesRequest } from './compiler.mjs';
import { createLongAgentRequests } from './scenario.mjs';
import { tokenCount, percentSaved } from './tokenizer.mjs';
import { EvidenceVault } from './vault.mjs';

function requestTokens(request) {
  return tokenCount({ instructions: request.instructions, input: request.input, tools: request.tools });
}

export async function runBenchmark({ turns = 91, maxInputTokens = 12000, keepVault = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-compiler-bench-'));
  const vault = await new EvidenceVault(path.join(root, 'vault')).init();
  const requests = createLongAgentRequests(turns);
  let baselineTokens = 0;
  let compiledTokens = 0;
  let compactedOutputs = 0;
  let maxCompiled = 0;
  let allWithinBudget = true;
  let allPairsValid = true;
  let latestUsersPreserved = true;
  const handles = new Set();

  try {
    for (const request of requests) {
      baselineTokens += requestTokens(request);
      const beforeLatest = [...request.input].reverse().find((item) => item.role === 'user');
      const compiled = await compileResponsesRequest(request, {
        vault,
        maxInputTokens,
        recentTokens: 6200,
        checkpointTokens: 1500,
        maxTools: 5,
        aggressive: true,
      });
      compiledTokens += compiled.report.compiledTokens;
      compactedOutputs += compiled.report.toolOutputsCompacted;
      maxCompiled = Math.max(maxCompiled, compiled.report.compiledTokens);
      allWithinBudget &&= compiled.report.withinBudget;
      allPairsValid &&= compiled.report.toolPairsValid;
      const afterLatest = [...compiled.request.input].reverse().find((item) => item.role === 'user');
      latestUsersPreserved &&= JSON.stringify(beforeLatest) === JSON.stringify(afterLatest);
      for (const receipt of compiled.receipts) if (receipt.handle) handles.add(receipt.handle);
    }

    let evidenceRoundTrips = true;
    for (const handle of handles) {
      const content = await vault.get(handle);
      evidenceRoundTrips &&= typeof content === 'string' && content.length > 0;
    }

    const observedSession = {
      responses: 91,
      rawBaselineInput: 13032951,
      rawOutput: 50412,
      cacheWeightedInput: 1842184.4,
      outputWeighted: 403296,
    };
    const averageCompiledInput = compiledTokens / turns;
    const sameTurnsRawOptimized = averageCompiledInput * observedSession.responses + observedSession.rawOutput;
    const sameTurnsRawBaseline = observedSession.rawBaselineInput + observedSession.rawOutput;
    const checkpointTurns = 15;
    const outputWeight = observedSession.outputWeighted / observedSession.rawOutput;
    const projectedCheckpointTotal = averageCompiledInput * checkpointTurns
      + (observedSession.rawOutput / observedSession.responses) * checkpointTurns * outputWeight;
    const observedEffectiveTotal = observedSession.cacheWeightedInput + observedSession.outputWeighted;

    return {
      fixture: 'long-agent-responses-v1',
      turns,
      baselineTokens,
      compiledTokens,
      savedTokens: baselineTokens - compiledTokens,
      savedPercent: percentSaved(baselineTokens, compiledTokens),
      averageBaselineTokens: baselineTokens / turns,
      averageCompiledTokens: compiledTokens / turns,
      maxCompiledTokens: maxCompiled,
      maxInputTokens,
      compactedOutputs,
      uniqueEvidenceObjects: handles.size,
      gates: {
        atLeast80PercentSaved: percentSaved(baselineTokens, compiledTokens) >= 80,
        allWithinBudget,
        allToolPairsValid: allPairsValid,
        latestUsersByteExact: latestUsersPreserved,
        evidenceRoundTrips,
      },
      projections: {
        note: 'Design-envelope projections using measured session totals; not live quality results.',
        observedSession,
        same91CallsRawSavedPercent: percentSaved(sameTurnsRawBaseline, sameTurnsRawOptimized),
        fifteenCheckpointTurnsEffectiveSavedPercent: percentSaved(observedEffectiveTotal, projectedCheckpointTotal),
        projectedCheckpointTotal,
      },
      vaultRoot: keepVault ? root : undefined,
    };
  } finally {
    if (!keepVault) await rm(root, { recursive: true, force: true });
  }
}
