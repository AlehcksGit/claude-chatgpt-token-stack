<#
.SYNOPSIS
  Control the local pxpipe proxy (token-saving image-render proxy for Claude Code).
  Invoked through ..\pxpipe-ctl.cmd so it runs regardless of PowerShell execution policy.

.USAGE
  pxpipe-ctl start      # start proxy in background if not already listening
  pxpipe-ctl stop       # stop the background proxy
  pxpipe-ctl status     # is it running? dashboard URL, log path
  pxpipe-ctl restart
  pxpipe-ctl dashboard  # open http://127.0.0.1:47821/ in the browser
  pxpipe-ctl logs       # tail the proxy log
  pxpipe-ctl desktop-on   # route EVERY Claude Code session (desktop app + terminal) through pxpipe:
                          #   adds env.ANTHROPIC_BASE_URL + a SessionStart hook (auto-start proxy)
                          #   to ~/.claude/settings.json. Restart the desktop app afterwards.
  pxpipe-ctl desktop-off  # remove both again (revert). Restart the desktop app afterwards.

  Port: $env:PXPIPE_PORT (default 47821). Log: ~/.pxpipe/proxy.log
  Events (used by `pxpipe stats` and the dashboard): ~/.pxpipe/events.jsonl
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status', 'restart', 'dashboard', 'logs', 'desktop-on', 'desktop-off')]
  [string]$Cmd = 'status',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$Port = 47821
if ($env:PXPIPE_PORT) { $Port = [int]$env:PXPIPE_PORT }
$WarpPort = 47822
if ($env:PXPIPE_WARP_PORT) { $WarpPort = [int]$env:PXPIPE_WARP_PORT }
$Url = "http://127.0.0.1:$Port"
$WarpUrl = "http://127.0.0.1:$WarpPort"
$Home_ = $env:USERPROFILE
$LogDir = Join-Path $Home_ '.pxpipe'
$Log = Join-Path $LogDir 'proxy.log'
$ErrLog = Join-Path $LogDir 'proxy.err.log'
$WarpLog = Join-Path $LogDir 'warpd.log'
$WarpErrLog = Join-Path $LogDir 'warpd.err.log'
$WarpCa = Join-Path $LogDir 'warp-ca.pem'
$WarpdScript = Join-Path $PSScriptRoot 'warpd\warpd.ts'

function Say([string]$msg) { if (-not $Quiet) { Write-Host $msg } }

function Test-PortListening([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(300)) { return $false }
    $c.EndConnect($iar); return $true
  } catch { return $false } finally { $c.Close() }
}
function Test-Listening { return (Test-PortListening $Port) }
function Test-WarpListening { return (Test-PortListening $WarpPort) }

function Get-PortPid([int]$p) {
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}
function Get-ProxyPid { return (Get-PortPid $Port) }
function Get-WarpPid { return (Get-PortPid $WarpPort) }

function Start-Warpd {
  # Fixed-port warp daemon (see warpd\warpd.ts). Needs the pxpipe proxy to be up to be useful.
  if (Test-WarpListening) { Say "warpd already listening on $WarpUrl (pid $(Get-WarpPid))"; return $true }
  if (-not (Test-Path $WarpdScript)) { Write-Warning "warpd script missing: $WarpdScript"; return $false }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  $env:PXPIPE_PORT = "$Port"; $env:PXPIPE_WARP_PORT = "$WarpPort"
  Start-Process -FilePath $node -ArgumentList "--experimental-transform-types `"$WarpdScript`"" -WindowStyle Hidden `
    -RedirectStandardOutput $WarpLog -RedirectStandardError $WarpErrLog | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if (Test-WarpListening) { Say "warpd started on $WarpUrl (CA $WarpCa)  log: $WarpErrLog"; return $true }
    Start-Sleep -Milliseconds 250
  }
  Write-Warning "warpd did not start listening on $WarpPort within 15s. Last log lines:"
  if (Test-Path $WarpErrLog) { Get-Content $WarpErrLog -Tail 20 | ForEach-Object { Write-Warning $_ } }
  return $false
}

function Stop-Warpd {
  $p = Get-WarpPid
  if (-not $p) { Say "warpd is not running on port $WarpPort"; return }
  Stop-Process -Id $p -Force -Confirm:$false
  Say "stopped warpd (pid $p)"
}

function Resolve-PxpipeCli {
  # npm global install: %APPDATA%\npm\node_modules\pxpipe-proxy\bin\cli.js
  $p = Join-Path $env:APPDATA 'npm\node_modules\pxpipe-proxy\bin\cli.js'
  if (Test-Path $p) { return $p }
  try {
    $root = (& npm.cmd root -g 2>$null | Select-Object -First 1)
    if ($root) {
      $p = Join-Path $root 'pxpipe-proxy\bin\cli.js'
      if (Test-Path $p) { return $p }
    }
  } catch {}
  throw "pxpipe-proxy not found. Install with: npm install -g pxpipe-proxy"
}

function Start-Proxy {
  if (Test-Listening) {
    $p = Get-ProxyPid
    Say "pxpipe already listening on $Url (pid $p)"
    return $true
  }
  $cli = Resolve-PxpipeCli
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  # PORT is read by pxpipe; HOST stays loopback (default).
  $env:PORT = "$Port"
  Start-Process -FilePath $node -ArgumentList "`"$cli`"" -WindowStyle Hidden `
    -RedirectStandardOutput $Log -RedirectStandardError $ErrLog | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if (Test-Listening) {
      Say "pxpipe started on $Url (dashboard: $Url/)  log: $Log"
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  Write-Warning "pxpipe did not start listening on $Port within 15s. Last log lines:"
  if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 20 | ForEach-Object { Write-Warning $_ } }
  if (Test-Path $Log) { Get-Content $Log -Tail 20 | ForEach-Object { Write-Warning $_ } }
  return $false
}

function Stop-Proxy {
  $p = Get-ProxyPid
  if (-not $p) { Say "pxpipe is not running on port $Port"; return }
  Stop-Process -Id $p -Force -Confirm:$false
  Say "stopped pxpipe (pid $p)"
}

# ---- desktop-on / desktop-off: always-on routing via ~/.claude/settings.json ----
$SettingsPath = Join-Path $Home_ '.claude\settings.json'
$HookMarker = 'pxpipe-ctl.ps1'
$SelfPath = ($MyInvocation.MyCommand.Path -replace '\\', '/')
$HookCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$SelfPath`" start -Quiet"

function Read-Settings {
  if (-not (Test-Path $SettingsPath)) { return [pscustomobject]@{} }
  $raw = Get-Content $SettingsPath -Raw
  if (-not $raw.Trim()) { return [pscustomobject]@{} }
  return ($raw | ConvertFrom-Json)
}

function Write-Settings($obj) {
  Copy-Item $SettingsPath "$SettingsPath.pre-pxpipe.bak" -Force -ErrorAction SilentlyContinue
  $json = $obj | ConvertTo-Json -Depth 30
  # UTF-8 WITHOUT BOM: Windows PowerShell's `-Encoding UTF8` writes a BOM, which strict JSON
  # parsers (e.g. rtk's) reject even though Claude Code tolerates it.
  [System.IO.File]::WriteAllText($SettingsPath, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}

# The env keys desktop-on manages. HTTPS_PROXY + NODE_EXTRA_CA_CERTS make Claude Code (desktop
# engine included - it pins ANTHROPIC_BASE_URL but not these) send api.anthropic.com traffic through
# warpd, which diverts only /v1/messages* into pxpipe. NO_PROXY keeps local MCP servers direct.
# ANTHROPIC_BASE_URL is listed only so desktop-off also cleans up the older base-URL variant.
$ManagedEnv = [ordered]@{
  HTTPS_PROXY         = $WarpUrl
  NO_PROXY            = '127.0.0.1,localhost'
  NODE_EXTRA_CA_CERTS = $WarpCa
}
$LegacyEnvKeys = @('ANTHROPIC_BASE_URL')

function Test-DesktopOn {
  $s = Read-Settings
  $envOn = $false
  if ($s.PSObject.Properties['env']) {
    $envOn = $true
    foreach ($k in $ManagedEnv.Keys) { if (-not $s.env.PSObject.Properties[$k] -or "$($s.env.$k)" -ne "$($ManagedEnv[$k])") { $envOn = $false } }
  }
  $hookOn = $false
  if ($s.PSObject.Properties['hooks'] -and $s.hooks.PSObject.Properties['SessionStart']) {
    foreach ($e in @($s.hooks.SessionStart)) { foreach ($h in @($e.hooks)) { if ("$($h.command)" -like "*$HookMarker*") { $hookOn = $true } } }
  }
  return @{ env = $envOn; hook = $hookOn }
}

function Enable-Desktop {
  # Make sure the CA exists before pointing NODE_EXTRA_CA_CERTS at it.
  Start-Proxy | Out-Null
  Start-Warpd | Out-Null
  $s = Read-Settings
  if (-not $s.PSObject.Properties['env']) { $s | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
  foreach ($k in $LegacyEnvKeys) { if ($s.env.PSObject.Properties[$k]) { $s.env.PSObject.Properties.Remove($k) } }
  foreach ($k in $ManagedEnv.Keys) {
    if ($s.env.PSObject.Properties[$k]) { $s.env.$k = $ManagedEnv[$k] }
    else { $s.env | Add-Member -NotePropertyName $k -NotePropertyValue $ManagedEnv[$k] }
  }
  if (-not $s.PSObject.Properties['hooks']) { $s | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
  $entry = [pscustomobject]@{ hooks = @([pscustomobject]@{ type = 'command'; command = $HookCommand }) }
  $existing = @()
  if ($s.hooks.PSObject.Properties['SessionStart']) { $existing = @($s.hooks.SessionStart) | Where-Object { -not (@($_.hooks) | Where-Object { "$($_.command)" -like "*$HookMarker*" }) } }
  $new = @($existing) + @($entry)
  if ($s.hooks.PSObject.Properties['SessionStart']) { $s.hooks.SessionStart = $new } else { $s.hooks | Add-Member -NotePropertyName SessionStart -NotePropertyValue $new }
  Write-Settings $s
  Write-Host "desktop-on: ~/.claude/settings.json now has"
  foreach ($k in $ManagedEnv.Keys) { Write-Host ("  env.{0,-20} = {1}" -f $k, $ManagedEnv[$k]) }
  Write-Host "  hooks.SessionStart       -> $HookCommand   (starts pxpipe + warpd if needed)"
  Write-Host "Effect: every Claude Code session - desktop app AND terminal - sends api.anthropic.com/v1/messages"
  Write-Host "        through warpd -> pxpipe. ANTHROPIC_BASE_URL is untouched, so first-party features keep working."
  Write-Host "Restart the Claude desktop app (and open new terminals) for it to take effect."
  Write-Host "Revert any time: pxpipe-ctl desktop-off   (backup: $SettingsPath.pre-pxpipe.bak)"
}

function Disable-Desktop {
  $s = Read-Settings
  if ($s.PSObject.Properties['env']) {
    foreach ($k in @($ManagedEnv.Keys) + $LegacyEnvKeys) { if ($s.env.PSObject.Properties[$k]) { $s.env.PSObject.Properties.Remove($k) } }
    if (@($s.env.PSObject.Properties).Count -eq 0) { $s.PSObject.Properties.Remove('env') }
  }
  if ($s.PSObject.Properties['hooks'] -and $s.hooks.PSObject.Properties['SessionStart']) {
    $kept = @($s.hooks.SessionStart) | Where-Object { -not (@($_.hooks) | Where-Object { "$($_.command)" -like "*$HookMarker*" }) }
    if (@($kept).Count -gt 0) { $s.hooks.SessionStart = @($kept) } else { $s.hooks.PSObject.Properties.Remove('SessionStart') }
    if (@($s.hooks.PSObject.Properties).Count -eq 0) { $s.PSObject.Properties.Remove('hooks') }
  }
  Write-Settings $s
  Write-Host "desktop-off: removed the pxpipe env keys (HTTPS_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS, ANTHROPIC_BASE_URL) and the pxpipe SessionStart hook from ~/.claude/settings.json."
  Write-Host "Restart the Claude desktop app. Terminal sessions can still use: claude-px"
}

switch ($Cmd) {
  'start'   { $a = Start-Proxy; $b = Start-Warpd; if ($a -and $b) { exit 0 } else { exit 1 } }
  'stop'    { Stop-Warpd; Stop-Proxy }
  'restart' { Stop-Warpd; Stop-Proxy; Start-Sleep -Milliseconds 500; $a = Start-Proxy; $b = Start-Warpd; if ($a -and $b) { exit 0 } else { exit 1 } }
  'status'  {
    if (Test-Listening) {
      Write-Host "pxpipe: RUNNING on $Url (pid $(Get-ProxyPid))"
      Write-Host "  dashboard: $Url/"
    } else {
      Write-Host "pxpipe: STOPPED (port $Port)"
    }
    if (Test-WarpListening) { Write-Host "warpd:  RUNNING on $WarpUrl (pid $(Get-WarpPid))  CA: $WarpCa" } else { Write-Host "warpd:  STOPPED (port $WarpPort)" }
    Write-Host "  log:     $Log  |  $WarpErrLog"
    Write-Host "  events:  $(Join-Path $LogDir 'events.jsonl')  (offline report: pxpipe stats)"
    $d = Test-DesktopOn
    if ($d.env -and $d.hook) { Write-Host "  always-on (settings.json): ON - desktop app + terminal sessions route api.anthropic.com/v1/messages via warpd -> pxpipe. Revert: pxpipe-ctl desktop-off" }
    elseif ($d.env -or $d.hook) { Write-Host "  always-on (settings.json): PARTIAL (env=$($d.env) hook=$($d.hook)) - run desktop-on or desktop-off to fix" }
    else { Write-Host "  always-on (settings.json): off (terminal: use claude-px; everything incl. desktop app: pxpipe-ctl desktop-on)" }
  }
  'desktop-on'  { Enable-Desktop }
  'desktop-off' { Disable-Desktop }
  'dashboard' { if (-not (Test-Listening)) { Start-Proxy | Out-Null }; Start-Process "$Url/" }
  'logs'    { if (Test-Path $Log) { Get-Content $Log -Tail 40 } else { Write-Host "no log at $Log" } }
}
