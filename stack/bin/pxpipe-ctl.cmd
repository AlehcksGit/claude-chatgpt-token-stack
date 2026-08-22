@echo off
setlocal
rem pxpipe-ctl: start|stop|status|restart|dashboard|logs|doctor|setup for the local pxpipe proxy.
rem PSModulePath is cleared so 5.1 does not inherit pwsh 7 module dirs when launched from pwsh.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\pxpipe-ctl.ps1" %*
set "CTS_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CTS_EXIT%
