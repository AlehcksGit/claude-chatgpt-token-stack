param([string]$Engine)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'TestHelpers.ps1')
. (Join-Path $RepoRoot 'stack\bin\lib\node-prerequisite.ps1')
$suite = New-TestSuiteRoot 'node-prerequisite'
$runtimeCheck = ${function:Assert-StackNodeRuntime}
$script:installs = 0
$script:refreshes = 0
$script:available = $false
$script:installSucceeds = $true
$script:refreshFindsNode = $false
function Get-StackNodeCommand { if ($script:available) { return [pscustomobject]@{ Source = $script:fakeNode } } }
function Update-StackProcessPath { $script:refreshes++; if ($script:refreshFindsNode) { $script:available = $true } }
function Install-StackNodeLts { $script:installs++; if (-not $script:installSucceeds) { throw 'fixture installer failure' }; $script:available = $true }
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
  $caught = $null
  try { & $Action } catch { $caught = $_.Exception.Message }
  if (-not $caught -or $caught -notmatch $Pattern) { throw "Expected failure '$Pattern', got '$caught'" }
}
try {
  $script:fakeNode = Join-Path $suite 'node.ps1'
  $npmCli = Join-Path $suite 'node_modules\npm\bin\npm-cli.js'
  [void](New-Item -ItemType Directory -Path (Split-Path -Parent $npmCli) -Force)
  Set-Content -LiteralPath $npmCli -Value '// fixture only'
  Set-Content -LiteralPath $script:fakeNode -Value 'if ($args[0] -eq "--version") { "v24.19.0" } else { "11.11.1" }; $global:LASTEXITCODE = 0'
  [void](Ensure-StackNode)
  Assert-True ($script:installs -eq 1) 'Missing Node must install exactly once'
  [void](Ensure-StackNode)
  Assert-True ($script:installs -eq 1) 'Existing Node must be preserved on repeat'
  $script:available = $false; $script:refreshFindsNode = $true
  [void](Ensure-StackNode)
  Assert-True ($script:installs -eq 1) 'Stale PATH must not reinstall Node'
  $script:available = $false; $script:refreshFindsNode = $false; $script:installSucceeds = $false
  Assert-Fails { Ensure-StackNode } 'fixture installer failure'
  $script:available = $true
  foreach ($version in @('22.6.0','23.0.0','25.0.0')) {
    Set-Content -LiteralPath $script:fakeNode -Value ('"v' + $version + '"; $global:LASTEXITCODE = 0')
    Assert-Fails { Ensure-StackNode } 'unsupported and was preserved'
  }
  Assert-True ($script:installs -eq 2) 'Unsupported versions must not trigger replacement'
  foreach ($version in @('22.7.0','22.99.0','24.19.0')) {
    Set-Content -LiteralPath $script:fakeNode -Value ('if ($args[0] -eq "--version") { "v' + $version + '" } else { "11.11.1" }; $global:LASTEXITCODE = 0')
    [void](Ensure-StackNode)
  }
  Remove-Item -LiteralPath $npmCli
  Assert-Fails { Ensure-StackNode } 'missing npm'
  $badInstaller = Join-Path $suite 'tampered.msi'
  Set-Content -LiteralPath $badInstaller -Value 'not a trusted installer'
  Assert-Fails { Assert-StackNodeInstallerHash $badInstaller ('0' * 64) } 'checksum mismatch'
  Assert-StackNodeInstallerHash $badInstaller (Get-FileHash -LiteralPath $badInstaller -Algorithm SHA256).Hash
  . (Join-Path $RepoRoot 'stack\bin\lib\rtk-prerequisite.ps1')
  $script:rtkAvailable=$false; $script:rtkInstalls=0
  $script:fakeRtk=Join-Path $suite 'rtk.ps1'
  Set-Content -LiteralPath $script:fakeRtk -Value '"rtk 0.45.0"; $global:LASTEXITCODE=0'
  function Get-StackRtkCommand { if($script:rtkAvailable){return [pscustomobject]@{Source=$script:fakeRtk}} }
  function Install-StackRtkPackage { $script:rtkInstalls++; $script:rtkAvailable=$true }
  Ensure-StackRtk; Ensure-StackRtk
  Assert-True ($script:rtkInstalls -eq 1) 'Codex-only RTK must install only when absent'
  Set-Content -LiteralPath $script:fakeRtk -Value '"rtk 0.42.4"; $global:LASTEXITCODE=0'
  Assert-Fails { Ensure-StackRtk } 'Existing RTK was preserved'
  Assert-True ($script:rtkInstalls -eq 1) 'Existing incompatible RTK must not be overwritten'
  $dryRoot = Join-Path $suite 'dry-profile'
  $environment = Get-TestEnvironment $dryRoot
  $environment['PATH'] = (Join-Path $env:SystemRoot 'System32')
  $result = Invoke-TestPowerShell $Engine (Join-Path $RepoRoot 'install-openai.ps1') @('-TargetHome',$dryRoot,'-DryRun') $environment
  Assert-True ($result.Code -eq 0) ('OpenAI dry run must succeed with no Node on PATH: ' + $result.Output)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRoot '.codex'))) 'Dry run must not create Codex configuration'
  Write-Host 'PASS Node prerequisite: missing, repeat, stale PATH, failure, version bounds, npm, checksum, dry run'
} finally { Remove-TestSuiteRoot $suite }
