@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_PS1=%SCRIPT_DIR%install.ps1"
set "REMOTE_PS1=https://raw.githubusercontent.com/superplan-md/cli/main/scripts/install.ps1"

where powershell >nul 2>nul
if errorlevel 1 (
  echo error: missing required command: powershell 1>&2
  exit /b 1
)

if exist "%LOCAL_PS1%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%"
  exit /b %ERRORLEVEL%
)

set "TEMP_PS1=%TEMP%\superplan-install-%RANDOM%%RANDOM%.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%REMOTE_PS1%' -OutFile '%TEMP_PS1%'"
if errorlevel 1 (
  echo error: failed to download installer from %REMOTE_PS1% 1>&2
  if exist "%TEMP_PS1%" del /f /q "%TEMP_PS1%" >nul 2>nul
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS1%"
set "EXIT_CODE=%ERRORLEVEL%"
if exist "%TEMP_PS1%" del /f /q "%TEMP_PS1%" >nul 2>nul
exit /b %EXIT_CODE%
