<#
.SYNOPSIS
  Launch Claude Code through pxpipe in "warp" mode (token-saving image-render proxy).
  Invoked through ..\claude-px.cmd so it runs regardless of PowerShell execution policy.

  All arguments pass straight to claude:
    claude-px
    claude-px -p "summarize this repo"
    claude-px --resume

  How it works (pxpipe warp): pxpipe starts a child-only CONNECT proxy, the claude
  process is told to use it via HTTPS_PROXY plus a per-user CA (~/.pxpipe/warp-ca.pem),
  and only api.anthropic.com/v1/messages is diverted into the local pxpipe proxy on
  127.0.0.1:47821. Everything else (OAuth, telemetry, claude.ai connectors,
  /remote-control) goes to its normal destination, so first-party features keep working.
  Nothing is added to the Windows certificate store.

  Bypass for one launch:  set PXPIPE_OFF=1 (cmd) / $env:PXPIPE_OFF=1 (PowerShell)
  Dashboard while running: http://127.0.0.1:47821/
#>
$ErrorActionPreference = 'Continue'
$ctl = Join-Path $PSScriptRoot 'pxpipe-ctl.ps1'

function Resolve-ClaudeExe {
  # warp needs a real executable path (a bare name would hit its POSIX-only PATH lookup).
  $c = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (Test-Path $c) { return $c }
  $g = Get-Command claude.exe -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  return $null
}

function Resolve-PxpipeCli {
  $p = Join-Path $env:APPDATA 'npm\node_modules\pxpipe-proxy\bin\cli.js'
  if (Test-Path $p) { return $p }
  try {
    $root = (& npm.cmd root -g 2>$null | Select-Object -First 1)
    if ($root) { $p = Join-Path $root 'pxpipe-proxy\bin\cli.js'; if (Test-Path $p) { return $p } }
  } catch {}
  return $null
}

function Invoke-ClaudePlain {
  # Fallback without pxpipe. Prefer the native exe (no .ps1 shim => no execution-policy issue).
  $exe = Resolve-ClaudeExe
  if ($exe) { & $exe @args; exit $LASTEXITCODE }
  & claude.cmd @args; exit $LASTEXITCODE
}

$off = $env:PXPIPE_OFF -match '^(1|true|yes|on)$'
if ($off) { Invoke-ClaudePlain @args }

$exe = Resolve-ClaudeExe
$cli = Resolve-PxpipeCli
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $exe -or -not $cli -or -not $node) {
  Write-Warning "[claude-px] missing piece (claude.exe=$([bool]$exe) pxpipe cli=$([bool]$cli) node=$([bool]$node)); launching claude WITHOUT pxpipe."
  Invoke-ClaudePlain @args
}

& $ctl start -Quiet
if ($LASTEXITCODE -ne 0) {
  Write-Warning "[claude-px] pxpipe proxy unavailable; launching claude WITHOUT it."
  Invoke-ClaudePlain @args
}

$exeSlash = $exe -replace '\\', '/'
Write-Host "[claude-px] pxpipe warp -> $exeSlash   (dashboard http://127.0.0.1:47821/)" -ForegroundColor DarkGray
# '--' must be quoted: PowerShell otherwise consumes it before it reaches pxpipe.
& $node $cli warp '--' $exeSlash @args
exit $LASTEXITCODE
