import { tokenCount } from './tokenizer.mjs';

const DIAGNOSTIC = /\b(error|failed|failure|fatal|warning|warn|panic|exception|denied|timeout|passed|tests?|summary)\b/i;

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

function dedupe(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function classifyCommand(command) {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return 'generic';
  if (/\b(cat|type|get-content|read)\b/.test(cmd)) return 'exact';
  if (/\b(pytest|jest|vitest|cargo test|npm test|pnpm test|dotnet test|go test|rspec|phpunit)\b/.test(cmd)) return 'test';
  if (/\b(rg|grep|findstr|select-string)\b/.test(cmd)) return 'search';
  if (/\bgit\s+(status|diff|log|show)\b/.test(cmd)) return 'git';
  if (/\b(logs?|tail)\b/.test(cmd)) return 'log';
  return 'generic';
}

function compactSearch(lines) {
  const groups = new Map();
  const other = [];
  for (const line of lines) {
    const match = /^(.+?):(\d+)(?::\d+)?:\s?(.*)$/.exec(line);
    if (!match) {
      if (DIAGNOSTIC.test(line)) other.push(line);
      continue;
    }
    const [, file, lineNo, body] = match;
    const group = groups.get(file) ?? { total: 0, samples: [] };
    group.total += 1;
    if (group.samples.length < 6) group.samples.push(`${lineNo}: ${body}`);
    groups.set(file, group);
  }
  const out = [];
  for (const [file, group] of [...groups.entries()].slice(0, 30)) {
    out.push(`${file} (${group.total} matches)`);
    out.push(...group.samples.map((sample) => `  ${sample}`));
  }
  return [...out, ...other.slice(0, 20)];
}

function compactTest(lines) {
  const diagnostics = lines.filter((line) => DIAGNOSTIC.test(line));
  return dedupe([
    ...lines.slice(0, 8),
    ...diagnostics.slice(0, 100),
    ...lines.slice(-12),
  ]);
}

function compactGeneric(lines) {
  const diagnostics = lines.filter((line) => DIAGNOSTIC.test(line));
  return dedupe([
    ...lines.slice(0, 12),
    ...diagnostics.slice(0, 60),
    ...lines.slice(-12),
  ]);
}

export async function compactToolOutput({
  command,
  output,
  evidence = output,
  evidenceFormat = 'text',
  exitCode = undefined,
  vault,
  metadata = {},
  exact = false,
  hostWrapperNote = false,
  minTokens = 384,
  minReduction = 0.25,
}) {
  const raw = output;
  const normalized = normalize(output);
  const rawTokens = tokenCount(raw);
  const kind = classifyCommand(command);
  if (exact || rawTokens < minTokens) {
    return { changed: false, text: output, rawTokens, compactTokens: rawTokens, kind };
  }

  const handle = await vault.put(evidence, {
    kind: 'tool-output',
    command,
    exitCode,
    evidenceFormat,
    ...metadata,
  });
  const lines = normalized.split('\n');
  let selected;
  if (kind === 'search') selected = compactSearch(lines);
  else if (kind === 'test') selected = compactTest(lines);
  else selected = compactGeneric(lines);

  const body = selected.join('\n');
  const receipt = [
    '[context-compiler tool receipt]',
    `execution_status: ${exitCode === 0 ? 'completed_successfully' : (Number.isInteger(exitCode) ? 'completed_with_nonzero_exit' : 'completed_status_unknown')}`,
    ...(hostWrapperNote ? [
      'codex_note: command already completed; any blocked/failed label refers only to output replacement',
    ] : []),
    `command: ${command || '<unknown>'}`,
    `exit_code: ${exitCode ?? '<unknown>'}`,
    `filter: ${kind}`,
    `raw_evidence: ${handle}`,
    `evidence_format: ${evidenceFormat}`,
    `retrieve_bounded: ncc evidence-find ${handle} <pattern>`,
    `retrieve_slice: ncc evidence-slice ${handle} --start-line <n> --lines <count>`,
    `retrieve_full_if_required: ncc evidence-get ${handle}`,
    `raw_tokens: ${rawTokens}`,
    'result:',
    body,
  ].join('\n');
  const compactTokens = tokenCount(receipt);
  if (compactTokens >= rawTokens * (1 - minReduction)) {
    return { changed: false, text: output, rawTokens, compactTokens: rawTokens, kind };
  }
  return { changed: true, text: receipt, rawTokens, compactTokens, kind, handle };
}
