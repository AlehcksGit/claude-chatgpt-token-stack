@echo off
rem pxpipe-ctl: start|stop|status|restart|dashboard|logs for the local pxpipe proxy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\pxpipe-ctl.ps1" %*
exit /b %ERRORLEVEL%
