@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_PS1=%SCRIPT_DIR%install.ps1"
set "REMOTE_PS1=https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.ps1"

where powershell >nul 2>nul
if errorlevel 1 (
  echo error: missing required command: powershell 1>&2
  exit /b 1
)

if exist "%LOCAL_PS1%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%"
  exit /b %ERRORLEVEL%
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Invoke-RestMethod '%REMOTE_PS1%')"
exit /b %ERRORLEVEL%
