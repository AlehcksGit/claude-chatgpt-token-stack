const ZERO_ADDED_CALLS = Object.freeze({
  modelCallsAdded: 0,
  compactionCallsAdded: 0,
  usageBilledCallsAdded: 0,
});

function passthroughReasons(report) {
  const reasons = [];
  if (report?.needsOpaqueCompactionBoundary) reasons.push('opaque_compaction_boundary_required');
  if (report?.withinBudget === false) reasons.push('compiled_request_over_budget');
  if (report?.toolPairsValid === false) reasons.push('invalid_tool_pairing');
  if (report?.qualityRisk) reasons.push('quality_risk');
  return reasons;
}

function accounting() {
  return { ...ZERO_ADDED_CALLS };
}

export class NativeContextCompiler {
  constructor({ runtime } = {}) {
    if (!runtime || typeof runtime.compile !== 'function') {
      throw new Error('NativeContextCompiler requires a local context runtime');
    }
    this.runtime = runtime;
  }

  async compileRequest(request, options = {}) {
    const original = structuredClone(request);
    try {
      const compiled = await this.runtime.compile(original, options);
      const reasons = passthroughReasons(compiled.report);
      if (reasons.length) {
        return {
          mode: 'passthrough',
          reasons,
          request: original,
          report: compiled.report,
          receipts: [],
          accounting: accounting(),
        };
      }
      return {
        mode: 'compiled',
        reasons: [],
        request: compiled.request,
        report: compiled.report,
        receipts: compiled.receipts ?? [],
        accounting: accounting(),
      };
    } catch (error) {
      return {
        mode: 'passthrough',
        reasons: ['local_compile_error'],
        request: original,
        report: null,
        receipts: [],
        error: {
          code: 'local_compile_error',
          message: error instanceof Error ? error.message : String(error),
        },
        accounting: accounting(),
      };
    }
  }

  async invokeLocalOperation(name, argumentsValue) {
    if (!['evidence_get', 'capabilities_search'].includes(name)) {
      throw new Error(`Unsupported native compiler operation: ${name}`);
    }
    return this.runtime.invokeLocalTool(name, argumentsValue);
  }
}
