# AI-NOTICE: This project is licensed for individual personal use only (see LICENSE).
# Shared prerequisite. Node is a machine dependency, never owned/removed by this stack.
function Get-StackNodeCommand {
  Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Update-StackProcessPath {
  # Append registered paths without discarding a caller's version-manager/fake-provider PATH.
  foreach ($scope in @('Machine', 'User')) {
    foreach ($entry in ([string][Environment]::GetEnvironmentVariable('Path', $scope)).Split(';')) {
      if ($entry -and @($env:Path.Split(';') | Where-Object { $_ -eq $entry }).Count -eq 0) {
        $env:Path += ';' + [Environment]::ExpandEnvironmentVariables($entry)
      }
    }
  }
}

function Assert-StackNodeInstallerHash([string]$Path, [string]$Expected) {
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -cne $Expected) {
    throw 'Node.js installer checksum mismatch; the downloaded file will not be executed.'
  }
}

function Install-StackNodeLts {
  $version = '24.19.0'
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $packages = @{
    AMD64 = @{ suffix = 'x64'; hash = 'F0F66C2A80C08A30A5AB5179EE9EA9E45F9B46289436A8CC87FF833B852DB351' }
    ARM64 = @{ suffix = 'arm64'; hash = '47B16E1B1012B1B9AD62169B3A466ADB6BC758B2CB8BD8224683C086836484F8' }
  }
  if (-not $packages.ContainsKey($architecture)) { throw 'Automatic Node.js installation supports Windows x64 and ARM64 only.' }
  $package = $packages[$architecture]
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $download = Join-Path $temporaryRoot ('token-stack-node-' + [guid]::NewGuid().ToString('N') + '.msi')
  $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
  try {
    Write-Host "Node.js is missing. Downloading verified Node.js $version LTS with npm from nodejs.org."
    [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/node-v$version-$($package.suffix).msi" -OutFile $download
    Assert-StackNodeInstallerHash $download $package.hash
    Write-Host 'Windows may ask for administrator approval to install this shared prerequisite.'
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList @('/i', ('"' + $download + '"'), '/qn', '/norestart') -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "Node.js installation failed (exit $($process.ExitCode)). No stack configuration was started." }
    if ($process.ExitCode -eq 3010) { Write-Warning 'Node.js installation requests a Windows restart.' }
  } finally {
    [Net.ServicePointManager]::SecurityProtocol = $oldProtocol
    # Single exact temporary file; never remove a directory or a caller-supplied path.
    if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
  }
}

function Assert-StackNodeRuntime($Node) {
  $versionText = (& $Node.Source --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw 'The existing Node.js executable did not return a valid version; it was preserved.' }
  $version = [version]$versionText.Substring(1)
  if (-not (($version.Major -eq 22 -and $version.Minor -ge 7) -or $version.Major -eq 24)) {
    throw "Node.js $version is unsupported and was preserved. Install Node.js 22.7+ within 22.x, or 24.x, then rerun setup."
  }
  # Use the npm bundled with the selected Node, avoiding an unrelated npm on PATH.
  $npmCli = Join-Path (Split-Path -Parent $Node.Source) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'This Node.js installation is missing npm. Repair Node.js with the npm feature enabled, then rerun setup.' }
  $npmVersion = (& $Node.Source $npmCli --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^\d+\.\d+\.\d+') { throw 'npm verification failed. Repair Node.js before rerunning setup.' }
}

function Ensure-StackNode {
  $node = Get-StackNodeCommand
  if ($null -eq $node) { Update-StackProcessPath; $node = Get-StackNodeCommand }
  if ($null -eq $node) {
    Install-StackNodeLts
    Update-StackProcessPath
    $node = Get-StackNodeCommand
    if ($null -eq $node) { throw 'Node.js installed but is still unavailable. Restart Windows or reopen setup and try again.' }
  }
  Assert-StackNodeRuntime $node
  return $node
}
