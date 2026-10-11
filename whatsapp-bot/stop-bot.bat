@echo off
chcp 65001 >nul
echo ======================================================================
echo   ARRÊT DU BOT WHATSAPP EN ARRIÈRE-PLAN
echo ======================================================================
echo.

powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Processus bot arrete (PID ' + $_.ProcessId + ')') }"

echo.
echo ✅ Bot WhatsApp arrêté.
pause
