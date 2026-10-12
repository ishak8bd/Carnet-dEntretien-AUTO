@echo off
chcp 65001 >nul
title Carnet d'Entretien - Test Web Push Mobile
cls
echo ======================================================================
echo   TEST DIRECT DES NOTIFICATIONS WEB PUSH SUR SMARTPHONE / MOBILE
echo ======================================================================
echo.
echo Ce test envoie une notification Web Push en direct a tous les
echo appareils connectes a votre salle (meme si l'application est fermee).
echo.
cd /d "%~dp0\.."
node scripts/send-email-reminders.mjs --test-push
echo.
echo ======================================================================
echo Test termine !
echo ======================================================================
pause
