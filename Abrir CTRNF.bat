@echo off
cd /d "%~dp0"
py -3 .\time_trial_gui.py
if errorlevel 1 (
  echo.
  echo No se pudo abrir el dashboard. Revisa que Python este instalado.
  pause
)
