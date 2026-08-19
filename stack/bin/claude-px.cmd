@echo off
rem claude-px: Claude Code through pxpipe (warp mode). Works from cmd, Windows PowerShell 5.1,
rem and pwsh regardless of execution policy. All args pass through to claude.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\claude-px.ps1" %*
exit /b %ERRORLEVEL%
