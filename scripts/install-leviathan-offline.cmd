@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-offline.ps1"
if errorlevel 1 (
  echo.
  echo Leviathan offline installation failed.
  pause
  exit /b 1
)
echo.
pause
