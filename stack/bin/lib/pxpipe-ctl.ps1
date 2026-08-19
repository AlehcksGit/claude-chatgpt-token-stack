# pxpipe-ctl - control the local pxpipe token-compression proxy + warpd (Windows)
#
#   pxpipe-ctl start|stop|restart|status|dashboard|logs
#   pxpipe-ctl desktop-on|desktop-off      always-on routing for the Claude desktop app + terminals
#   pxpipe-ctl doctor [-Fix]               health check every layer (rtk / rules / pxpipe / warpd / settings)
#   pxpipe-ctl clean                       trim events.jsonl + rotated logs
#   pxpipe-ctl update                      npm/winget upgrade pxpipe + rtk, restart daemons
#   pxpipe-ctl config list|get|set|unset   persistent daemon env (~/.pxpipe/daemon.env)
#   pxpipe-ctl autostart on|off|status     Windows logon task so daemons are up before the first session
#
# Layers: pxpipe (47821, compress) <- warpd (47822, HTTPS_PROXY, TLS re-terminate for api.anthropic.com only)
# Env override: PXPIPE_PORT, PXPIPE_WARP_PORT (or set them via `pxpipe-ctl config set`).

param(
  [Parameter(Position=0)][string]$Cmd = "status",
  [Parameter(Position=1)][string]$Arg1,
  [Parameter(Position=2)][string]$Arg2,
  [Parameter(Position=3)][string]$Arg3,
  [switch]$Quiet,
  [switch]$Fix,
  [switch]$All
)
$ErrorActionPreference = "Stop"

# ---------- paths / constants ----------
$Home_    = $env:USERPROFILE
$PxDir    = Join-Path $Home_ ".pxpipe"
$ClaudeDir= Join-Path $Home_ ".claude"
$Settings = Join-Path $ClaudeDir "settings.json"
$DaemonEnv= Join-Path $PxDir "daemon.env"
$CA       = Join-Path $PxDir "warp-ca.pem"
$Log      = Join-Path $PxDir "proxy.log"
$LogErr   = Join-Path $PxDir "proxy.err.log"
$WarpLog  = Join-Path $PxDir "warpd.log"
$WarpErr  = Join-Path $PxDir "warpd.err.log"
$Events   = Join-Path $PxDir "events.jsonl"
$WarpdTs  = Join-Path $PSScriptRoot "warpd\warpd.ts"
$MonJs    = Join-Path $PSScriptRoot "monitor.js"
$MonLog   = Join-Path $PxDir "monitor.log"
$Self     = $PSCommandPath
$HookCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Self`" start -Quiet"
$HookMarker  = "pxpipe-ctl.ps1"
$TaskName    = "pxpipe-ctl start"
$RotateKeep  = 3

New-Item -ItemType Directory -Force -Path $PxDir | Out-Null

# ---------- daemon.env (persistent config; explicit process env still wins) ----------
function Read-DaemonEnv {
  $h = [ordered]@{}
  if (Test-Path $DaemonEnv) {
    foreach ($line in Get-Content $DaemonEnv) {
      $t = $line.Trim(); if (-not $t -or $t.StartsWith('#')) { continue }
      $i = $t.IndexOf('='); if ($i -lt 1) { continue }
      $h[$t.Substring(0,$i).Trim()] = $t.Substring($i+1).Trim()
    }
  }
  return $h
}
function Write-DaemonEnv($h) {
  $lines = @("# pxpipe-ctl daemon config. KEY=VALUE, applied to pxpipe + warpd on start. Edit or use: pxpipe-ctl config set KEY VALUE")
  foreach ($k in $h.Keys) { $lines += "$k=$($h[$k])" }
  Set-Content -Path $DaemonEnv -Value $lines -Encoding ASCII
}
$Cfg = Read-DaemonEnv
foreach ($k in $Cfg.Keys) { if (-not (Test-Path "Env:$k")) { Set-Item -Path "Env:$k" -Value $Cfg[$k] } }

$Port     = if ($env:PXPIPE_PORT)      { [int]$env:PXPIPE_PORT }      else { 47821 }
$WarpPort = if ($env:PXPIPE_WARP_PORT) { [int]$env:PXPIPE_WARP_PORT } else { 47822 }
$MonPort  = if ($env:PXPIPE_MONITOR_PORT) { [int]$env:PXPIPE_MONITOR_PORT } else { 47823 }
$MonUrl   = "http://127.0.0.1:$MonPort"
$Base     = "http://127.0.0.1:$Port"
$WarpUrl  = "http://127.0.0.1:$WarpPort"
$EnvKeys  = [ordered]@{
  HTTPS_PROXY         = $WarpUrl
  NO_PROXY            = "127.0.0.1,localhost"
  NODE_EXTRA_CA_CERTS = $CA
}
$ManagedKeys = @("HTTPS_PROXY","NO_PROXY","NODE_EXTRA_CA_CERTS","ANTHROPIC_BASE_URL")

# ---------- helpers ----------
function Say($msg, $color = "Gray") { if (-not $Quiet) { Write-Host $msg -ForegroundColor $color } }
function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Test-Listening($p) {
  return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}
function Wait-Listening($p, $seconds = 15) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (Test-Listening $p) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
function Http($url, $timeoutSec = 3) {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec).Content } catch { return $null }
}
function Get-PxpipeCli {
  $guess = Join-Path $env:APPDATA "npm\node_modules\pxpipe-proxy\bin\cli.js"
  if (Test-Path $guess) { return $guess }
  if (Have npm) { $root = (& npm root -g 2>$null); if ($root) { $p = Join-Path $root "pxpipe-proxy\bin\cli.js"; if (Test-Path $p) { return $p } } }
  return $null
}
function Get-Version($cmd, $args_) {
  try { $o = & $cmd $args_ 2>$null | Select-Object -First 1; return ("$o").Trim() } catch { return "?" }
}
function Rotate-Log($path) {
  # keep the previous run: file -> .1 -> .2 -> .3 (only when the daemon is not running, i.e. before start)
  if (-not (Test-Path $path)) { return }
  if ((Get-Item $path).Length -eq 0) { return }
  for ($i = $RotateKeep - 1; $i -ge 1; $i--) {
    $src = "$path.$i"; $dst = "$path.$($i+1)"
    if (Test-Path $src) { Move-Item -Force $src $dst }
  }
  Move-Item -Force $path "$path.1"
}
function Trim-Events($maxMB = 20, $keepLines = 20000) {
  if (-not (Test-Path $Events)) { return }
  if ((Get-Item $Events).Length -lt ($maxMB * 1MB)) { return }
  $tail = Get-Content $Events -Tail $keepLines
  Set-Content -Path $Events -Value $tail -Encoding UTF8
  Say "events.jsonl was over $maxMB MB; kept the last $keepLines events." "DarkGray"
}
function Warp-Health {
  $j = Http "$WarpUrl/healthz" 2
  if (-not $j) { return $null }
  try { return ($j | ConvertFrom-Json) } catch { return $null }
}
function Read-Settings {
  if (-not (Test-Path $Settings)) { return [pscustomobject]@{} }
  $raw = Get-Content $Settings -Raw
  if (-not $raw.Trim()) { return [pscustomobject]@{} }
  return ($raw | ConvertFrom-Json)
}
function Save-Settings($obj) {
  if (Test-Path $Settings) { Copy-Item $Settings "$Settings.pre-pxpipe.bak" -Force }
  # UTF-8 without BOM, LF, 2-space indent (matches what Claude Code writes)
  $json = ($obj | ConvertTo-Json -Depth 20).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Settings, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}
function Get-SessionStartHooks($s) {
  if ($s.PSObject.Properties["hooks"] -and $s.hooks.PSObject.Properties["SessionStart"]) { return @($s.hooks.SessionStart) }
  return @()
}
function Test-HookInstalled($s) {
  foreach ($h in (Get-SessionStartHooks $s)) { foreach ($x in @($h.hooks)) { if ("$($x.command)" -like "*$HookMarker*") { return $true } } }
  return $false
}
function Test-RtkHook($s) {
  if (-not ($s.PSObject.Properties["hooks"] -and $s.hooks.PSObject.Properties["PreToolUse"])) { return $false }
  foreach ($h in @($s.hooks.PreToolUse)) { foreach ($x in @($h.hooks)) { if ("$($x.command)" -match 'rtk hook') { return $true } } }
  return $false
}
function Env-State($s) {
  # on / off / partial / legacy (old ANTHROPIC_BASE_URL variant present)
  if (-not $s.PSObject.Properties["env"]) { return "off" }
  $e = $s.env
  if ($e.PSObject.Properties["ANTHROPIC_BASE_URL"] -and "$($e.ANTHROPIC_BASE_URL)" -match "127\.0\.0\.1") { return "legacy" }
  $have = 0
  foreach ($k in $EnvKeys.Keys) { if ($e.PSObject.Properties[$k] -and "$($e.$k)" -eq $EnvKeys[$k]) { $have++ } }
  if ($have -eq $EnvKeys.Count) { return "on" }
  if ($have -eq 0) { return "off" }
  return "partial"
}
function Stop-ByPort($p, $label) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { Say "$label`: not running" "DarkGray"; return }
  foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Say "$label`: stopped (pid $procId)" "Yellow" } catch { Say "$label`: could not stop pid $procId ($($_.Exception.Message))" "Red" }
  }
}
function Savings-Summary {
  # returns one line: 24h + all-time savings computed from events.jsonl (via node, fast even at MBs)
  if (-not (Test-Path $Events) -or -not (Have node)) { return $null }
  $js = @'
const fs=require("fs");const f=process.argv[2];const day=Date.now()-864e5;
let n=0,d=0,sav=0,savD=0,base=0,baseD=0;
for(const line of fs.readFileSync(f,"utf8").split("\n")){if(!line.trim())continue;let e;try{e=JSON.parse(line)}catch{continue}
if(e.baseline_probe_status!=="ok"||typeof e.baseline_tokens!=="number")continue;
const used=(e.input_tokens||0)+(e.cache_create_tokens||0)+(e.cache_read_tokens||0);const s=e.baseline_tokens-used;
n++;sav+=s;base+=e.baseline_tokens;if(Date.parse(e.ts)>day){d++;savD+=s;baseD+=e.baseline_tokens}}
const pct=(a,b)=>b?Math.round(100*a/b):0;const k=x=>(x/1000).toFixed(1)+"k";
console.log(`24h: ${d} req, ${k(savD)} tokens saved (${pct(savD,baseD)}%)  |  all: ${n} req, ${k(sav)} saved (${pct(sav,base)}%)`);
'@
  # via a temp file: Windows PowerShell 5.1 strips double quotes from native args, so `node -e` would get mangled JS
  $tmp = Join-Path $env:TEMP "pxpipe-ctl-savings.js"
  try { Set-Content -Path $tmp -Value $js -Encoding ASCII; return (& node $tmp $Events | Select-Object -First 1) } catch { return $null }
}
function Test-AutostartTask {
  # cmd swallows schtasks' stderr so a missing task does not trip $ErrorActionPreference=Stop
  & cmd /c "schtasks /Query /TN `"$TaskName`" >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

# ---------- daemons ----------
function Start-Proxy {
  if (Test-Listening $Port) { Say "pxpipe: already listening on $Port" "DarkGray"; return }
  $cli = Get-PxpipeCli
  if (-not $cli) { throw "pxpipe-proxy not found. Install: npm install -g pxpipe-proxy" }
  Rotate-Log $Log; Rotate-Log $LogErr; Trim-Events
  $env:PXPIPE_PORT = "$Port"; $env:PORT = "$Port"   # pxpipe itself reads PORT
  Start-Process -FilePath node -ArgumentList "`"$cli`"" -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError $LogErr | Out-Null
  if (Wait-Listening $Port 15) { Say "pxpipe: RUNNING on $Base" "Green" }
  else { throw "pxpipe did not start. See $LogErr" }
}
function Start-Warpd {
  if (Test-Listening $WarpPort) { Say "warpd: already listening on $WarpPort" "DarkGray"; return }
  if (-not (Test-Path $WarpdTs)) { throw "warpd.ts missing at $WarpdTs" }
  Rotate-Log $WarpLog; Rotate-Log $WarpErr
  $env:PXPIPE_PORT = "$Port"; $env:PXPIPE_WARP_PORT = "$WarpPort"
  $cli = Get-PxpipeCli; if ($cli) { $env:PXPIPE_CLI = $cli }   # lets warpd supervise pxpipe (fail-open + restart)
  Start-Process -FilePath node -ArgumentList "--experimental-transform-types `"$WarpdTs`"" -WindowStyle Hidden -RedirectStandardOutput $WarpLog -RedirectStandardError $WarpErr | Out-Null
  if (Wait-Listening $WarpPort 15) { Say "warpd: RUNNING on $WarpUrl (CA: $CA)" "Green" }
  else { throw "warpd did not start. See $WarpErr" }
}
function Start-Monitor {
  if (Test-Listening $MonPort) { Say "monitor: already listening on $MonPort" "DarkGray"; return }
  if (-not (Test-Path $MonJs)) { throw "monitor.js missing at $MonJs" }
  Rotate-Log $MonLog
  $env:PXPIPE_PORT = "$Port"; $env:PXPIPE_WARP_PORT = "$WarpPort"; $env:PXPIPE_MONITOR_PORT = "$MonPort"
  Start-Process -FilePath node -ArgumentList "`"$MonJs`"" -WindowStyle Hidden -RedirectStandardOutput $MonLog -RedirectStandardError (Join-Path $PxDir "monitor.err.log") | Out-Null
  if (Wait-Listening $MonPort 10) { Say "monitor: RUNNING on $MonUrl/" "Green" } else { throw "monitor did not start. See $PxDir\monitor.err.log" }
}
function Start-All {
  Start-Proxy; Start-Warpd
  # monitor is best-effort: never let it block a session start (SessionStart hook calls this)
  try { Start-Monitor } catch { Say "monitor: $($_.Exception.Message)" "DarkGray" }
}
function Stop-All  { Stop-ByPort $WarpPort "warpd"; Stop-ByPort $Port "pxpipe"; if (Test-Listening $MonPort) { Stop-ByPort $MonPort "monitor" } }

# ---------- settings.json (desktop-on/off) ----------
function Enable-Desktop {
  $s = Read-Settings
  if (-not $s.PSObject.Properties["env"]) { $s | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
  if ($s.env.PSObject.Properties["ANTHROPIC_BASE_URL"]) { $s.env.PSObject.Properties.Remove("ANTHROPIC_BASE_URL") }
  foreach ($k in $EnvKeys.Keys) {
    if ($s.env.PSObject.Properties[$k]) { $s.env.$k = $EnvKeys[$k] } else { $s.env | Add-Member -NotePropertyName $k -NotePropertyValue $EnvKeys[$k] }
  }
  if (-not $s.PSObject.Properties["hooks"]) { $s | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
  if (-not (Test-HookInstalled $s)) {
    $entry = [pscustomobject]@{ hooks = @([pscustomobject]@{ type = "command"; command = $HookCommand }) }
    $existing = Get-SessionStartHooks $s
    if ($s.hooks.PSObject.Properties["SessionStart"]) { $s.hooks.SessionStart = @($existing + $entry) }
    else { $s.hooks | Add-Member -NotePropertyName SessionStart -NotePropertyValue @($entry) }
  }
  Save-Settings $s
  Say "desktop-on: settings.json env -> HTTPS_PROXY=$WarpUrl NO_PROXY NODE_EXTRA_CA_CERTS + SessionStart hook (auto-start)." "Green"
  Say "Restart the Claude desktop app once. Terminal sessions can still use: claude-px" "Gray"
}
function Disable-Desktop {
  $s = Read-Settings
  if ($s.PSObject.Properties["env"]) {
    foreach ($k in $ManagedKeys) { if ($s.env.PSObject.Properties[$k]) { $s.env.PSObject.Properties.Remove($k) } }
    if (@($s.env.PSObject.Properties).Count -eq 0) { $s.PSObject.Properties.Remove("env") }
  }
  if ($s.PSObject.Properties["hooks"] -and $s.hooks.PSObject.Properties["SessionStart"]) {
    $kept = @()
    foreach ($h in (Get-SessionStartHooks $s)) {
      $inner = @($h.hooks | Where-Object { "$($_.command)" -notlike "*$HookMarker*" })
      if ($inner.Count -gt 0) { $h.hooks = $inner; $kept += $h }
    }
    if ($kept.Count -gt 0) { $s.hooks.SessionStart = $kept } else { $s.hooks.PSObject.Properties.Remove("SessionStart") }
    if (@($s.hooks.PSObject.Properties).Count -eq 0) { $s.PSObject.Properties.Remove("hooks") }
  }
  Save-Settings $s
  Say "desktop-off: removed the pxpipe env keys + SessionStart hook from settings.json (backup: $Settings.pre-pxpipe.bak)." "Yellow"
  Say "Restart the Claude desktop app. Daemons keep running; stop with: pxpipe-ctl stop" "Gray"
}

# ---------- status ----------
function Show-Status {
  $s = Read-Settings
  $pxUp = Test-Listening $Port; $wUp = Test-Listening $WarpPort
  $h = Warp-Health
  $ver = "?"; $cli = Get-PxpipeCli
  if ($cli) { $pkg = Join-Path (Split-Path (Split-Path $cli)) "package.json"; if (Test-Path $pkg) { try { $ver = (Get-Content $pkg -Raw | ConvertFrom-Json).version } catch {} } }
  Write-Host ""
  Write-Host "  pxpipe    : " -NoNewline; if ($pxUp) { Write-Host "RUNNING  $Base  (v$ver)" -ForegroundColor Green } else { Write-Host "STOPPED  ($Base)" -ForegroundColor Red }
  Write-Host "  warpd     : " -NoNewline
  if ($wUp) {
    $mode = if ($h) { $h.mode } else { "?" }
    $extra = if ($h -and $h.supervising) { "  supervising pxpipe (restarts: $($h.restarts))" } else { "" }
    $color = if ($mode -eq "divert") { "Green" } else { "Yellow" }
    Write-Host "RUNNING  $WarpUrl  mode=$mode$extra" -ForegroundColor $color
    if ($mode -eq "passthrough") { Write-Host "              (pxpipe unreachable -> traffic tunnels straight to Anthropic, no compression)" -ForegroundColor Yellow }
  } else { Write-Host "STOPPED  ($WarpUrl)" -ForegroundColor Red }
  $st = Env-State $s
  Write-Host "  desktop   : " -NoNewline
  switch ($st) {
    "on"      { Write-Host "always-on ROUTING ENABLED (settings.json env + SessionStart hook: $(if (Test-HookInstalled $s) {'yes'} else {'MISSING'}))" -ForegroundColor Green }
    "off"     { Write-Host "not routed (enable: pxpipe-ctl desktop-on)" -ForegroundColor Yellow }
    "partial" { Write-Host "PARTIAL env in settings.json - run: pxpipe-ctl desktop-on" -ForegroundColor Red }
    "legacy"  { Write-Host "LEGACY ANTHROPIC_BASE_URL routing (breaks connectors) - run: pxpipe-ctl desktop-on" -ForegroundColor Red }
  }
  Write-Host "  rtk       : " -NoNewline
  if (Have rtk) { $rv = Get-Version rtk "--version"; $hk = if (Test-RtkHook $s) { "hook installed" } else { "HOOK MISSING (rtk init -g)" }; Write-Host "$rv, $hk" -ForegroundColor $(if ($hk -like "hook installed") {"Green"} else {"Yellow"}) } else { Write-Host "not on PATH" -ForegroundColor Red }
  $sum = Savings-Summary; if ($sum) { Write-Host "  savings   : $sum" -ForegroundColor Cyan }
  Write-Host "  monitor   : $(if (Test-Listening $MonPort) {"RUNNING  $MonUrl/  (all 3 layers, per-request net savings)"} else {"off (pxpipe-ctl monitor)"})" -ForegroundColor DarkGray
  Write-Host "  autostart : $(if (Test-AutostartTask) {'logon task ON'} else {'off (pxpipe-ctl autostart on)'})" -ForegroundColor DarkGray
  Write-Host "  dashboard : $Base/     logs: pxpipe-ctl logs     doctor: pxpipe-ctl doctor" -ForegroundColor DarkGray
  Write-Host ""
}

# ---------- doctor ----------
$script:DocFail = 0; $script:DocWarn = 0
function Check($label, $ok, $detail, $fixHint = $null, $fixAction = $null, $warnOnly = $false) {
  if ($ok) { Write-Host ("  [PASS] {0,-26} {1}" -f $label, $detail) -ForegroundColor Green; return }
  $tag = if ($warnOnly) { "WARN" } else { "FAIL" }
  $col = if ($warnOnly) { "Yellow" } else { "Red" }
  Write-Host ("  [{0}] {1,-26} {2}" -f $tag, $label, $detail) -ForegroundColor $col
  if ($warnOnly) { $script:DocWarn++ } else { $script:DocFail++ }
  if ($fixAction -and $Fix) {
    Write-Host ("         -> fixing: {0}" -f $fixHint) -ForegroundColor Cyan
    try { & $fixAction; Write-Host "         -> done" -ForegroundColor Cyan } catch { Write-Host "         -> fix failed: $($_.Exception.Message)" -ForegroundColor Red }
  } elseif ($fixHint) { Write-Host ("         fix: {0}" -f $fixHint) -ForegroundColor DarkGray }
}
function Run-Doctor {
  Write-Host ""; Write-Host "pxpipe-ctl doctor  $(if ($Fix) {'(-Fix: applying safe fixes)'} else {'(add -Fix to apply safe fixes)'})" -ForegroundColor White
  Write-Host "  layer 1: rtk (bash output filter)" -ForegroundColor DarkGray
  $rtkOk = Have rtk
  Check "rtk on PATH" $rtkOk $(if ($rtkOk) { Get-Version rtk "--version" } else { "missing" }) "winget install rtk-ai.rtk (or re-run install.ps1)"
  $s = $null; $settingsOk = $true
  try { $s = Read-Settings } catch { $settingsOk = $false }
  Check "settings.json parses" $settingsOk $Settings "restore from $Settings.pre-pxpipe.bak"
  if (-not $s) { $s = [pscustomobject]@{} }
  Check "rtk PreToolUse hook" (Test-RtkHook $s) "rtk hook claude" "rtk init -g" { & rtk init -g | Out-Null } (-not $rtkOk)
  if (Test-RtkHook $s) {
    $m = "(none)"; foreach ($h in @($s.hooks.PreToolUse)) { foreach ($x in @($h.hooks)) { if ("$($x.command)" -match 'rtk hook') { $m = "$($h.matcher)" } } }
    Check "rtk hook matcher" ($m -match 'PowerShell') "matcher = $m" "set the hook matcher to `"Bash|PowerShell`" in settings.json so PowerShell tool output is filtered too" $null $true
  }
  $rgOk = Have rg
  Check "ripgrep (rg) on PATH" $rgOk $(if ($rgOk) { Get-Version rg "--version" } else { "missing (some rtk filters and Claude Grep want it)" }) "winget install BurntSushi.ripgrep.MSVC" $null $true

  Write-Host "  layer 2: claude-token-efficient rules" -ForegroundColor DarkGray
  $cm = Join-Path $ClaudeDir "CLAUDE.md"; $rm = Join-Path $ClaudeDir "RTK.md"
  $cmOk = (Test-Path $cm) -and ((Get-Content $cm -Raw) -match "@RTK\.md")
  Check "~/.claude/CLAUDE.md" $cmOk $(if ($cmOk) { "present, imports @RTK.md" } else { "missing or lacks @RTK.md" }) "copy stack\CLAUDE.md to ~\.claude\CLAUDE.md (install.ps1 does this)"
  Check "~/.claude/RTK.md" (Test-Path $rm) $rm "rtk init -g (writes RTK.md)" { & rtk init -g | Out-Null }

  Write-Host "  layer 3: pxpipe (compression proxy)" -ForegroundColor DarkGray
  $nodeOk = Have node; $nv = if ($nodeOk) { Get-Version node "-v" } else { "missing" }
  $nodeMajor = 0; if ($nv -match '^v(\d+)') { $nodeMajor = [int]$Matches[1] }
  Check "node >= 22" ($nodeMajor -ge 22) $nv "winget install OpenJS.NodeJS.LTS"
  $cli = Get-PxpipeCli
  Check "pxpipe-proxy installed" ([bool]$cli) $(if ($cli) { $cli } else { "not found under npm -g" }) "npm install -g pxpipe-proxy"
  $pxUp = Test-Listening $Port
  Check "pxpipe listening :$Port" $pxUp $Base "pxpipe-ctl start" { Start-Proxy }
  if (Test-Listening $Port) {
    $dash = Http "$Base/" 3
    Check "port $Port answers as pxpipe" ([bool]$dash -and $dash -match "pxpipe") $(if ($dash) { "dashboard OK" } else { "no HTTP answer" }) "another program owns the port? change it: pxpipe-ctl config set PXPIPE_PORT 47831 ; pxpipe-ctl restart"
  }
  Check "events.jsonl size" ((-not (Test-Path $Events)) -or ((Get-Item $Events).Length -lt 20MB)) $(if (Test-Path $Events) { "{0:n1} MB" -f ((Get-Item $Events).Length / 1MB) } else { "none yet" }) "pxpipe-ctl clean" { Trim-Events 0 20000 } $true

  Write-Host "  layer 4: warpd (HTTPS_PROXY -> pxpipe)" -ForegroundColor DarkGray
  Check "warpd.ts present" (Test-Path $WarpdTs) $WarpdTs "re-run install.ps1"
  $wUp = Test-Listening $WarpPort
  Check "warpd listening :$WarpPort" $wUp $WarpUrl "pxpipe-ctl start" { Start-Warpd }
  $h = Warp-Health
  Check "warpd /healthz" ([bool]$h) $(if ($h) { "mode=$($h.mode) pxpipe=$($h.pxpipe) supervisor=$(if ($h.supervise) {'on'} else {'off'}) restarts=$($h.restarts)" } else { "no answer" }) "pxpipe-ctl restart" { Stop-ByPort $WarpPort "warpd"; Start-Warpd }
  if ($h) { Check "warpd mode = divert" ($h.mode -eq "divert") $(if ($h.mode -eq "divert") { "compressing" } else { "passthrough: pxpipe unreachable, traffic bypasses compression" }) "pxpipe-ctl restart" { Start-Proxy } $true }
  Check "warp CA file" (Test-Path $CA) $CA "pxpipe-ctl restart (warpd regenerates it)"
  if ((Have curl.exe) -and (Test-Path $CA) -and (Test-Listening $WarpPort)) {
    # --ssl-no-revoke: Windows curl (schannel) cannot fetch a CRL for the private warp CA and would fail with CERT_TRUST_REVOCATION_STATUS_UNKNOWN
    $code = & cmd /c "curl.exe -s -o NUL -w %{http_code} --ssl-no-revoke --max-time 15 -x $WarpUrl --cacert `"$CA`" https://api.anthropic.com/v1/messages -H content-type:application/json -d {} 2>nul"
    Check "end-to-end probe via warpd" ("$code" -eq "401") "api.anthropic.com -> HTTP $code (401 = reached Anthropic through the tunnel with no key, as expected)" "check internet / firewall; pxpipe-ctl logs" $null $true
  }

  Write-Host "  layer 5: Claude desktop / terminal wiring" -ForegroundColor DarkGray
  $st = Env-State $s
  Check "settings.json env" ($st -eq "on") $(switch ($st) { "on" {"HTTPS_PROXY + NO_PROXY + NODE_EXTRA_CA_CERTS"} "off" {"not routed (fine if intentional)"} "partial" {"partial keys"} "legacy" {"legacy ANTHROPIC_BASE_URL variant"} }) "pxpipe-ctl desktop-on" { Enable-Desktop } ($st -eq "off")
  Check "SessionStart auto-start hook" (Test-HookInstalled $s) $HookCommand "pxpipe-ctl desktop-on" { Enable-Desktop } ($st -eq "off")
  $binDir = Split-Path $PSScriptRoot
  $onPath = (("$env:PATH").Split(';') | Where-Object { $_.TrimEnd('\') -ieq $binDir.TrimEnd('\') }).Count -gt 0
  Check "~/.local/bin on PATH" $onPath $binDir "add $binDir to the user PATH (install.ps1 does this), open a new terminal" $null $true
  Check "claude-px launcher" (Test-Path (Join-Path $binDir "claude-px.cmd")) (Join-Path $binDir "claude-px.cmd") "re-run install.ps1" $null $true
  $taskOn = Test-AutostartTask
  Check "logon autostart task" $taskOn $(if ($taskOn) { "on" } else { "off (optional; the SessionStart hook also starts the daemons)" }) "pxpipe-ctl autostart on" $null $true
  $monUp = Test-Listening $MonPort
  Check "monitor :$MonPort" $monUp $(if ($monUp) { $MonUrl } else { "off (optional; pxpipe-ctl monitor)" }) "pxpipe-ctl monitor" { Start-Monitor } $true

  Write-Host ""
  if ($script:DocFail -eq 0 -and $script:DocWarn -eq 0) { Write-Host "  all checks passed" -ForegroundColor Green }
  else { Write-Host "  $($script:DocFail) failing, $($script:DocWarn) warnings$(if (-not $Fix -and $script:DocFail) {'  (pxpipe-ctl doctor -Fix)'})" -ForegroundColor $(if ($script:DocFail) {"Red"} else {"Yellow"}) }
  Write-Host ""
  if ($script:DocFail) { exit 1 }
}

# ---------- clean / update / config / autostart ----------
function Run-Clean {
  $freed = 0
  # -Filter "*.log.*" also matches the live "proxy.log" on Windows (DOS wildcard rules), so match the rotated suffix explicitly
  foreach ($f in (Get-ChildItem $PxDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.log\.\d+$' })) { $freed += $f.Length; Remove-Item $f.FullName -Force }
  if (Test-Path $Events) {
    $before = (Get-Item $Events).Length
    if ($All) { Remove-Item $Events -Force; Say "events.jsonl removed (all savings history)" "Yellow"; $freed += $before }
    else {
      $days = 30; $cut = (Get-Date).ToUniversalTime().AddDays(-$days).ToString("yyyy-MM-ddTHH:mm:ss")
      $keep = Get-Content $Events | Where-Object { $_ -match '"ts":"([^"]+)"' -and $Matches[1] -ge $cut }
      Set-Content -Path $Events -Value $keep -Encoding UTF8
      $freed += ($before - (Get-Item $Events).Length)
      Say "events.jsonl trimmed to the last $days days ($(@($keep).Count) events)" "Gray"
    }
  }
  foreach ($f in @($Log, $LogErr, $WarpLog, $WarpErr)) {
    if ((Test-Path $f) -and (Get-Item $f).Length -gt 5MB -and -not (Test-Listening $Port)) { $freed += (Get-Item $f).Length; Clear-Content $f }
  }
  Say ("clean: freed {0:n1} MB in {1}" -f ($freed / 1MB), $PxDir) "Green"
  Say "(use -All to also drop events.jsonl; run 'pxpipe-ctl stop' first to truncate live logs)" "DarkGray"
}
function Run-Update {
  $ErrorActionPreference = "Continue"   # npm/winget chatter on stderr must not abort the run
  Say "update: pxpipe-proxy (npm) + rtk (winget), then restart daemons" "White"
  if (Have npm) { & npm install -g pxpipe-proxy@latest --no-fund --no-audit 2>&1 | Where-Object { $_ -match 'added|changed|up to date|pxpipe' } | ForEach-Object { Say "  npm: $_" } }
  else { Say "  npm not found, skipping pxpipe" "Yellow" }
  if (Have winget) { & winget upgrade --id rtk-ai.rtk -e --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Select-Object -Last 2 | ForEach-Object { Say "  winget: $_" } }
  else { Say "  winget not found, skipping rtk" "Yellow" }
  Stop-All; Start-All
  Say "  pxpipe $(Get-Version pxpipe '--version')   rtk $(Get-Version rtk '--version')" "Green"
  Say "  (the stack scripts themselves update by re-running install.ps1 from a newer zip)" "DarkGray"
}
function Run-Config {
  $sub = if ($Arg1) { $Arg1.ToLower() } else { "list" }
  switch ($sub) {
    "list"  { if ($Cfg.Count -eq 0) { Say "no daemon config ($DaemonEnv). Common keys:" "Gray" } else { foreach ($k in $Cfg.Keys) { Write-Host "  $k=$($Cfg[$k])" } ; Say "" }
              Say "  PXPIPE_MODELS       comma list of model bases pxpipe images (default: claude-fable-5,gemini-3.6-flash,gemini-3.7-flash; 'off' disables imaging)" "DarkGray"
              Say "  PXPIPE_DISABLE      1 = passthrough mode, still logs usage + baselines (A/B / troubleshooting)" "DarkGray"
              Say "  PXPIPE_MAX_REQUEST_BYTES  request size cap in bytes" "DarkGray"
              Say "  PXPIPE_LOG          events.jsonl path;  PXPIPE_PORT / PXPIPE_WARP_PORT  move the daemons" "DarkGray"
              Say "  usage: pxpipe-ctl config set KEY VALUE | unset KEY | get KEY   (then: pxpipe-ctl restart)" "DarkGray" }
    "get"   { $k = $Arg2; if (-not $k) { throw "usage: pxpipe-ctl config get KEY" }; if ($Cfg.Contains($k)) { Write-Host $Cfg[$k] } else { Write-Host "(unset)" } }
    "set"   { $k = $Arg2; $v = $Arg3
              if (-not $k -or -not $v) { throw "usage: pxpipe-ctl config set KEY VALUE" }
              if ($k -notmatch '^[A-Z][A-Z0-9_]*$') { throw "key must look like PXPIPE_SOMETHING" }
              $Cfg[$k] = $v; Write-DaemonEnv $Cfg; Say "set $k=$v  (applies on next start: pxpipe-ctl restart)" "Green" }
    "unset" { $k = $Arg2; if (-not $k) { throw "usage: pxpipe-ctl config unset KEY" }; if ($Cfg.Contains($k)) { $Cfg.Remove($k); Write-DaemonEnv $Cfg; Say "unset $k (restart to apply)" "Yellow" } else { Say "$k was not set" "DarkGray" } }
    default { throw "usage: pxpipe-ctl config list|get KEY|set KEY VALUE|unset KEY" }
  }
}
function Run-Autostart {
  $sub = if ($Arg1) { $Arg1.ToLower() } else { "status" }
  switch ($sub) {
    "on"  { # schtasks /TR takes one quoted string; inner quotes around the script path are escaped as \"
            $tr = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$Self\`" start -Quiet"
            & cmd /c "schtasks /Create /TN `"$TaskName`" /SC ONLOGON /RL LIMITED /F /TR `"$tr`" >nul 2>&1"
            if ($LASTEXITCODE -eq 0) { Say "autostart: logon task '$TaskName' created (daemons start at Windows logon)" "Green" } else { throw "schtasks failed (exit $LASTEXITCODE)" } }
    "off" { & cmd /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"; Say "autostart: logon task removed" "Yellow" }
    default { Say "autostart: $(if (Test-AutostartTask) {'ON'} else {'off'})  (pxpipe-ctl autostart on|off)" "Gray" }
  }
}
function Show-Help {
  Write-Host @"

pxpipe-ctl - claude-token-stack daemon control

  start | stop | restart      pxpipe (:$Port) + warpd (:$WarpPort)
  status                      what is running, routing state, savings, autostart
  dashboard                   open $Base/ in the browser (pxpipe's own page)
  monitor [stop|open]         all-in-one monitor on $MonUrl/ (rtk + rules + pxpipe + warpd, per-request net savings, what is costing)
  logs [-All]                 tail proxy + warpd logs (-All: full files)
  desktop-on | desktop-off    always-on routing for the Claude desktop app + terminals (settings.json env + SessionStart hook)
  doctor [-Fix]               check every layer; -Fix applies safe repairs (start daemons, re-run desktop-on, rtk init -g)
  clean [-All]                trim events.jsonl to 30 days, drop rotated logs (-All: also delete events.jsonl)
  update                      npm install -g pxpipe-proxy@latest, winget upgrade rtk, restart
  config list|get|set|unset   persistent daemon env in $DaemonEnv (e.g. config set PXPIPE_MODELS off)
  autostart on|off|status     Windows logon task so the daemons are up before the first session
  setup                       the question-driven manager: what is installed + where, add/remove pieces, chat preferences

Panic switch: pxpipe-ctl desktop-off  (then restart the desktop app)   Docs: docs\HOW-IT-WORKS.md
"@
}

# ---------- dispatch ----------
switch ($Cmd.ToLower()) {
  "start"       { Start-All }
  "stop"        { Stop-All }
  "restart"     { Stop-All; Start-Sleep -Milliseconds 500; Start-All }
  "status"      { Show-Status }
  "dashboard"   { Start-Process "$Base/" }
  "monitor"     {
    switch ("$Arg1".ToLower()) {
      "stop" { Stop-ByPort $MonPort "monitor" }
      "open" { if (-not (Test-Listening $MonPort)) { Start-Monitor }; Start-Process "$MonUrl/" }
      default { Start-Monitor; Say "monitor: $MonUrl/   (pxpipe-ctl monitor open | stop)" "Cyan" }
    }
  }
  "logs"        {
    foreach ($pair in @(@("pxpipe", $Log), @("pxpipe.err", $LogErr), @("warpd", $WarpLog), @("warpd.err", $WarpErr))) {
      Write-Host "--- $($pair[0]) ($($pair[1])) ---" -ForegroundColor Cyan
      if (Test-Path $pair[1]) { if ($All) { Get-Content $pair[1] } else { Get-Content $pair[1] -Tail 25 } } else { Write-Host "(none)" }
    }
  }
  "desktop-on"  { Start-All; Enable-Desktop }
  "desktop-off" { Disable-Desktop }
  "doctor"      { Run-Doctor }
  "clean"       { Run-Clean }
  "update"      { Run-Update }
  "config"      { Run-Config }
  "autostart"   { Run-Autostart }
  "setup"       {
    # install.ps1 stages a copy of the repo here so this works after the downloaded zip is gone
    $setup = Join-Path $env:USERPROFILE ".claude\token-stack\src\setup.ps1"
    if (-not (Test-Path $setup)) { Write-Host "setup.ps1 not staged (older install). Run setup.cmd from the repo folder, or re-run install.ps1 once." -ForegroundColor Yellow; exit 1 }
    & $setup
  }
  "help"        { Show-Help }
  "-h"          { Show-Help }
  "--help"      { Show-Help }
  default       { Write-Host "unknown command '$Cmd'" -ForegroundColor Red; Show-Help; exit 2 }
}
