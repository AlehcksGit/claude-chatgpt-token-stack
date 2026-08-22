@echo off
setlocal
node "%~dp0scripts\install-all.mjs"
if errorlevel 1 (
  echo.
  echo Native Context Compiler installation failed.
  pause
  exit /b 1
)
echo.
echo Native Context Compiler 0.6.2 low-latency mode installed successfully.
echo Restart ChatGPT/Codex, open /hooks, and trust the four reviewed Native Context Compiler hooks once.
echo The whole-turn Lean bridge remains disabled.
echo Then keep using local Work tasks normally.
pause
