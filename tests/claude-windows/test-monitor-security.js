// AI-NOTICE: This project is licensed for individual personal use only (see LICENSE).
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const repo = path.resolve(__dirname, "..", "..");
const monitor = path.join(repo, "stack", "bin", "lib", "monitor.js");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-stack-monitor-"));
const nonce = "abcdef0123456789abcdef0123456789";
const warpNonce = "9876543210abcdef9876543210abcdef";
const sensitive = "CTS_MONITOR_SECRET_DO_NOT_RELAY";
const servers = [];
let child;

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
function request(port, target, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: target, timeout: 1500, headers }, (res) => {
      let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  });
}
async function waitFor(fn, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error(message);
}
function listen(server, port) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); servers.push(server); }); }
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (value) => `file:${sha256(Buffer.from(value, "utf8"))}`;

(async () => {
  const px = await freePort(), warp = await freePort(), combined = await freePort(), codex = await freePort();
  const pxServer = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(req.url === "/proxy-stats" ? JSON.stringify({ authorization: sensitive }) : "{}"); });
  const warpServer = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${warpNonce}`) { res.statusCode = 401; res.end("{}"); return; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ mode: "divert", pxpipe: "up", uptime_s: 3, secret: sensitive }));
  });
  await listen(pxServer, px); await listen(warpServer, warp);

  const pxDir = path.join(testRoot, ".pxpipe"); fs.mkdirSync(path.join(pxDir, "claude-token-stack"), { recursive: true });
  fs.writeFileSync(path.join(pxDir, "claude-token-stack", "daemon.env"), "PXPIPE_MODELS=claude\n");
  fs.writeFileSync(path.join(pxDir, "events.jsonl"), JSON.stringify({ path: "/v1/messages", ts: new Date().toISOString(), model: "claude-test", compressed: true, baseline_probe_status: "ok", baseline_tokens: 100, input_tokens: 50, image_count: 1, transform_ms: 4, duration_ms: 9, secret: sensitive }) + "\n");

  const claudeDir = path.join(testRoot, ".claude"); fs.mkdirSync(claudeDir, { recursive: true });
  const rules = "# Global rules (token-efficient stack: test)\n@RTK.md\n", rtkDoc = "# RTK - Rust Token Killer\nrtk gain\n";
  const rulesPath = path.join(claudeDir, "CLAUDE.md"), rtkPath = path.join(claudeDir, "RTK.md");
  fs.writeFileSync(rulesPath, rules); fs.writeFileSync(rtkPath, rtkDoc);
  fs.writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ command: "rtk hook" }] }] } }));
  const receiptDir = path.join(testRoot, ".claude-token-stack"); fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "receipt.json"), JSON.stringify({ phase: "complete", inProgress: false, artifacts: [
    { id: "rules-claude", target: rulesPath, installed: { kind: "file", hash: fileHash(rules) } },
    { id: "rules-rtk", target: rtkPath, installed: { kind: "file", hash: fileHash(rtkDoc) } },
  ] }));

  const fakeBin = path.join(testRoot, "fake-bin"); fs.mkdirSync(fakeBin, { recursive: true });
  if (process.platform === "win32") fs.writeFileSync(path.join(fakeBin, "rtk.cmd"), '@echo off\r\nif "%1"=="--version" (echo rtk 0.45.0& exit /b 0)\r\nif "%1"=="gain" (echo {"summary":{"total_commands":2,"total_saved":10,"total_input":20,"avg_savings_pct":50,"avg_time_ms":1}}& exit /b 0)\r\nexit /b 2\r\n');
  else { const file = path.join(fakeBin, "rtk"); fs.writeFileSync(file, '#!/bin/sh\n[ "$1" = "--version" ] && echo "rtk 0.45.0" && exit 0\n[ "$1" = "gain" ] && echo \'{"summary":{"total_commands":2,"total_saved":10,"total_input":20,"avg_savings_pct":50,"avg_time_ms":1}}\' && exit 0\nexit 2\n'); fs.chmodSync(file, 0o700); }

  const localAppData = path.join(testRoot, "AppData", "Local");
  const nccRoot = path.join(localAppData, "NativeContextCompiler"); fs.mkdirSync(nccRoot, { recursive: true });
  fs.writeFileSync(path.join(nccRoot, "install.json"), JSON.stringify({ product: "native-context-compiler", version: "0.6.2", mode: "native-hook-stack", migration: { legacyHooksRemoved: 2, legacyProviderRemoved: true, backup: sensitive }, secret: sensitive }));
  fs.writeFileSync(path.join(nccRoot, "settings.json"), JSON.stringify({ enabled: true, surface: "chatgpt-work-local-only", preToolUse: { rtk: true }, postToolUse: { enabled: true }, turnBudget: { enabled: true, routineMaxWords: 180, progressMaxWords: 40 }, leanBridge: { enabled: false, profile: "workspace", nativePrefix: "!native" } }));
  fs.writeFileSync(path.join(nccRoot, "hook-metrics.jsonl"), [
    JSON.stringify({ at: new Date().toISOString(), kind: "rtk_rewrite", sessionId: "live-test-session", commandFingerprint: sensitive }),
    JSON.stringify({ at: new Date().toISOString(), kind: "post_tool_compaction", sessionId: "live-test-session", toolName: "Bash", filter: "test", rawTokens: 12000, compactTokens: 300, handle: sensitive }),
    JSON.stringify({ at: new Date().toISOString(), kind: "turn_budget_context", sessionId: "live-test-session", detailed: false, contextChars: 220, promptChars: 100, prompt: sensitive }),
    JSON.stringify({ at: new Date().toISOString(), kind: "lean_bridge_turn", sessionId: "live-test-session", profile: "workspace", effort: "xhigh", totalTokens: 9000, outerModelTokens: 0, historySavedPercent: 85.3, prompt: sensitive }),
    JSON.stringify({ at: new Date().toISOString(), kind: "turn_budget_context", sessionId: "ncc-installed-probe", probe: true, detailed: false, contextChars: 999 }),
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(nccRoot, "hook-health-pretooluse.json"), JSON.stringify({ lastInvocationAt: new Date().toISOString(), sessionId: "live-test-session", changed: true }));
  fs.writeFileSync(path.join(nccRoot, "hook-health-posttooluse.json"), JSON.stringify({ lastInvocationAt: new Date().toISOString(), sessionId: "live-test-session", changed: true }));
  fs.writeFileSync(path.join(nccRoot, "hook-health-sessionstart.json"), JSON.stringify({ lastInvocationAt: new Date().toISOString(), sessionId: "ncc-installed-probe", probe: true, source: "compact" }));
  fs.writeFileSync(path.join(nccRoot, "hook-health-userpromptsubmit.json"), JSON.stringify({ lastInvocationAt: new Date().toISOString(), sessionId: "live-test-session", result: "turn_budget", detailed: false, secret: sensitive }));
  fs.writeFileSync(path.join(nccRoot, "bridge-messages.jsonl"), JSON.stringify({ op: "upsert", threadId: "test-thread", turnId: "test-turn", text: sensitive, completedAtMs: Date.now() }) + "\n");
  const codexHome = path.join(testRoot, ".codex"); fs.mkdirSync(codexHome, { recursive: true });
  const hookHandler = { type: "command", commandWindows: 'node.exe "C:\\ncc\\codex-hook.mjs"' };
  fs.writeFileSync(path.join(codexHome, "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [hookHandler] }], PostToolUse: [{ hooks: [hookHandler] }], SessionStart: [{ matcher: "compact", hooks: [hookHandler] }], UserPromptSubmit: [{ hooks: [hookHandler] }] } }));
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), '<!-- native-context-compiler:work-efficiency:start -->\nmanaged\n<!-- native-context-compiler:work-efficiency:end -->\n');
  fs.writeFileSync(path.join(nccRoot, "lean-turn-metrics.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind: "lean_turn", model: "gpt-5.6-sol", profile: "workspace", totalTokens: 8000, toolCalls: 1, historyMode: "compiled", historyBaselineTokens: 47000, historyCompiledTokens: 324, historySavedPercent: 99.3, prompt: sensitive }) + "\n");
  fs.writeFileSync(path.join(nccRoot, "whole-turn-evals.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind: "whole_turn_ab", profile: "lean", model: "gpt-5.6-sol", qualityExact: true, baselineInputTokens: 54239, optimizedInputTokens: 7846, inputSavedPercent: 85.5, baselineTotalTokens: 54375, optimizedTotalTokens: 7956, totalSavedPercent: 85.4, answer: sensitive }) + "\n");

  const safeSystemPath = process.platform === "win32" ? path.join(process.env.SystemRoot, "System32") : "/usr/bin:/bin";
  const env = { ...process.env, USERPROFILE: testRoot, HOME: testRoot, LOCALAPPDATA: localAppData, PATH: fakeBin + path.delimiter + safeSystemPath, Path: fakeBin + path.delimiter + safeSystemPath, PXPIPE_PORT: String(px), PXPIPE_WARP_PORT: String(warp), PXPIPE_MONITOR_PORT: String(combined), NCC_DASHBOARD_PORT: String(codex), CTS_INSTANCE_NONCE: nonce, CTS_WARPD_NONCE: warpNonce };
  child = spawn(process.execPath, [monitor], { cwd: testRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  const combinedPage = await waitFor(async () => { const value = await request(combined, "/", { host: `127.0.0.1:${combined}` }); return value && value.status === 200 && value; }, "combined monitor did not start");
  const codexPage = await waitFor(async () => { const value = await request(codex, "/", { host: `127.0.0.1:${codex}` }); return value && value.status === 200 && value; }, "Codex dashboard did not start");
  for (const page of [combinedPage, codexPage]) {
    assert.equal(page.headers["cache-control"], "no-store"); assert.equal(page.headers["x-frame-options"], "DENY");
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/); assert(!page.body.includes(sensitive));
    assert.match(page.body, /table-layout:fixed/); assert.match(page.body, /overflow-wrap:anywhere/); assert.match(page.body, /stack claude/); assert.match(page.body, /stack codex/);
  }
  assert.match(codexPage.body, /Codex Work token stack/); assert.match(codexPage.body, /codex-only/);

  for (const port of [combined, codex]) {
    assert.equal((await request(port, "/api/state", { host: "attacker.example" })).status, 403);
    assert.equal((await request(port, "/api/state", { host: `127.0.0.1:${port}`, origin: "https://attacker.example" })).status, 403);
    assert.equal((await request(port, "/healthz", { host: `127.0.0.1:${port}` })).status, 401);
    assert.equal((await request(port, "/healthz", { host: `127.0.0.1:${port}`, authorization: `Bearer ${nonce}` })).status, 200);
  }
  const api = await request(combined, "/api/state", { host: `127.0.0.1:${combined}` });
  assert.equal(api.status, 200); assert(!api.body.includes(sensitive));
  const state = JSON.parse(api.body);
  assert.equal(state.pxpipe.events.all.compressed, 1); assert.equal(state.verdict.rules, "green");
  assert.equal(state.codex.installed, true); assert.equal(state.codex.mode, "native-hook-stack"); assert.equal(state.codex.legacyHooksRemoved, 2);
  assert.equal(state.codex.hooks.rewrites, 1); assert.equal(state.codex.hooks.compacted, 1); assert.equal(state.codex.hooks.savedTokens, 11700); assert.equal(state.codex.hooks.bridgeTurns, 1); assert.equal(state.codex.hooks.bridgeOuterTokens, 0);
  assert.equal(state.codex.configured.PreToolUse, true); assert.equal(state.codex.configured.PostToolUse, true); assert.equal(state.codex.configured.SessionStart, true); assert.equal(state.codex.configured.UserPromptSubmit, true); assert.equal(state.codex.configured.managedGuidance, true);
  assert.equal(state.codex.bridge.messages.active, 1); assert.equal(state.codex.settings.leanBridge, false); assert.equal(state.codex.settings.turnBudget, true);
  assert.equal(state.codex.hooks.budgetContexts, 1); assert.equal(state.codex.hooks.budgetDetailed, 0);
  assert.equal(state.codex.lean.turns, 1); assert.equal(state.codex.lean.latest.historySavedPercent, 99.3);
  assert.equal(state.codex.wholeTurn.runs, 1); assert.equal(state.codex.wholeTurn.latest.totalSavedPercent, 85.4); assert.equal(state.codex.wholeTurn.latest.qualityExact, true);
  assert.equal(state.codex.runtime.recentlyObserved, 3); assert.equal(state.codex.runtime.events.preToolUse, true); assert.equal(state.codex.runtime.events.postToolUse, true); assert.equal(state.codex.runtime.events.userPromptSubmit, true); assert.equal(state.codex.runtime.events.sessionStart, false);
  assert.equal(state.verdict.codex_hooks, "live"); assert.equal(state.verdict.codex_budget, "active"); assert.equal(state.verdict.codex_lean, "disabled"); assert.deepEqual(state.monitor.ports.items.map((item) => item.port), [px, warp, combined, codex]);
  assert.equal(state.monitor.flows.codex.status, "live"); assert.equal(state.monitor.flows.codex.compacted, 1); assert.equal(state.monitor.flows.codex.budgeted, 1); assert.equal(state.monitor.flows.codex.evaluations, 1);
  console.log("PASS monitor security and dual dashboard telemetry");
})().finally(async () => {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]); }
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  const base = path.resolve(os.tmpdir()) + path.sep; if (!path.resolve(testRoot).startsWith(base)) throw new Error("unsafe cleanup path"); fs.rmSync(testRoot, { recursive: true, force: true });
}).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
