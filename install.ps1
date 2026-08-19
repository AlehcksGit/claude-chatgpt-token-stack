<#
.SYNOPSIS
  One-shot Windows installer for claude-token-stack (rtk + claude-token-efficient rules + pxpipe/warpd).

  Run from the extracted repo folder (a GitHub .zip download is fine):
    powershell -ExecutionPolicy Bypass -File .\install.ps1

  Prefer questions over flags? Double-click setup.cmd (or: powershell -ExecutionPolicy Bypass -File .\setup.ps1).

  Options:
    -SkipRtk          do not install rtk/ripgrep or its hook
    -NoHook           install rtk but do not add its PreToolUse hook to settings.json
    -SkipRules        do not touch ~\.claude\CLAUDE.md / RTK.md
    -SkipPxpipe       do not install pxpipe/warpd/scripts
    -NoDesktop        install everything but leave always-on routing OFF (enable later: pxpipe-ctl desktop-on)
    -Profile <name>   which CLAUDE.md rules to install (re-run with -SkipRtk -SkipPxpipe to switch later):
                        default     stack\CLAUDE.md - the coding profile Alehcks uses (short, verify-before-assert)
                        compressed  upstream CLAUDE.compressed.md - terse output, biggest output-token cut
                        coding | analysis | agents   the other upstream profiles, unchanged, + @RTK.md
    -PxpipeVersion    npm version of pxpipe-proxy to install (default 0.13.1, the vendored one)

  Everything lands under your user profile:
    ~\.claude\CLAUDE.md, ~\.claude\RTK.md      (existing files backed up as *.pre-token-stack.bak)
    ~\.claude\settings.json                     (rtk PreToolUse hook; pxpipe env + SessionStart hook; backup settings.json.pre-pxpipe.bak)
    ~\.local\bin\                               (pxpipe-ctl, claude-px + lib\, added to user PATH)
    ~\.pxpipe\                                  (pxpipe state, warp CA, logs - created on first start)
  Re-runnable. Revert with uninstall.ps1.
#>
[CmdletBinding()]
param(
  [switch]$SkipRtk,
  [switch]$NoHook,
  [switch]$SkipRules,
  [switch]$SkipPxpipe,
  [switch]$NoDesktop,
  [ValidateSet("default","compressed","coding","analysis","agents")]
  [string]$Profile = "default",
  [string]$PxpipeVersion = "0.13.1"
)

$ErrorActionPreference = "Stop"
$Repo      = $PSScriptRoot
$UserHome  = $env:USERPROFILE
$Bin       = Join-Path $UserHome ".local\bin"
$ClaudeDir = Join-Path $UserHome ".claude"

function Step($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")
}
function BackupThenCopy($src, $dst, $suffix) {
  if (Test-Path $dst) {
    if ((Get-FileHash $src).Hash -eq (Get-FileHash $dst).Hash) { Write-Host "  $(Split-Path $dst -Leaf): already current"; return }
    $bak = "$dst$suffix"
    if (-not (Test-Path $bak)) { Copy-Item $dst $bak; Write-Host "  backed up existing $(Split-Path $dst -Leaf) -> $(Split-Path $bak -Leaf)" }
  }
  Copy-Item $src $dst -Force
  Write-Host "  installed $(Split-Path $dst -Leaf)"
}

foreach ($p in "stack\CLAUDE.md","stack\RTK.md","stack\bin\lib\pxpipe-ctl.ps1","stack\bin\lib\warpd\warpd.ts","stack\bin\lib\monitor.js","docs\HOW-IT-WORKS.md") {
  if (-not (Test-Path (Join-Path $Repo $p))) { throw "Missing $p - run this script from the extracted repo folder." }
}

Step "Prerequisites"
if (-not $SkipRtk -and -not (Have winget)) {
  throw "winget not found (needed for rtk + ripgrep). Install 'App Installer' from the Microsoft Store, or install rtk from https://github.com/rtk-ai/rtk/releases and re-run with -SkipRtk."
}
if (-not $SkipPxpipe) {
  if (-not (Have node) -or -not (Have npm)) { throw "Node.js/npm not found. Install Node 24 LTS (winget install OpenJS.NodeJS.LTS), open a NEW terminal, re-run." }
  $nodeVer = [version]((node --version).TrimStart('v'))
  if ($nodeVer -lt [version]"22.7.0") { throw "Node $nodeVer is too old: pxpipe needs >=20.19 and warpd needs >=22.7 (--experimental-transform-types). Node 24 LTS recommended." }
  Write-Host "  node $nodeVer, npm $(npm --version)"
}
if (-not (Have claude) -and -not (Test-Path "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc")) {
  Write-Warning "Neither the 'claude' CLI nor the Claude desktop app was found. Installing anyway; the stack activates when Claude Code is present."
}

# ---------------------------------------------------------------- Layer 1: rtk
if (-not $SkipRtk) {
  Step "Layer 1: rtk (CLI output compression) + ripgrep  [rtk-ai/rtk, Apache-2.0]"
  foreach ($id in "rtk-ai.rtk","BurntSushi.ripgrep.MSVC") {
    Write-Host "  winget install $id"
    # winget returns a non-zero code when the package is already current; that is fine.
    winget install --id $id -e --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
      Where-Object { $_ -match 'Successfully installed|already installed|No newer|No available upgrade|Found ' } | ForEach-Object { "    $_" }
  }
  RefreshPath
  if (-not (Have rtk)) { throw "rtk is not on PATH after install. Open a NEW terminal and re-run install.ps1." }
  Write-Host "  $(rtk --version)"
}

# ---------------------------------------------------------------- Layer 2: rules
New-Item -ItemType Directory -Force (Join-Path $ClaudeDir "token-stack") | Out-Null
if (-not $SkipRules) {
  Step "Layer 2: claude-token-efficient rules (profile: $Profile) -> ~\.claude\CLAUDE.md + RTK.md  [drona23/claude-token-efficient, MIT]"
  if ($Profile -eq "default") {
    $rulesSrc = Join-Path $Repo "stack\CLAUDE.md"
  } else {
    # upstream profile verbatim + the rtk import line, staged in ~\.claude\token-stack\ so BackupThenCopy can hash-compare it
    $up = Join-Path $Repo "upstream\claude-token-efficient\profiles\CLAUDE.$Profile.md"
    if (-not (Test-Path $up)) { throw "profile file missing: $up (the upstream\ folder ships with the repo zip)" }
    $rulesSrc = Join-Path $ClaudeDir "token-stack\CLAUDE.$Profile.md"
    $body = (Get-Content $up -Raw).TrimEnd()
    Set-Content -Path $rulesSrc -Encoding UTF8 -Value "$body`n`n@RTK.md`n"
  }
  BackupThenCopy $rulesSrc                           (Join-Path $ClaudeDir "CLAUDE.md") ".pre-token-stack.bak"
  BackupThenCopy (Join-Path $Repo "stack\RTK.md")    (Join-Path $ClaudeDir "RTK.md")    ".pre-token-stack.bak"
}
Copy-Item (Join-Path $Repo "docs\HOW-IT-WORKS.md")      (Join-Path $ClaudeDir "token-stack\README.md") -Force
Copy-Item (Join-Path $Repo "stack\chat-preferences.md") (Join-Path $ClaudeDir "token-stack\chat-preferences.md") -Force

# Stage a copy of the repo (scripts, rules, profiles, docs - not the big upstream trees) in ~\.claude\token-stack\src
# so `pxpipe-ctl setup` / setup.cmd keep working after the downloaded zip is gone.
$Src = Join-Path $ClaudeDir "token-stack\src"
if ((Resolve-Path $Repo).Path -ne $Src) {
  if (Test-Path $Src) { Remove-Item $Src -Recurse -Force }
  New-Item -ItemType Directory -Force (Join-Path $Src "upstream\claude-token-efficient") | Out-Null
  foreach ($p in "install.ps1","uninstall.ps1","setup.ps1","setup.cmd","install.sh","stack","docs","NOTICE.md","LICENSE") {
    if (Test-Path (Join-Path $Repo $p)) { Copy-Item (Join-Path $Repo $p) (Join-Path $Src $p) -Recurse -Force }
  }
  Copy-Item (Join-Path $Repo "upstream\claude-token-efficient\profiles") (Join-Path $Src "upstream\claude-token-efficient\profiles") -Recurse -Force
  Write-Host "  staged a copy of the scripts in $Src (for 'pxpipe-ctl setup' later)"
}

if (-not $SkipRtk -and -not $NoHook) {
  Step "rtk hook -> ~\.claude\settings.json  (rtk init -g)"
  # Adds the PreToolUse hook 'rtk hook claude'; leaves CLAUDE.md alone because it already contains '@RTK.md'.
  # rtk may ask once about anonymous telemetry; answer as you like (RTK_TELEMETRY_DISABLED=1 also works).
  rtk init -g
}

# ---------------------------------------------------------------- Layer 3: pxpipe + warpd
if (-not $SkipPxpipe) {
  Step "Layer 3: pxpipe $PxpipeVersion (image-render context proxy)  [teamchong/pxpipe, MIT]"
  npm install -g "pxpipe-proxy@$PxpipeVersion" --no-fund --no-audit 2>&1 | Where-Object { $_ -match 'added|changed|up to date|pxpipe' } | ForEach-Object { "  $_" }
  RefreshPath
  if (-not (Have pxpipe)) { throw "pxpipe is not on PATH after 'npm install -g'. Check 'npm config get prefix' is on PATH, open a NEW terminal, re-run." }
  Write-Host "  pxpipe $(pxpipe --version 2>&1 | Select-Object -First 1)"

  Step "Scripts -> $Bin  (pxpipe-ctl, claude-px, warpd)"
  New-Item -ItemType Directory -Force (Join-Path $Bin "lib\warpd") | Out-Null
  Copy-Item (Join-Path $Repo "stack\bin\*.cmd")         $Bin -Force
  Copy-Item (Join-Path $Repo "stack\bin\lib\*.ps1")     (Join-Path $Bin "lib") -Force
  Copy-Item (Join-Path $Repo "stack\bin\lib\monitor.js") (Join-Path $Bin "lib") -Force
  Copy-Item (Join-Path $Repo "stack\bin\lib\warpd\*")   (Join-Path $Bin "lib\warpd") -Force
  Get-ChildItem $Bin -Recurse -File -Include *.cmd,*.ps1,*.ts,*.js |ForEach-Object { "  $($_.FullName.Replace($UserHome + '\',''))" }

  $userPath = [Environment]::GetEnvironmentVariable("Path","User")
  if (($userPath -split ';') -notcontains $Bin) {
    [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(';')) + ";" + $Bin), "User")
    Write-Host "  added $Bin to the user PATH (new terminals pick it up)"
  } else { Write-Host "  $Bin already on the user PATH" }
  RefreshPath

  $ctl = Join-Path $Bin "lib\pxpipe-ctl.ps1"
  if ($NoDesktop) {
    Step "Starting pxpipe + warpd (always-on routing left OFF because of -NoDesktop)"
    & $ctl start
  } else {
    Step "Always-on routing: pxpipe-ctl desktop-on  (starts daemons, writes env + SessionStart hook to settings.json)"
    & $ctl desktop-on
  }
  Write-Host ""
  & $ctl status
}

Step "Done"
Write-Host @"
Next:
  1. Restart the Claude desktop app (if you use it) and open a NEW terminal.
  2. Check:   pxpipe-ctl status      pxpipe-ctl monitor open   (all-in-one page, http://127.0.0.1:47823/)
  3. Work as usual. Panic switch: pxpipe-ctl desktop-off  (then restart the desktop app)
  4. claude.ai chat too? The rules can be pasted into your chat preferences: setup.cmd -> 7 (or ~\.claude\token-stack\chat-preferences.md)
Add/remove pieces later: pxpipe-ctl setup (or setup.cmd)   Full write-up: docs\HOW-IT-WORKS.md   Revert everything: uninstall.ps1
"@
