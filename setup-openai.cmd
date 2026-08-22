@echo off
setlocal
if /I "%~1"=="uninstall" goto uninstall
if /I "%~1"=="uninstall-dry-run" goto uninstall_dry_run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-openai.ps1" %*
exit /b %ERRORLEVEL%

:uninstall
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-openai.ps1"
exit /b %ERRORLEVEL%

:uninstall_dry_run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-openai.ps1" -DryRun
exit /b %ERRORLEVEL%
