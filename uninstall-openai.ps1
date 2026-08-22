# AI-NOTICE: This project is licensed for individual personal use only (see LICENSE).
<#
.SYNOPSIS
  Removes Native Context Compiler hooks and managed guidance while preserving local data by default.
#>
[CmdletBinding()]
param(
  [string]$TargetHome = $env:USERPROFILE,
  [switch]$DryRun,
  [switch]$RemoveData,
  [switch]$RemoveTools
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Repo = [IO.Path]::GetFullPath($PSScriptRoot)
$TargetHome = [IO.Path]::GetFullPath($TargetHome)
$CurrentHome = [IO.Path]::GetFullPath($env:USERPROFILE)
$Script = Join-Path $Repo 'openai\native-context-compiler\scripts\uninstall-all.mjs'
$DataRoot = Join-Path $env:LOCALAPPDATA 'NativeContextCompiler'

if ($TargetHome -ne $CurrentHome) { throw 'The Codex uninstaller operates on the signed-in Windows user only.' }
if (-not (Test-Path -LiteralPath $Script -PathType Leaf)) { throw "Uninstaller payload is missing: $Script" }
if ($DryRun) {
  Write-Host '[dry-run] remove project-owned native Codex hook groups and managed AGENTS.md guidance'
  Write-Host '[dry-run] npm uninstall --global native-context-compiler'
  Write-Host $(if ($RemoveData) { "[dry-run] remove local sessions, evidence, settings, and metrics: $DataRoot" } else { "[dry-run] preserve local sessions, evidence, settings, and metrics: $DataRoot" })
  exit 0
}

& node.exe $Script
if ($LASTEXITCODE -ne 0) { throw "Native Context Compiler uninstall failed with exit code $LASTEXITCODE." }

if ($RemoveData) {
  $resolved = [IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NativeContextCompiler')).TrimEnd('\')
  if (-not $resolved.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing unexpected data path: $resolved" }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  Write-Host "Removed local sessions, evidence, settings, and metrics: $resolved" -ForegroundColor Yellow
} else {
  Write-Host "Preserved local sessions, evidence, settings, and metrics: $DataRoot" -ForegroundColor DarkGray
}
if ($RemoveTools) { Write-Host 'The compiler package was removed. Claude-owned RTK and pxpipe were not changed.' -ForegroundColor DarkGray }
Write-Host 'Codex Native Context Compiler removed.' -ForegroundColor Green
exit 0
