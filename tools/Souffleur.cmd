@echo off
setlocal EnableExtensions
rem Souffleur - PC launcher: opens the app in its own window (Chrome, else Edge, else default browser).
rem   Souffleur.cmd                 -> https://cmssmc-code.github.io/souffleur/
rem   Souffleur.cmd <URL>           -> another address (http://localhost:8080/, file:///E:/souffleur.html ...)
rem   Souffleur.cmd /installer      -> Desktop + Start menu shortcuts (Installer-Souffleur.ps1)
rem   Souffleur.cmd /uninstall      -> removes them
rem Keep this file pure ASCII with CRLF line endings (cmd.exe misreads UTF-8 batch files).

set "URL=https://cmssmc-code.github.io/souffleur/"
if /i "%~1"=="/installer" goto install
if /i "%~1"=="/install" goto install
if /i "%~1"=="/uninstall" goto uninstall
if /i "%~1"=="/desinstaller" goto uninstall
if not "%~1"=="" set "URL=%~1"

set "BROWSER="
call :try "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
call :try "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
call :try "%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER call :apppath chrome.exe
call :try "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
call :try "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER call :apppath msedge.exe

if not defined BROWSER goto fallback
start "" "%BROWSER%" --app="%URL%"
exit /b 0

:fallback
start "" "%URL%"
exit /b 0

:try
if defined BROWSER exit /b 0
if exist "%~1" set "BROWSER=%~1"
exit /b 0

:apppath
rem Registry "App Paths" lookup, independent of the Windows display language.
for /f "usebackq delims=" %%B in (`powershell -NoProfile -Command "foreach($h in 'HKCU:','HKLM:'){try{$v=(Get-Item -LiteralPath ($h+'\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%~1') -ErrorAction Stop).GetValue('');if($v){$v=$v.Trim([char]34);if(Test-Path -LiteralPath $v){$v;break}}}catch{}}" 2^>nul`) do if not defined BROWSER set "BROWSER=%%B"
exit /b 0

:install
if exist "%~dp0Installer-Souffleur.ps1" goto runinstaller
echo Fichier Installer-Souffleur.ps1 introuvable dans ce dossier.
pause
exit /b 1
:runinstaller
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Souffleur.ps1" %2 %3 %4 %5
exit /b %errorlevel%

:uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Souffleur.ps1" -Uninstall
exit /b %errorlevel%
