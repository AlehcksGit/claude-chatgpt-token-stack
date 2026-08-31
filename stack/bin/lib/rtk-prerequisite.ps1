# AI-NOTICE: This project is licensed for individual personal use only (see LICENSE).
# Codex-only installs need RTK too. Shared prerequisites are retained on uninstall.
function Get-StackRtkCommand {
  Get-Command rtk.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Install-StackRtkPackage {
  $manager = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($null -eq $manager) { throw 'Install Microsoft App Installer (winget), then rerun setup to install RTK.' }
  $inventory = (& $manager.Source list --id rtk-ai.rtk -e --source winget --accept-source-agreements --disable-interactivity 2>&1 | Out-String)
  $inventoryCode = $LASTEXITCODE
  if ($inventoryCode -eq 0) { throw 'RTK is already installed but unavailable on PATH; reopen setup or repair its PATH. The existing package was preserved.' }
  if ($inventoryCode -ne -1978335212 -and $inventory -notmatch 'No installed package found') {
    throw 'RTK package inventory could not establish absence; no package was installed.'
  }
  & $manager.Source install --id rtk-ai.rtk -e --source winget --version 0.45.0 --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "RTK installation failed (exit $LASTEXITCODE). No Codex configuration was started." }
}
function Ensure-StackRtk {
  $rtk = Get-StackRtkCommand
  if ($null -eq $rtk) { Update-StackProcessPath; $rtk = Get-StackRtkCommand }
  if ($null -eq $rtk) { Install-StackRtkPackage; Update-StackProcessPath; $rtk = Get-StackRtkCommand }
  if ($null -eq $rtk) { throw 'RTK installed but remains unavailable; reopen setup and try again.' }
  $version = (& $rtk.Source --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '(?<![0-9])0\.45\.0(?![0-9])') {
    throw "Existing RTK was preserved; this release requires RTK 0.45.0 (found: $version)."
  }
}
