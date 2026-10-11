@echo off
chcp 65001 >nul
title Carnet d'Entretien - Test E-mail Diagnostic
cls
echo ======================================================================
echo   TEST DIAGNOSTIC DE CONNEXION GMAIL & MODELE D'E-MAIL
echo ======================================================================
echo.
echo Ce test envoie un e-mail modele pour verifier le fonctionnement de
echo l'expediteur Gmail et des styles d'e-mail.
echo.
cd /d "%~dp0\.."
node scripts/send-email-reminders.mjs --test
echo.
echo ======================================================================
echo Test termine ! Verifiez votre boite de reception.
echo ======================================================================
pause
