#!/usr/bin/env node
// claude-token-stack monitor: one local page for all three layers.
//   rtk (bash filter)  ->  rtk gain --format json
//   rules (CLAUDE.md)  ->  file presence / profile
//   pxpipe + warpd     ->  :47821 /proxy-stats + ~/.pxpipe/events.jsonl, :47822 /healthz
// Read-only. No deps. Start: pxpipe-ctl monitor   Stop: pxpipe-ctl monitor stop
// Env: PXPIPE_MONITOR_PORT (47823), PXPIPE_PORT (47821), PXPIPE_WARP_PORT (47822)
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const HOME = os.homedir();
const PORT = +(process.env.PXPIPE_MONITOR_PORT || 47823);
const PX = +(process.env.PXPIPE_PORT || 47821);
const WARP = +(process.env.PXPIPE_WARP_PORT || 47822);
const PXDIR = path.join(HOME, ".pxpipe");
const EVENTS = path.join(PXDIR, "events.jsonl");
const CLAUDE_DIR = path.join(HOME, ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const STARTED = Date.now();

function get(url, ms = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: ms }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}
function run(cmd, args, ms = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 4e6 }, (err, out) => resolve(err ? null : String(out)));
  });
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function tailBytes(p, n) {
  try {
    const st = fs.statSync(p); const fd = fs.openSync(p, "r");
    const len = Math.min(n, st.size); const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    let s = buf.toString("utf8"); if (len < st.size) s = s.slice(s.indexOf("\n") + 1);
    return { text: s, bytes: st.size };
  } catch { return { text: "", bytes: 0 }; }
}

// ---- pxpipe: per-request net savings from events.jsonl (used tokens already include the image cost) ----
function analyzeEvents() {
  const { text, bytes } = tailBytes(EVENTS, 8 * 1024 * 1024);
  const day = Date.now() - 864e5;
  const t = { n: 0, saved: 0, base: 0, used: 0, neg: 0, negTokens: 0, pass: 0, unknown: 0, transformMs: 0 };
  const d = { n: 0, saved: 0, base: 0, used: 0, neg: 0, negTokens: 0, pass: 0, unknown: 0, transformMs: 0 };
  const models = {};
  const recent = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.path && !/messages|responses|completions/.test(e.path)) continue;
    const isDay = Date.parse(e.ts) > day;
    const buckets = isDay ? [t, d] : [t];
    const used = (e.input_tokens || 0) + (e.cache_create_tokens || 0) + (e.cache_read_tokens || 0);
    const measured = e.baseline_probe_status === "ok" && typeof e.baseline_tokens === "number";
    for (const b of buckets) {
      if (!e.compressed) b.pass++;
      if (!measured) { b.unknown++; continue; }
      const s = e.baseline_tokens - used;
      b.n++; b.saved += s; b.base += e.baseline_tokens; b.used += used; b.transformMs += e.transform_ms || 0;
      if (s < 0) { b.neg++; b.negTokens += -s; }
    }
    if (measured) {
      const m = (models[e.model] ||= { n: 0, saved: 0, base: 0, neg: 0 });
      m.n++; m.saved += e.baseline_tokens - used; m.base += e.baseline_tokens; if (e.baseline_tokens < used) m.neg++;
    }
    recent.push({
      ts: e.ts, model: e.model, status: e.status, compressed: !!e.compressed, images: e.image_count || 0,
      baseline: measured ? e.baseline_tokens : null, used: measured ? used : null,
      saved_pct: measured && e.baseline_tokens ? Math.round(100 * (e.baseline_tokens - used) / e.baseline_tokens) : null,
      transform_ms: e.transform_ms || 0, duration_ms: e.duration_ms || 0, reason: e.history_reason || (e.passthrough_reasons ? Object.keys(e.passthrough_reasons).join(",") : ""),
    });
    if (recent.length > 400) recent.splice(0, recent.length - 400);
  }
  const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 0);
  const fin = (b) => ({ ...b, saved_pct: pct(b.saved, b.base), avg_transform_ms: b.n ? Math.round(b.transformMs / b.n) : 0, neg_pct: b.n ? Math.round(100 * b.neg / b.n) : 0 });
  for (const k in models) models[k].saved_pct = pct(models[k].saved, models[k].base);
  return { file: EVENTS, bytes, all: fin(t), day: fin(d), models, recent: recent.slice(-30).reverse() };
}

// ---- rtk (cached; rtk gain is a full read of its sqlite db) ----
let rtkCache = { at: 0, val: null };
async function rtkState() {
  if (Date.now() - rtkCache.at < 20000) return rtkCache.val;
  const [ver, gain] = await Promise.all([run("rtk", ["--version"]), run("rtk", ["gain", "--format", "json"])]);
  let summary = null;
  try { summary = JSON.parse(gain).summary; } catch {}
  const s = readJson(SETTINGS) || {};
  let hook = null;
  for (const h of (s.hooks && s.hooks.PreToolUse) || []) for (const x of h.hooks || []) if (/rtk hook/.test(x.command || "")) hook = { matcher: h.matcher || "(all)", command: x.command };
  rtkCache = { at: Date.now(), val: { installed: !!ver, version: (ver || "").trim() || null, hook, summary } };
  return rtkCache.val;
}

// ---- rules layer (claude-token-efficient) ----
function rulesState() {
  const cm = path.join(CLAUDE_DIR, "CLAUDE.md"), rm = path.join(CLAUDE_DIR, "RTK.md");
  let head = null, bytes = 0, importsRtk = false;
  try { const t = fs.readFileSync(cm, "utf8"); bytes = t.length; head = t.split("\n")[0].replace(/^#+\s*/, ""); importsRtk = /@RTK\.md/.test(t); } catch {}
  return { claude_md: fs.existsSync(cm), bytes, profile: head, imports_rtk: importsRtk, rtk_md: fs.existsSync(rm) };
}

// ---- routing (settings.json env) ----
function routingState() {
  const s = readJson(SETTINGS) || {}; const env = s.env || {};
  const hasProxy = !!env.HTTPS_PROXY, hasBase = !!env.ANTHROPIC_BASE_URL;
  let hook = false;
  for (const h of (s.hooks && s.hooks.SessionStart) || []) for (const x of h.hooks || []) if (/pxpipe-ctl/.test(x.command || "")) hook = true;
  return { desktop: hasProxy ? (hasBase ? "on (legacy base-url + warp)" : "on (warp)") : (hasBase ? "on (base-url only)" : "off"), https_proxy: env.HTTPS_PROXY || null, base_url: env.ANTHROPIC_BASE_URL || null, ca: env.NODE_EXTRA_CA_CERTS || null, session_start_hook: hook };
}

function pxpipeVersion() {
  const guess = process.platform === "win32" ? path.join(process.env.APPDATA || "", "npm", "node_modules", "pxpipe-proxy", "package.json") : null;
  const j = guess && readJson(guess); return j ? j.version : null;
}

async function state() {
  const [warp, stats, dash, rtk] = await Promise.all([get(`http://127.0.0.1:${WARP}/healthz`), get(`http://127.0.0.1:${PX}/proxy-stats`), get(`http://127.0.0.1:${PX}/api/stats.json`), rtkState()]);
  const ev = analyzeEvents();
  const verdict = {};
  // pxpipe: net tokens over the last 24h (falls back to all-time). Costing = negative net; check = many negative requests.
  const px = ev.day.n ? ev.day : ev.all;
  verdict.pxpipe = !stats ? "down" : px.n === 0 ? "no data" : px.saved <= 0 ? "COSTING" : px.neg_pct >= 30 ? "check" : "saving";
  verdict.warpd = !warp ? "down" : warp.mode === "divert" ? "compressing" : "passthrough (fail-open)";
  verdict.rtk = !rtk.installed ? "missing" : !rtk.hook ? "no hook" : rtk.summary && rtk.summary.total_saved > 0 ? "saving" : "idle";
  const rules = rulesState();
  verdict.rules = rules.claude_md && rules.imports_rtk ? "active" : rules.claude_md ? "partial" : "missing";
  return {
    ts: new Date().toISOString(), monitor: { port: PORT, uptime_s: Math.round((Date.now() - STARTED) / 1000), node: process.version },
    verdict, warpd: warp, pxpipe: { version: pxpipeVersion(), up: !!stats, stats, dashboard: dash && dash.summary ? dash.summary : null, events: ev },
    rtk, rules, routing: routingState(),
  };
}

const HTML = `<!doctype html><meta charset="utf-8"><title>claude-token-stack monitor</title>
<style>
body{font:13px/1.45 ui-monospace,Consolas,monospace;background:#0f1115;color:#d7dae0;margin:0;padding:16px}
h1{font-size:15px;margin:0 0 12px;color:#fff}h1 small{color:#7d8590;font-weight:normal;margin-left:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.card{background:#171a21;border:1px solid #262b36;border-radius:8px;padding:12px}
.card h2{font-size:13px;margin:0 0 8px;color:#fff;display:flex;justify-content:space-between}
.tag{padding:1px 8px;border-radius:10px;font-size:11px;font-weight:bold}
.ok{background:#1f4d2e;color:#8ce99a}.warn{background:#5a4a12;color:#ffd43b}.bad{background:#5c1e1e;color:#ff8787}.dim{background:#2a2f3a;color:#aab}
table{width:100%;border-collapse:collapse;margin-top:8px}td,th{padding:2px 6px;text-align:left;border-bottom:1px solid #22262f;white-space:nowrap}th{color:#7d8590;font-weight:normal}
td.r,th.r{text-align:right}.neg{color:#ff8787}.pos{color:#8ce99a}.k{color:#7d8590}
a{color:#74c0fc;text-decoration:none}pre{white-space:pre-wrap;color:#9aa;margin:6px 0 0}
</style>
<h1>claude-token-stack monitor <small id="ts"></small><small><a href="/api/state">json</a> · <a href="http://127.0.0.1:${PX}/" target="_blank">pxpipe dashboard</a></small></h1>
<div class="grid" id="cards"></div>
<div class="card" style="margin-top:12px"><h2>last requests through pxpipe <span class="k">saved% = (baseline - actual) / baseline; actual already includes the image tokens</span></h2><div id="recent"></div></div>
<script>
const $=(id)=>document.getElementById(id);
const k=(x)=>x==null?"-":(Math.abs(x)>=1e6?(x/1e6).toFixed(2)+"M":Math.abs(x)>=1e3?(x/1e3).toFixed(1)+"k":String(x));
const tag=(v)=>{const c=/saving|compressing|active/.test(v)?"ok":/COSTING|down|missing|no hook/.test(v)?"bad":/check|passthrough|partial|idle|no data/.test(v)?"warn":"dim";return '<span class="tag '+c+'">'+v+'</span>'};
const row=(a,b)=>'<tr><td class="k">'+a+'</td><td class="r">'+b+'</td></tr>';
function card(title,verdict,rows,extra){return '<div class="card"><h2>'+title+tag(verdict)+'</h2><table>'+rows.join("")+'</table>'+(extra||"")+'</div>'}
async function tick(){
 const s=await (await fetch("/api/state")).json();$("ts").textContent=new Date(s.ts).toLocaleTimeString()+" · monitor up "+s.monitor.uptime_s+"s";
 const ev=s.pxpipe.events,d=ev.day,a=ev.all,st=s.pxpipe.stats||{};
 const cards=[];
 cards.push(card("layer 3 · pxpipe (context -> images) v"+(s.pxpipe.version||"?"),s.verdict.pxpipe,[
  row("24h net",'<b class="'+(d.saved<0?"neg":"pos")+'">'+k(d.saved)+'</b> tokens ('+d.saved_pct+'%) over '+d.n+' req'),
  row("24h costing more than saving",d.neg+' req ('+d.neg_pct+'%, '+k(d.negTokens)+' tokens lost)'),
  row("24h passthrough / unmeasured",d.pass+' / '+d.unknown),
  row("avg transform overhead",d.avg_transform_ms+' ms per request'),
  row("whole file net (last 8 MB)",k(a.saved)+' tokens ('+a.saved_pct+'%) over '+a.n+' req; '+a.neg+' negative'),
  row("pxpipe's own estimate",st.saved_pct!=null?st.saved_pct+'% input, ~$'+(st.saved_usd||0).toFixed(2)+' saved (list price)':'-'),
  row("compressed vs passthrough $/req",st.compressed_avg_usd_per_request!=null?'$'+st.compressed_avg_usd_per_request+' vs $'+st.passthrough_avg_usd_per_request+(st.split_sufficient_sample?"":" (small sample)"):'-'),
  row("events.jsonl",(ev.bytes/1048576).toFixed(1)+' MB'),
 ],'<table><tr><th>model</th><th class="r">req</th><th class="r">saved%</th><th class="r">negative</th></tr>'+Object.entries(ev.models).map(([m,v])=>'<tr><td>'+m+'</td><td class="r">'+v.n+'</td><td class="r '+(v.saved_pct<0?"neg":"pos")+'">'+v.saved_pct+'%</td><td class="r">'+v.neg+'</td></tr>').join("")+'</table>'));
 const w=s.warpd||{};
 cards.push(card("layer 3 · warpd (HTTPS tunnel, fail-open)",s.verdict.warpd,[
  row("mode",w.mode||"-"),row("pxpipe seen by warpd",w.pxpipe||"-"),row("supervisor",w.supervise?"on (restarts: "+w.restarts+")":"off"),
  row("uptime",w.uptime_s!=null?w.uptime_s+" s":"-"),row("last change",w.last_change?new Date(w.last_change).toLocaleString():"-"),
  row("routing (settings.json)",s.routing.desktop),row("SessionStart hook",s.routing.session_start_hook?"yes":"no"),
 ]));
 const r=s.rtk,g=r.summary||{};
 cards.push(card("layer 1 · rtk (bash output filter) "+(r.version||""),s.verdict.rtk,[
  row("hook",r.hook?r.hook.command+' [matcher: '+r.hook.matcher+']':"none"),
  row("commands filtered",g.total_commands!=null?g.total_commands:"-"),
  row("tokens saved",g.total_saved!=null?k(g.total_saved)+' of '+k(g.total_input)+' ('+Math.round(g.avg_savings_pct||0)+'% avg)':"-"),
  row("avg hook time",g.avg_time_ms!=null?g.avg_time_ms+" ms":"-"),
  row("net",g.total_saved>0?"saving (filter output only, cost is the hook time)":"nothing measured yet"),
 ]));
 const u=s.rules;
 cards.push(card("layer 2 · rules (claude-token-efficient)",s.verdict.rules,[
  row("~/.claude/CLAUDE.md",u.claude_md?u.bytes+" chars":"missing"),row("profile",u.profile||"-"),row("imports @RTK.md",u.imports_rtk?"yes":"no"),row("~/.claude/RTK.md",u.rtk_md?"present":"missing"),
  row("net","not measurable at runtime; upstream benchmark ~30-40% fewer output tokens"),
 ]));
 $("cards").innerHTML=cards.join("");
 $("recent").innerHTML='<table><tr><th>time</th><th>model</th><th class="r">status</th><th class="r">baseline</th><th class="r">actual</th><th class="r">saved%</th><th class="r">imgs</th><th class="r">xform ms</th><th class="r">total ms</th><th>note</th></tr>'+
  ev.recent.map(e=>'<tr><td>'+new Date(e.ts).toLocaleTimeString()+'</td><td>'+(e.model||"")+'</td><td class="r">'+e.status+'</td><td class="r">'+k(e.baseline)+'</td><td class="r">'+k(e.used)+'</td><td class="r '+(e.saved_pct<0?"neg":"pos")+'">'+(e.saved_pct==null?"-":e.saved_pct+"%")+'</td><td class="r">'+e.images+'</td><td class="r">'+e.transform_ms+'</td><td class="r">'+e.duration_ms+'</td><td class="k">'+(e.compressed?"":"passthrough ")+(e.reason||"")+'</td></tr>').join("")+'</table>';
}
tick();setInterval(tick,5000);
</script>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/state") {
    try { const s = await state(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(s)); }
    catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
    return;
  }
  if (u.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, monitor: "up", port: PORT })); return; }
  if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(HTML); return; }
  res.writeHead(404); res.end("not found");
}).listen(PORT, "127.0.0.1", () => console.log(`[monitor] listening on http://127.0.0.1:${PORT}  (pxpipe :${PX}, warpd :${WARP})`));
