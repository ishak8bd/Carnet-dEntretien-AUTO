@echo off
chcp 65001 >nul
echo ======================================================================
echo   DÉMARRAGE DU BOT WHATSAPP EN ARRIÈRE-PLAN (SANS TERMINAL)
echo ======================================================================
echo.
echo Le Bot WhatsApp va être lancé en tâche de fond discrète.
echo Vous pourrez fermer cette fenêtre, le bot continuera à tourner !
echo.

wscript.exe "%~dp0run-bot-silent.vbs"

echo ✅ Le bot WhatsApp est lancé en arrière-plan !
echo Vous pouvez vérifier les logs dans whatsapp-bot\bot.log ou taper !test sur WhatsApp.
echo.
pause
