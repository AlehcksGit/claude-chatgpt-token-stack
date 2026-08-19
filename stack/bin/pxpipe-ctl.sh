#!/usr/bin/env bash
# pxpipe-ctl.sh - macOS/Linux port of pxpipe-ctl.ps1 (the core commands).
# start | stop | restart | status | health | doctor | logs | dashboard | savings
# desktop-on | desktop-off | config get|set|unset|list | autostart on|off|status
# Persistent config: ~/.pxpipe/daemon.env (KEY=VALUE). Explicit env still wins.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PXDIR="$HOME/.pxpipe"; mkdir -p "$PXDIR"
DAEMON_ENV="$PXDIR/daemon.env"; CA="$PXDIR/warp-ca.pem"
LOG="$PXDIR/proxy.log"; LOGERR="$PXDIR/proxy.err.log"
WLOG="$PXDIR/warpd.log"; WERR="$PXDIR/warpd.err.log"
EVENTS="$PXDIR/events.jsonl"
WARPD_TS="$HERE/lib/warpd/warpd.ts"
MON_JS="$HERE/lib/monitor.js"; MLOG="$PXDIR/monitor.log"
SETTINGS="$HOME/.claude/settings.json"
SELF="$HERE/pxpipe-ctl.sh"; HOOK_MARKER="pxpipe-ctl.sh"
QUIET=0

# ---- daemon.env -> env (only for keys not already set) ----
if [ -f "$DAEMON_ENV" ]; then
  while IFS= read -r line; do
    line="${line%%#*}"; [ -z "${line// }" ] && continue
    k="${line%%=*}"; v="${line#*=}"; k="${k// }"
    [ -z "$k" ] && continue
    if [ -z "${!k+x}" ]; then export "$k=$v"; fi
  done < "$DAEMON_ENV"
fi
PORT="${PXPIPE_PORT:-47821}"; WPORT="${PXPIPE_WARP_PORT:-47822}"
BASE="http://127.0.0.1:$PORT"; WURL="http://127.0.0.1:$WPORT"
MPORT="${PXPIPE_MONITOR_PORT:-47823}"; MURL="http://127.0.0.1:$MPORT"

say() { [ "$QUIET" = 1 ] || echo "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
listening() {  # $1 = port
  if have lsof; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; return; fi
  if have ss; then ss -ltn 2>/dev/null | grep -q ":$1 "; return; fi
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
pid_on_port() {
  if have lsof; then lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; return; fi
  if have ss; then ss -ltnp 2>/dev/null | grep ":$1 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1; fi
}
wait_listening() { local i=0; while [ $i -lt $((${2:-15}*4)) ]; do listening "$1" && return 0; sleep 0.25; i=$((i+1)); done; return 1; }
http() { curl -fsS --max-time "${2:-3}" "$1" 2>/dev/null; }
pxpipe_cli() {
  local root; root="$(npm root -g 2>/dev/null)"
  [ -n "$root" ] && [ -f "$root/pxpipe-proxy/bin/cli.js" ] && { echo "$root/pxpipe-proxy/bin/cli.js"; return; }
  return 1
}
rotate() { [ -s "$1" ] || return 0; [ -f "$1.2" ] && mv -f "$1.2" "$1.3"; [ -f "$1.1" ] && mv -f "$1.1" "$1.2"; mv -f "$1" "$1.1"; }
trim_events() {
  [ -f "$EVENTS" ] || return 0
  local sz; sz=$(wc -c < "$EVENTS" 2>/dev/null || echo 0)
  if [ "$sz" -gt $((20*1024*1024)) ]; then tail -n 20000 "$EVENTS" > "$EVENTS.tmp" && mv -f "$EVENTS.tmp" "$EVENTS"; say "events.jsonl trimmed to last 20000 lines"; fi
}

# ---- daemons ----
start_proxy() {
  if listening "$PORT"; then say "pxpipe: already listening on $PORT"; return 0; fi
  local cli; cli="$(pxpipe_cli)" || { echo "pxpipe-proxy not found. Install: npm install -g pxpipe-proxy" >&2; return 1; }
  rotate "$LOG"; rotate "$LOGERR"; trim_events
  PORT="$PORT" nohup node "$cli" >"$LOG" 2>"$LOGERR" </dev/null &
  disown 2>/dev/null || true
  wait_listening "$PORT" 15 && say "pxpipe: RUNNING on $BASE" || { echo "pxpipe did not start. See $LOGERR" >&2; return 1; }
}
start_warpd() {
  if listening "$WPORT"; then say "warpd: already listening on $WPORT"; return 0; fi
  [ -f "$WARPD_TS" ] || { echo "warpd.ts missing at $WARPD_TS" >&2; return 1; }
  rotate "$WLOG"; rotate "$WERR"
  local cli; cli="$(pxpipe_cli 2>/dev/null || true)"
  PXPIPE_PORT="$PORT" PXPIPE_WARP_PORT="$WPORT" PXPIPE_CLI="$cli" \
    nohup node --experimental-transform-types "$WARPD_TS" >"$WLOG" 2>"$WERR" </dev/null &
  disown 2>/dev/null || true
  wait_listening "$WPORT" 15 && say "warpd: RUNNING on $WURL (CA: $CA)" || { echo "warpd did not start. See $WERR" >&2; return 1; }
}
stop_port() {  # $1 port, $2 name
  local pid; pid="$(pid_on_port "$1")"
  if [ -z "$pid" ]; then say "$2: not running"; return 0; fi
  kill "$pid" 2>/dev/null; sleep 0.5; kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  say "$2: stopped (pid $pid)"
}
start_monitor() {
  if listening "$MPORT"; then say "monitor: already listening on $MPORT"; return 0; fi
  [ -f "$MON_JS" ] || { echo "monitor.js missing at $MON_JS" >&2; return 1; }
  rotate "$MLOG"
  PXPIPE_PORT="$PORT" PXPIPE_WARP_PORT="$WPORT" PXPIPE_MONITOR_PORT="$MPORT" nohup node "$MON_JS" >"$MLOG" 2>&1 </dev/null &
  disown 2>/dev/null || true
  wait_listening "$MPORT" 10 && say "monitor: RUNNING on $MURL/" || { echo "monitor did not start. See $MLOG" >&2; return 1; }
}
start_all() { start_proxy && start_warpd; start_monitor || say "monitor: not started (best-effort)"; }
stop_all() { stop_port "$WPORT" warpd; stop_port "$PORT" pxpipe; listening "$MPORT" && stop_port "$MPORT" monitor; true; }

# ---- settings.json ----
node_settings() {  # $1 = mode (on|off|status)
  node - "$SETTINGS" "$1" "$WURL" "$CA" "$SELF" "$HOOK_MARKER" <<'JS'
const fs = require('fs'); const [file, mode, wurl, ca, self, marker] = process.argv.slice(2);
let s = {}; if (fs.existsSync(file)) { try { s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { console.error('settings.json is not valid JSON: ' + e.message); process.exit(2); } }
const hookCmd = `bash "${self}" start --quiet`;
const hooksOf = () => Array.isArray(s.hooks && s.hooks.SessionStart) ? s.hooks.SessionStart : [];
const hookInstalled = () => hooksOf().some(h => (h.hooks || []).some(x => String(x.command || '').includes(marker)));
if (mode === 'status') { const e = s.env || {}; console.log(JSON.stringify({ proxy: e.HTTPS_PROXY || null, ca: e.NODE_EXTRA_CA_CERTS || null, baseUrl: e.ANTHROPIC_BASE_URL || null, hook: hookInstalled() })); process.exit(0); }
if (fs.existsSync(file) && !fs.existsSync(file + '.pre-pxpipe.bak')) fs.copyFileSync(file, file + '.pre-pxpipe.bak');
if (mode === 'on') {
  s.env = s.env || {}; delete s.env.ANTHROPIC_BASE_URL;
  s.env.HTTPS_PROXY = wurl; s.env.NO_PROXY = '127.0.0.1,localhost'; s.env.NODE_EXTRA_CA_CERTS = ca;
  s.hooks = s.hooks || {};
  if (!hookInstalled()) { s.hooks.SessionStart = hooksOf().concat([{ hooks: [{ type: 'command', command: hookCmd }] }]); }
} else {
  if (s.env) { for (const k of ['HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'ANTHROPIC_BASE_URL']) delete s.env[k]; if (!Object.keys(s.env).length) delete s.env; }
  if (s.hooks && s.hooks.SessionStart) {
    const kept = hooksOf().map(h => ({ ...h, hooks: (h.hooks || []).filter(x => !String(x.command || '').includes(marker)) })).filter(h => h.hooks.length);
    if (kept.length) s.hooks.SessionStart = kept; else delete s.hooks.SessionStart;
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
}
fs.mkdirSync(require('path').dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS
}
desktop_on() { node_settings on && { say "desktop-on: settings.json env -> HTTPS_PROXY=$WURL NO_PROXY NODE_EXTRA_CA_CERTS + SessionStart hook."; say "Restart the Claude desktop app once."; }; }
desktop_off() { node_settings off && { say "desktop-off: removed pxpipe env keys + SessionStart hook (backup: $SETTINGS.pre-pxpipe.bak)."; say "Restart the Claude desktop app. Daemons keep running; stop with: pxpipe-ctl.sh stop"; }; }

# ---- status / health ----
show_status() {
  local px=DOWN w=DOWN; listening "$PORT" && px="RUNNING (pid $(pid_on_port "$PORT"))"; listening "$WPORT" && w="RUNNING (pid $(pid_on_port "$WPORT"))"
  echo "pxpipe:  $px  $BASE  dashboard: $BASE/"
  echo "warpd:   $w  $WURL"
  local h; h="$(http "$WURL/healthz" 2)"; [ -n "$h" ] && echo "warpd health: $h"
  local st; st="$(node_settings status 2>/dev/null)"; echo "settings.json: $st"
  local mode="terminal only"; echo "$st" | grep -q "\"proxy\":\"$WURL\"" && mode="desktop: always-on ROUTING ENABLED"; echo "mode: $mode"
  listening "$MPORT" && echo "monitor: RUNNING $MURL/  (all 3 layers)" || echo "monitor: off  (pxpipe-ctl.sh monitor)"
  echo "logs: $LOG | $WLOG"
}
health() {
  local rc=0
  listening "$PORT" && echo "[PASS] pxpipe listening $PORT" || { echo "[FAIL] pxpipe not listening $PORT"; rc=1; }
  listening "$WPORT" && echo "[PASS] warpd listening $WPORT" || { echo "[FAIL] warpd not listening $WPORT"; rc=1; }
  local h; h="$(http "$WURL/healthz" 2)"; if echo "$h" | grep -q '"pxpipe":"up"'; then echo "[PASS] warpd sees pxpipe up"; else echo "[WARN] warpd healthz: ${h:-no answer}"; fi
  [ -f "$CA" ] && echo "[PASS] CA present $CA" || { echo "[FAIL] CA missing $CA"; rc=1; }
  have rtk && echo "[PASS] rtk $(rtk --version 2>/dev/null | head -1)" || echo "[WARN] rtk not on PATH"
  [ -f "$HOME/.claude/CLAUDE.md" ] && grep -q "token-efficient" "$HOME/.claude/CLAUDE.md" 2>/dev/null && echo "[PASS] ~/.claude/CLAUDE.md has token-efficient rules" || echo "[WARN] ~/.claude/CLAUDE.md missing token-efficient rules"
  return $rc
}
doctor() {
  echo "== doctor =="; have node && echo "node: $(node --version)" || echo "node: MISSING"
  have npm && echo "npm: $(npm --version)" || echo "npm: MISSING"
  pxpipe_cli >/dev/null 2>&1 && echo "pxpipe-proxy: $(pxpipe_cli)" || echo "pxpipe-proxy: MISSING (npm install -g pxpipe-proxy)"
  [ -f "$WARPD_TS" ] && echo "warpd.ts: ok" || echo "warpd.ts: MISSING"
  health
  echo "-- fix hints: start daemons with 'pxpipe-ctl.sh start'; enable desktop app with 'pxpipe-ctl.sh desktop-on'"
}
savings() {
  [ -f "$EVENTS" ] || { echo "no events yet"; return 0; }
  node - "$EVENTS" <<'JS'
const fs=require('fs');const [f]=process.argv.slice(2);let n=0,base=0,save=0,d=0,baseD=0,saveD=0;const day=Date.now()-864e5;
for(const line of fs.readFileSync(f,'utf8').replace(/^﻿/,'').split('\n')){if(!line.trim())continue;try{const e=JSON.parse(line);
if(e.baseline_probe_status!=='ok'||typeof e.baseline_tokens!=='number')continue;
const used=(e.input_tokens||0)+(e.cache_create_tokens||0)+(e.cache_read_tokens||0);const s=e.baseline_tokens-used;
n++;save+=s;base+=e.baseline_tokens;if(Date.parse(e.ts)>day){d++;saveD+=s;baseD+=e.baseline_tokens;}}catch{}}
const p=(s,b)=>b?Math.round(s/b*100):0;
console.log(`24h: ${d} req, ${(saveD/1000).toFixed(1)}k tokens saved (${p(saveD,baseD)}%) | all: ${n} req, ${(save/1000).toFixed(1)}k saved (${p(save,base)}%)`);
JS
}
config_cmd() {
  local op="${1:-list}"; shift || true
  case "$op" in
    list) [ -f "$DAEMON_ENV" ] && grep -v '^\s*#' "$DAEMON_ENV" || echo "(empty) $DAEMON_ENV" ;;
    get) [ -f "$DAEMON_ENV" ] && grep "^$1=" "$DAEMON_ENV" | cut -d= -f2- ;;
    set) [ $# -ge 2 ] || { echo "usage: config set KEY VALUE"; return 1; }
         { [ -f "$DAEMON_ENV" ] && grep -v "^$1=" "$DAEMON_ENV"; echo "$1=$2"; } > "$DAEMON_ENV.tmp" && mv -f "$DAEMON_ENV.tmp" "$DAEMON_ENV"; echo "set $1 (applies on next start)" ;;
    unset) [ -f "$DAEMON_ENV" ] && grep -v "^$1=" "$DAEMON_ENV" > "$DAEMON_ENV.tmp" && mv -f "$DAEMON_ENV.tmp" "$DAEMON_ENV"; echo "unset $1" ;;
    *) echo "config list|get KEY|set KEY VALUE|unset KEY" ;;
  esac
}
autostart() {
  local op="${1:-status}"
  case "$(uname -s)" in
    Darwin)
      local plist="$HOME/Library/LaunchAgents/com.pxpipe.ctl.plist"
      case "$op" in
        on) cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.pxpipe.ctl</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$SELF</string><string>start</string><string>--quiet</string></array>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string></dict>
</dict></plist>
EOF
            launchctl unload "$plist" 2>/dev/null; launchctl load "$plist" && echo "autostart: on (launchd $plist)" ;;
        off) launchctl unload "$plist" 2>/dev/null; rm -f "$plist"; echo "autostart: off" ;;
        *) [ -f "$plist" ] && echo "autostart: on ($plist)" || echo "autostart: off" ;;
      esac ;;
    *)
      local unit="$HOME/.config/systemd/user/pxpipe-ctl.service"
      case "$op" in
        on) mkdir -p "$(dirname "$unit")"; cat > "$unit" <<EOF
[Unit]
Description=pxpipe-ctl daemons (pxpipe + warpd)
[Service]
Type=oneshot
RemainAfterExit=yes
Environment=PATH=$PATH
ExecStart=/bin/bash $SELF start --quiet
ExecStop=/bin/bash $SELF stop --quiet
[Install]
WantedBy=default.target
EOF
            systemctl --user daemon-reload && systemctl --user enable --now pxpipe-ctl.service && echo "autostart: on (systemd user unit)" ;;
        off) systemctl --user disable --now pxpipe-ctl.service 2>/dev/null; rm -f "$unit"; systemctl --user daemon-reload 2>/dev/null; echo "autostart: off" ;;
        *) systemctl --user is-enabled pxpipe-ctl.service 2>/dev/null && echo "autostart: on" || echo "autostart: off" ;;
      esac ;;
  esac
}
open_url() { if have open; then open "$1"; elif have xdg-open; then xdg-open "$1"; else echo "$1"; fi; }

for a in "$@"; do [ "$a" = "--quiet" ] && QUIET=1; done
cmd="${1:-status}"; shift || true
case "$cmd" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; sleep 1; start_all ;;
  status) show_status ;;
  health) health ;;
  doctor) doctor ;;
  savings) savings ;;
  logs) tail -n "${1:-40}" "$LOG" "$WLOG" 2>/dev/null ;;
  dashboard) open_url "$BASE/" ;;
  monitor) case "${1:-}" in stop) stop_port "$MPORT" monitor ;; open) listening "$MPORT" || start_monitor; open_url "$MURL/" ;; *) start_monitor && echo "monitor: $MURL/  (pxpipe-ctl monitor open|stop)" ;; esac ;;
  desktop-on) desktop_on ;;
  desktop-off) desktop_off ;;
  config) config_cmd "$@" ;;
  autostart) autostart "$@" ;;
  --quiet) start_all ;;
  *) echo "usage: pxpipe-ctl.sh start|stop|restart|status|health|doctor|savings|logs [n]|dashboard|monitor [stop|open]|desktop-on|desktop-off|config ...|autostart on|off|status  [--quiet]" ;;
esac
