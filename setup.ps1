<#
  setup.ps1 - the "just ask me" front end for claude-token-stack.

    double-click setup.cmd      or      powershell -ExecutionPolicy Bypass -File .\setup.ps1
    later, from anywhere:  pxpipe-ctl setup    (uses the copy install.ps1 staged in ~\.claude\token-stack\src)

  Shows what is installed and where, lets you add / remove / toggle one piece at a time, or asks
  three questions and runs the right install. Everything it does is a call to install.ps1,
  uninstall.ps1 or pxpipe-ctl - there is no second code path doing its own thing.
#>
param([switch]$Quick)

$ErrorActionPreference = "Stop"
$Repo      = $PSScriptRoot
$UserHome  = $env:USERPROFILE
$Bin       = Join-Path $UserHome ".local\bin"
$ClaudeDir = Join-Path $UserHome ".claude"
$Settings  = Join-Path $ClaudeDir "settings.json"
$PxDir     = Join-Path $UserHome ".pxpipe"
$Ctl       = Join-Path $Bin "lib\pxpipe-ctl.ps1"
$Installer = Join-Path $Repo "install.ps1"
$Uninst    = Join-Path $Repo "uninstall.ps1"
$ChatPrefs = Join-Path $Repo "stack\chat-preferences.md"
$Profiles  = @("default","compressed","coding","analysis","agents")
$env:Path  = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")

foreach ($p in $Installer, $Uninst, $ChatPrefs) { if (-not (Test-Path $p)) { throw "missing $p - run setup from the extracted repo folder (or via 'pxpipe-ctl setup')" } }

# ---------------------------------------------------------------- tiny ui helpers
function Say($m, $c = "Gray") { Write-Host $m -ForegroundColor $c }
function Ask($q, $default = "") {
  $r = Read-Host ("  " + $q + $(if ($default -ne "") { " [$default]" } else { "" }))
  if ("$r".Trim() -eq "") { return $default } else { return "$r".Trim() }
}
function Yes($q, $default = $true) {
  $r = Ask $q $(if ($default) { "Y/n" } else { "y/N" })
  if ($r -eq "Y/n") { return $true }; if ($r -eq "y/N") { return $false }
  return ($r -match '^[yY]')
}
function Pick($q, $opts, $default = 1) {
  Say ""; Say "  $q" "White"
  for ($i = 0; $i -lt $opts.Count; $i++) { Say ("    {0}) {1}" -f ($i + 1), $opts[$i]) }
  while ($true) {
    $r = Ask "pick" "$default"
    if ($r -match '^\d+$' -and [int]$r -ge 1 -and [int]$r -le $opts.Count) { return [int]$r }
    Say "  1-$($opts.Count) please" "Yellow"
  }
}
function Pause() { [void](Read-Host "  (enter to continue)") }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Listening($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $ok = $c.BeginConnect("127.0.0.1", $port, $null, $null).AsyncWaitHandle.WaitOne(300) -and $c.Connected; $c.Close(); return $ok } catch { return $false }
}
function Kb($path) { if (Test-Path $path) { "{0:n1} KB" -f ((Get-Item $path).Length / 1KB) } else { "missing" } }
function Run-Install([string[]]$flags) {
  Say ""; Say "  > install.ps1 $($flags -join ' ')" "DarkCyan"
  & $Installer @flags
}
function Run-Uninstall([string[]]$flags) {
  Say ""; Say "  > uninstall.ps1 $($flags -join ' ')" "DarkCyan"
  & $Uninst @flags
}
function Run-Ctl([string[]]$a) {
  if (-not (Test-Path $Ctl)) { Say "  pxpipe-ctl is not installed (add pxpipe first)" "Yellow"; return }
  & $Ctl @a
}

# ---------------------------------------------------------------- what is installed, and where
function Get-State {
  $s = @{}
  $json = $null
  if (Test-Path $Settings) { try { $json = (Get-Content $Settings -Raw) | ConvertFrom-Json } catch { $json = $null } }

  # rtk
  $rtk = Get-Command rtk -ErrorAction SilentlyContinue
  $s.rtkPath = if ($rtk) { $rtk.Source } else { $null }
  $s.rtkVer  = if ($rtk) { try { (& rtk --version 2>$null | Select-Object -First 1) -replace '^rtk\s*', '' } catch { "?" } } else { $null }
  $s.rtkHook = $false
  if ($json -and $json.hooks -and $json.hooks.PreToolUse) {
    foreach ($h in @($json.hooks.PreToolUse)) { foreach ($x in @($h.hooks)) { if ("$($x.command)" -like 'rtk hook*') { $s.rtkHook = $true } } }
  }
  $s.rtkConfig = Join-Path $env:APPDATA "rtk\config.toml"
  $s.rtkData   = Join-Path $env:LOCALAPPDATA "rtk\history.db"

  # rules
  $cm = Join-Path $ClaudeDir "CLAUDE.md"; $rm = Join-Path $ClaudeDir "RTK.md"
  $s.rulesPath = $cm; $s.rulesOn = $false; $s.rulesProfile = $null; $s.rtkMd = (Test-Path $rm)
  if (Test-Path $cm) {
    $head = (Get-Content $cm -TotalCount 3) -join " "
    if ($head -match 'token-efficient|CLAUDE\.md - \w+ Profile') {
      $s.rulesOn = $true
      $s.rulesProfile = "default"
      foreach ($p in $Profiles) { $staged = Join-Path $ClaudeDir "token-stack\CLAUDE.$p.md"; if ((Test-Path $staged) -and ((Get-FileHash $staged).Hash -eq (Get-FileHash $cm).Hash)) { $s.rulesProfile = $p } }
      $ours = Join-Path $Repo "stack\CLAUDE.md"
      if ((Test-Path $ours) -and ((Get-FileHash $ours).Hash -ne (Get-FileHash $cm).Hash) -and $s.rulesProfile -eq "default") { $s.rulesProfile = "default (edited locally)" }
    }
  }
  $s.rulesBak = Test-Path "$cm.pre-token-stack.bak"

  # pxpipe / warpd / scripts
  $px = Get-Command pxpipe -ErrorAction SilentlyContinue
  $s.pxPath = if ($px) { $px.Source } else { $null }
  $s.pxVer  = if ($px) { try { (& pxpipe --version 2>$null | Select-Object -First 1) } catch { "?" } } else { $null }
  $s.ctl    = Test-Path $Ctl
  $s.warpd  = Test-Path (Join-Path $Bin "lib\warpd\warpd.ts")
  $s.monitorJs = Test-Path (Join-Path $Bin "lib\monitor.js")
  $s.onPath = (([Environment]::GetEnvironmentVariable("Path","User") -split ';') -contains $Bin)
  $s.p1 = Listening 47821; $s.p2 = Listening 47822; $s.p3 = Listening 47823
  $s.events = Join-Path $PxDir "events.jsonl"

  # always-on routing (settings.json env + SessionStart hook)
  $s.route = "off"
  if ($json -and $json.env) {
    $e = $json.env
    if ($e.PSObject.Properties["ANTHROPIC_BASE_URL"] -and "$($e.ANTHROPIC_BASE_URL)" -match '127\.0\.0\.1') { $s.route = "legacy" }
    else {
      $n = 0; foreach ($k in "HTTPS_PROXY","NO_PROXY","NODE_EXTRA_CA_CERTS") { if ($e.PSObject.Properties[$k]) { $n++ } }
      $s.route = if ($n -eq 3) { "on" } elseif ($n -eq 0) { "off" } else { "partial" }
    }
  }
  $s.sessionHook = $false
  if ($json -and $json.hooks -and $json.hooks.SessionStart) {
    foreach ($h in @($json.hooks.SessionStart)) { foreach ($x in @($h.hooks)) { if ("$($x.command)" -like '*pxpipe-ctl*') { $s.sessionHook = $true } } }
  }

  # logon task
  & cmd /c 'schtasks /Query /TN "pxpipe-ctl start" >nul 2>&1'
  $s.autostart = ($LASTEXITCODE -eq 0)
  return $s
}

function Show-Board($s) {
  Clear-Host
  Say ""
  Say "  claude-token-stack setup" "White"
  Say "  running from $Repo" "DarkGray"
  Say ""
  $rows = @(
    @("1", "rtk  (compacts tool output)",
        $(if ($s.rtkPath) { "installed $($s.rtkVer), hook $(if ($s.rtkHook) {'on'} else {'OFF'})" } else { "not installed" }),
        $(if ($s.rtkPath) { $s.rtkPath } else { "winget rtk-ai.rtk" })),
    @("2", "rules  (CLAUDE.md, shorter replies)",
        $(if ($s.rulesOn) { "installed, profile: $($s.rulesProfile)$(if (-not $s.rtkMd) {', RTK.md missing'})" } elseif (Test-Path $s.rulesPath) { "your own CLAUDE.md is there (not the stack's)" } else { "not installed" }),
        "$($s.rulesPath)$(if ($s.rulesBak) {'  (+ .pre-token-stack.bak)'})"),
    @("3", "pxpipe + warpd  (context proxy)",
        $(if ($s.pxPath -and $s.ctl) { "installed $($s.pxVer), " + $(if ($s.p1 -and $s.p2) { "running :47821/:47822" } elseif ($s.p1 -or $s.p2) { "HALF running" } else { "stopped" }) }
          elseif ($s.pxPath) { "npm package only, scripts missing" } else { "not installed" }),
        $(if ($s.pxPath) { "$($s.pxPath)  +  $Bin\pxpipe-ctl" } else { "npm -g pxpipe-proxy  +  $Bin" })),
    @("4", "always-on routing  (desktop app + terminals)",
        $(switch ($s.route) { "on" { "ON" + $(if (-not $s.sessionHook) {' (SessionStart hook missing)'}) } "off" { "off" } default { $s.route.ToUpper() + " - run doctor" } }),
        "$Settings  (env + SessionStart hook)"),
    @("5", "start at Windows logon",
        $(if ($s.autostart) { "ON" } else { "off" }),
        'Task Scheduler task "pxpipe-ctl start"'),
    @("6", "monitor  (all-in-one savings page)",
        $(if ($s.p3) { "running" } elseif ($s.monitorJs) { "stopped" } else { "not installed (part of 3)" }),
        "http://127.0.0.1:47823/"),
    @("7", "claude.ai chat preferences",
        "manual paste (no way to detect)",
        "$ChatPrefs")
  )
  foreach ($r in $rows) {
    $col = if ($r[2] -match '^(installed|ON|running|manual)') { "Green" } elseif ($r[2] -match 'not installed|off|stopped') { "DarkGray" } else { "Yellow" }
    Write-Host ("  {0}  {1,-46}" -f $r[0], $r[1]) -NoNewline
    Write-Host ("{0,-40}" -f $r[2]) -ForegroundColor $col -NoNewline
    Write-Host $r[3] -ForegroundColor DarkGray
  }
  Say ""
  Say "  Q quick setup (a few questions)     1-7 add / remove / toggle that piece" "White"
  Say "  W where is everything   D doctor    S status   U remove everything   R refresh   X exit" "White"
  Say ""
}

# ---------------------------------------------------------------- per-piece actions
function Do-Rtk($s) {
  if (-not $s.rtkPath) {
    if (Yes "Install rtk + ripgrep (winget) and its hook?") { Run-Install @("-SkipRules","-SkipPxpipe") }
    return
  }
  switch (Pick "rtk is installed. What now?" @("re-add its hook to settings.json (rtk init -g)", "remove the hook only (Claude stops using rtk, binary stays)", "remove rtk completely (hook + winget uninstall)", "back") 4) {
    1 { & rtk init -g }
    2 { Run-Uninstall @("-Part","rtk") }
    3 { if (Yes "Really uninstall rtk?" $false) { Run-Uninstall @("-Part","rtk","-RemoveTools") } }
  }
}
function Do-Rules($s) {
  $opts = @("install / switch profile", "remove the rules (restore your old CLAUDE.md if we backed one up)", "back")
  if (-not $s.rulesOn) { $opts[0] = "install the rules" }
  switch (Pick "rules (~\.claude\CLAUDE.md)" $opts 3) {
    1 {
      $i = Pick "Which flavor? (default = universal + coding profile, the one we use)" @(
        "default     - universal rules + condensed coding profile (recommended)",
        "compressed  - terser still, for high-volume sessions",
        "coding      - upstream's coding profile as-is",
        "analysis    - research / writing work",
        "agents      - many parallel agents") 1
      Run-Install @("-SkipRtk","-SkipPxpipe","-Profile",$Profiles[$i - 1])
    }
    2 { Run-Uninstall @("-Part","rules") }
  }
}
function Do-Pxpipe($s) {
  if (-not ($s.pxPath -and $s.ctl)) {
    if (Yes "Install pxpipe + warpd + pxpipe-ctl (npm) and switch always-on routing on?") { Run-Install @("-SkipRtk","-SkipRules") }
    elseif (Yes "Install them but leave routing OFF (opt in later with pxpipe-ctl desktop-on)?" $false) { Run-Install @("-SkipRtk","-SkipRules","-NoDesktop") }
    return
  }
  switch (Pick "pxpipe + warpd" @("restart the daemons", "stop the daemons (until the next Claude session starts them again)", "remove scripts + routing, keep the npm package", "remove everything pxpipe (npm uninstall, delete ~\.pxpipe)", "update pxpipe + rtk to latest", "back") 6) {
    1 { Run-Ctl @("restart") }
    2 { Run-Ctl @("stop") }
    3 { Run-Uninstall @("-Part","pxpipe") }
    4 { if (Yes "Really remove pxpipe, warpd, ~\.pxpipe (savings history included)?" $false) { Run-Uninstall @("-Part","pxpipe","-RemoveTools") } }
    5 { Run-Ctl @("update") }
  }
}
function Do-Routing($s) {
  if (-not $s.ctl) { Say "  pxpipe is not installed - add 3 first" "Yellow"; return }
  if ($s.route -eq "on") {
    if (Yes "Always-on routing is ON. Turn it OFF? (desktop app + terminals go straight to Anthropic again)" $false) { Run-Ctl @("desktop-off"); Say "  restart the Claude desktop app for it to notice" "Yellow" }
  } else {
    if (Yes "Turn always-on routing ON? (writes HTTPS_PROXY/NO_PROXY/NODE_EXTRA_CA_CERTS + a SessionStart hook to settings.json)") { Run-Ctl @("desktop-on"); Say "  restart the Claude desktop app for it to notice" "Yellow" }
  }
}
function Do-Autostart($s) {
  if (-not $s.ctl) { Say "  pxpipe is not installed - add 3 first" "Yellow"; return }
  if ($s.autostart) { if (Yes "Logon task is ON. Remove it?" $false) { Run-Ctl @("autostart","off") } }
  else { if (Yes "Create a Windows logon task so pxpipe + warpd are up before your first session?") { Run-Ctl @("autostart","on") } }
}
function Do-Monitor($s) {
  if (-not $s.ctl) { Say "  pxpipe is not installed - add 3 first" "Yellow"; return }
  if ($s.p3) {
    switch (Pick "monitor is running on http://127.0.0.1:47823/" @("open it in the browser", "stop it", "back") 1) {
      1 { Run-Ctl @("monitor","open") }
      2 { Run-Ctl @("monitor","stop") }
    }
  } else { Run-Ctl @("monitor","open") }
}
function Do-ChatPrefs {
  # pull the pasteable block out of stack\chat-preferences.md (the paragraph between the two --- rules)
  $raw = Get-Content $ChatPrefs -Raw
  $m = [regex]::Match($raw, '(?s)\r?\n---\r?\n\s*(.*?)\s*\r?\n---\r?\n')
  $block = if ($m.Success) { $m.Groups[1].Value } else { $raw }
  Say ""
  Say "  The claude.ai chat has no files or hooks, so the only layer that reaches it is the rules, pasted into your profile:" "White"
  Say ""
  Say "    1. claude.ai -> your initials (bottom left) -> Settings -> Profile" "Gray"
  Say '    2. Scroll to "What personal preferences should Claude consider in responses?"' "Gray"
  Say "    3. Paste the block below (it is on your clipboard now) and save." "Gray"
  Say ""
  Say "  You can also drop the same text into a Project's custom instructions to keep it per-project." "DarkGray"
  Say ""
  try { Set-Clipboard -Value $block; Say "  [copied to clipboard]" "Green" } catch { Say "  (could not touch the clipboard; copy from $ChatPrefs)" "Yellow" }
  Say ""
  Say ("  " + ($block -replace "`n", "`n  ")) "DarkGray"
  Say ""
  if (Yes "Open claude.ai settings in the browser now?") { Start-Process "https://claude.ai/settings/profile" }
}
function Do-Where($s) {
  Say ""; Say "  Where everything lives" "White"; Say ""
  $rows = @(
    @("rtk.exe",                  $(if ($s.rtkPath) { $s.rtkPath } else { "(not installed)" })),
    @("rg.exe (ripgrep, for rtk)", $(if (Have rg) { (Get-Command rg).Source } else { "(not installed)" })),
    @("rtk config",               "$($s.rtkConfig)  ($(Kb $s.rtkConfig))"),
    @("rtk savings ledger",       "$($s.rtkData)  ($(Kb $s.rtkData))"),
    @("rules",                    "$($s.rulesPath)  ($(Kb $s.rulesPath))"),
    @("rtk cheat-sheet",          "$ClaudeDir\RTK.md  ($(Kb "$ClaudeDir\RTK.md"))"),
    @("your old rules (backup)",  "$($s.rulesPath).pre-token-stack.bak  ($(Kb "$($s.rulesPath).pre-token-stack.bak"))"),
    @("Claude Code settings",     "$Settings  ($(Kb $Settings))  <- rtk hook, SessionStart hook, HTTPS_PROXY env"),
    @("settings backup",          "$Settings.pre-pxpipe.bak  ($(Kb "$Settings.pre-pxpipe.bak"))"),
    @("pxpipe (npm)",             $(if ($s.pxPath) { $s.pxPath } else { "(not installed)" })),
    @("pxpipe-ctl / claude-px",   "$Bin\pxpipe-ctl.cmd, claude-px.cmd  ->  $Bin\lib\*.ps1"),
    @("warpd (CONNECT proxy)",    "$Bin\lib\warpd\  ($(if ($s.warpd) {'present'} else {'missing'}))"),
    @("monitor",                  "$Bin\lib\monitor.js  ($(if ($s.monitorJs) {'present'} else {'missing'}))"),
    @("user PATH has ~\.local\bin", $(if ($s.onPath) { "yes" } else { "no" })),
    @("pxpipe state",             "$PxDir\  (events.jsonl $(Kb $s.events), warp-ca.pem, daemon.env, *.log)"),
    @("docs + staged setup copy", "$ClaudeDir\token-stack\  (README.md, chat-preferences.md, src\)"),
    @("ports",                    "47821 pxpipe $(if ($s.p1) {'UP'} else {'down'})   47822 warpd $(if ($s.p2) {'UP'} else {'down'})   47823 monitor $(if ($s.p3) {'UP'} else {'down'})"),
    @("logon task",               "schtasks 'pxpipe-ctl start' $(if ($s.autostart) {'present'} else {'absent'})")
  )
  foreach ($r in $rows) { Write-Host ("  {0,-28}" -f $r[0]) -NoNewline; Write-Host $r[1] -ForegroundColor DarkGray }
  Say ""
  Say "  Nothing machine-wide: no system proxy, no cert in the Windows store, no service. Delete the paths above and it is gone." "DarkGray"
}

# ---------------------------------------------------------------- quick setup (questions)
function Do-Quick {
  Say ""; Say "  Quick setup - a few questions, then it runs install.ps1 for you." "White"
  $where = Pick "Where do you use Claude?" @("Claude Code  (terminal and/or the desktop app)", "claude.ai chat only", "both") 3
  $flags = @()
  $doCode = ($where -ne 2); $doChat = ($where -ne 1)
  $autostart = $false
  if ($doCode) {
    $which = Pick "Which pieces?" @("all three: rtk + rules + pxpipe  (recommended, that is the point of the stack)", "let me pick") 1
    $rtk = $true; $rules = $true; $px = $true
    if ($which -eq 2) {
      $rtk   = Yes "rtk - compacts git/test/build output before Claude reads it?"
      $rules = Yes "rules - global CLAUDE.md that makes replies short and code-first?"
      $px    = Yes "pxpipe + warpd - proxy that renders old context to images (the big saver, adds ~1.4 s on long sessions)?"
    }
    if (-not $rtk)   { $flags += "-SkipRtk" }
    if (-not $rules) { $flags += "-SkipRules" }
    if (-not $px)    { $flags += "-SkipPxpipe" }
    if ($rules) {
      $i = Pick "Rules flavor?" @("default - universal + coding (recommended)", "compressed - terser", "coding", "analysis", "agents") 1
      if ($i -ne 1) { $flags += @("-Profile", $Profiles[$i - 1]) }
    }
    if ($px) {
      if (-not (Yes "Route the Claude desktop app + every terminal through pxpipe automatically (always-on)?")) { $flags += "-NoDesktop" }
      $autostart = Yes "Start the daemons at Windows logon (otherwise the first session of the day starts them, ~3 s pause)?" $false
    }
    if (-not ($rtk -or $rules -or $px)) { $doCode = $false }
  }
  Say ""
  Say "  Plan:" "White"
  if ($doCode) { Say "    install.ps1 $($flags -join ' ')" "Gray"; if ($autostart) { Say "    pxpipe-ctl autostart on" "Gray" } }
  if ($doChat) { Say "    copy the chat preferences to the clipboard + open claude.ai settings" "Gray" }
  if (-not ($doCode -or $doChat)) { Say "    nothing to do" "Gray"; return }
  if (-not (Yes "Go?")) { return }
  if ($doCode) { Run-Install $flags; if ($autostart) { Run-Ctl @("autostart","on") } }
  if ($doChat) { Do-ChatPrefs }
  Say ""; Say "  Done. Restart the Claude desktop app / open a new terminal for the changes to land." "Green"
}

# ---------------------------------------------------------------- loop
if ($Quick) { Do-Quick; Pause }
:main while ($true) {
  $s = Get-State
  Show-Board $s
  $k = (Ask "choice" "X").ToUpper()
  if ($k -eq "X") { break main }
  try {
    switch ($k) {
      "Q" { Do-Quick; Pause }
      "1" { Do-Rtk $s; Pause }
      "2" { Do-Rules $s; Pause }
      "3" { Do-Pxpipe $s; Pause }
      "4" { Do-Routing $s; Pause }
      "5" { Do-Autostart $s; Pause }
      "6" { Do-Monitor $s; Pause }
      "7" { Do-ChatPrefs; Pause }
      "W" { Do-Where $s; Pause }
      "D" { Run-Ctl @("doctor"); if (Yes "Apply safe fixes (doctor -Fix)?" $false) { Run-Ctl @("doctor","-Fix") }; Pause }
      "S" { Run-Ctl @("status"); Pause }
      "U" { if (Yes "Remove the whole stack (settings, hooks, scripts, rules)?" $false) { $t = Yes "Also uninstall rtk + pxpipe and delete ~\.pxpipe?" $false; Run-Uninstall $(if ($t) { @("-RemoveTools") } else { @() }) }; Pause }
      "R" { }
      default { Say "  ?" "Yellow"; Start-Sleep -Milliseconds 400 }
    }
  } catch {
    Say ""; Say "  failed: $($_.Exception.Message)" "Red"; Pause
  }
}
