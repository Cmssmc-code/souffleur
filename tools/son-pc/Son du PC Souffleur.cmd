@echo off
rem Souffleur - "Son du PC" : capte en interne le son de Windows pour le mode "Appel ou visio sur ce PC (son interne)".
rem Lance le programme en arriere-plan (sans fenetre) : ecoute + transcription locales. Journal : %LOCALAPPDATA%\Souffleur\son-pc.log
rem Keep this file pure ASCII with CRLF line endings.
setlocal
set "HERE=%~dp0"
where pythonw >nul 2>nul
if errorlevel 1 (
  echo Python est introuvable. Installez Python 3 puis : pip install pyaudiowpatch numpy websockets faster-whisper
  pause
  exit /b 1
)
start "" pythonw "%HERE%souffleur_son_pc.py"
exit /b 0
