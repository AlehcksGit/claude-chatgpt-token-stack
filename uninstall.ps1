<#
.SYNOPSIS
  Reverts what install.ps1 did.
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1                 # settings, hooks, scripts, rules; keeps rtk/pxpipe binaries and ~\.pxpipe
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveTools    # also: npm uninstall pxpipe-proxy, winget uninstall rtk, delete ~\.pxpipe (ripgrep is left alone)
#>
[CmdletBinding()]
param([switch]$RemoveTools)

$ErrorActionPreference = "Stop"
$Repo      = $PSScriptRoot
$UserHome  = $env:USERPROFILE
$Bin       = Join-Path $UserHome ".local\bin"
$ClaudeDir = Join-Path $UserHome ".claude"
$Settings  = Join-Path $ClaudeDir "settings.json"
$env:Path  = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")

function Step($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function SameFile($a, $b) { (Test-Path $a) -and (Test-Path $b) -and ((Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash) }

Step "Always-on routing off + daemons stopped"
$ctl = Join-Path $Bin "lib\pxpipe-ctl.ps1"
if (Test-Path $ctl) {
  & $ctl desktop-off
  & $ctl autostart off
  & $ctl stop
} else { Write-Host "  pxpipe-ctl not present, skipping" }

Step "rtk hook removed from settings.json"
if (Test-Path $Settings) {
  $raw = Get-Content $Settings -Raw
  $j = $raw | ConvertFrom-Json
  $changed = $false
  if ($j.hooks -and $j.hooks.PreToolUse) {
    $keep = @($j.hooks.PreToolUse | Where-Object { -not (@($_.hooks) | Where-Object { $_.command -like 'rtk hook*' }) })
    if ($keep.Count -ne @($j.hooks.PreToolUse).Count) {
      if ($keep.Count -gt 0) { $j.hooks.PreToolUse = $keep } else { $j.hooks.PSObject.Properties.Remove('PreToolUse') }
      if (-not ($j.hooks.PSObject.Properties | Measure-Object).Count) { $j.PSObject.Properties.Remove('hooks') }
      $changed = $true
    }
  }
  if ($changed) {
    [System.IO.File]::WriteAllText($Settings, ($j | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  removed 'rtk hook claude' PreToolUse entry"
  } else { Write-Host "  no rtk hook found" }
} else { Write-Host "  no settings.json" }

Step "Rule files restored"
foreach ($f in "CLAUDE.md","RTK.md") {
  $dst = Join-Path $ClaudeDir $f; $bak = "$dst.pre-token-stack.bak"; $ours = Join-Path $Repo "stack\$f"
  # a -Profile install stages its CLAUDE.md in ~\.claude\token-stack\CLAUDE.<profile>.md; treat those as ours too
  $staged = @(Get-ChildItem (Join-Path $ClaudeDir "token-stack") -Filter "CLAUDE.*.md" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $isOurs = (SameFile $dst $ours) -or (@($staged | Where-Object { SameFile $dst $_ }).Count -gt 0)
  if (Test-Path $bak) { Move-Item $bak $dst -Force; Write-Host "  $f restored from backup" }
  elseif ($isOurs) { Remove-Item $dst; Write-Host "  $f removed (was the stack's unmodified copy)" }
  elseif (Test-Path $dst) { Write-Host "  $f left in place (modified locally, no backup to restore)" }
}
Remove-Item (Join-Path $ClaudeDir "token-stack") -Recurse -Force -ErrorAction SilentlyContinue

Step "Scripts removed from $Bin"
foreach ($p in "pxpipe-ctl.cmd","claude-px.cmd","lib\pxpipe-ctl.ps1","lib\claude-px.ps1","lib\warpd") {
  $full = Join-Path $Bin $p
  if (Test-Path $full) { Remove-Item $full -Recurse -Force; Write-Host "  removed $p" }
}
foreach ($d in (Join-Path $Bin "lib"), $Bin) {
  if ((Test-Path $d) -and -not (Get-ChildItem $d -Force | Select-Object -First 1)) { Remove-Item $d; Write-Host "  removed empty $d" }
}
if (-not (Test-Path $Bin)) {
  $userPath = [Environment]::GetEnvironmentVariable("Path","User")
  $newPath = (($userPath -split ';') | Where-Object { $_ -and $_ -ne $Bin }) -join ';'
  if ($newPath -ne $userPath) { [Environment]::SetEnvironmentVariable("Path", $newPath, "User"); Write-Host "  removed $Bin from the user PATH" }
}

if ($RemoveTools) {
  Step "Removing tools (-RemoveTools)"
  if (Get-Command npm -ErrorAction SilentlyContinue) { npm uninstall -g pxpipe-proxy 2>&1 | Select-Object -Last 1 | ForEach-Object { "  npm: $_" } }
  if (Get-Command winget -ErrorAction SilentlyContinue) { winget uninstall --id rtk-ai.rtk -e --disable-interactivity 2>&1 | Select-Object -Last 1 | ForEach-Object { "  winget: $_" } }
  $px = Join-Path $UserHome ".pxpipe"
  if (Test-Path $px) { Remove-Item $px -Recurse -Force; Write-Host "  removed $px (proxy state, warp CA, logs)" }
  Write-Host "  ripgrep (BurntSushi.ripgrep.MSVC) left installed - general-purpose tool; remove with winget if you want."
}

Step "Done - restart the Claude desktop app / open a new terminal."
