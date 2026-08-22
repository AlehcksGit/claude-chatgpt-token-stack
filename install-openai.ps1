# AI-NOTICE: This project is licensed for individual personal use only (see LICENSE).
<#
.SYNOPSIS
  Installs the low-latency ChatGPT Work/Codex reduction stack.
.DESCRIPTION
  Keeps the lightweight RTK, tool-output receipt, turn-budget, and
  post-compaction hooks.
  Removes the synchronous whole-turn Lean bridge and desktop launcher override,
  so normal Work turns use OpenAI Codex directly without a nested model call.
#>
[CmdletBinding()]
param(
  [string]$TargetHome = $env:USERPROFILE,
  [switch]$DryRun,
  [switch]$SkipLegacyMigration
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Repo = [IO.Path]::GetFullPath($PSScriptRoot)
$TargetHome = [IO.Path]::GetFullPath($TargetHome)
$CurrentHome = [IO.Path]::GetFullPath($env:USERPROFILE)
$NccInstaller = Join-Path $Repo 'openai\native-context-compiler\scripts\install-all.mjs'

if ($TargetHome -ne $CurrentHome) {
  throw 'The Codex installer operates on the signed-in Windows user only.'
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) { throw 'Node.js was not found. Install Node.js 22.7+ or 24.x first.' }
if (-not (Test-Path -LiteralPath $NccInstaller -PathType Leaf)) {
  throw "Native Context Compiler payload is missing: $NccInstaller"
}

Write-Host ''
Write-Host 'ChatGPT Work / Codex low-latency stack 0.6.2' -ForegroundColor White
Write-Host '  Normal Work turns use OpenAI Codex directly.' -ForegroundColor DarkGray
Write-Host '  Whole-turn Lean bridge: removed from normal use.' -ForegroundColor DarkGray
Write-Host '  RTK, bounded receipts, turn budget, and compaction guidance: enabled.' -ForegroundColor DarkGray

if ($DryRun) {
  Write-Host "  [dry-run] node $NccInstaller"
  Write-Host 'Dry run complete; nothing was changed.' -ForegroundColor Yellow
  exit 0
}

& $node.Source $NccInstaller
if ($LASTEXITCODE -ne 0) { throw "Low-latency stack installation failed with exit code $LASTEXITCODE." }
$versionOutput = (& ncc.cmd --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -ne 'native-context-compiler 0.6.2') {
  throw "Installed diagnostics verification failed: $versionOutput"
}

Write-Host ''
Write-Host 'Codex low-latency mode is configured.' -ForegroundColor Green
Write-Host 'Restart ChatGPT/Codex once so it loads the updated hooks.' -ForegroundColor Yellow
Write-Host 'Claude configuration and the Claude/UE5 workflow were not changed.' -ForegroundColor DarkGray
exit 0
