@echo off
setlocal
rem Claude-ChatGPT Token Stack - safe Claude + ChatGPT/Codex lifecycle front end
rem PSModulePath is cleared so Windows PowerShell 5.1 does not inherit pwsh 7 module dirs
rem (that breaks Get-FileHash and friends when this is launched from a pwsh terminal).
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "CTS_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CTS_EXIT%
