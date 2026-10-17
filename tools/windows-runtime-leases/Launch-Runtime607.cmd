@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Runtime607.ps1" %*
set "RUNTIME607_RESULT=%ERRORLEVEL%"
if not "%RUNTIME607_RESULT%"=="0" pause
exit /b %RUNTIME607_RESULT%
