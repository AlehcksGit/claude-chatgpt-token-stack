@echo off
rem claude-px: Claude Code through pxpipe (warp mode). Works from cmd, Windows PowerShell 5.1,
rem and pwsh regardless of execution policy. All args pass through to claude.
rem PSModulePath is cleared so 5.1 does not inherit pwsh 7 module dirs when launched from pwsh.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\claude-px.ps1" %*
exit /b %ERRORLEVEL%
