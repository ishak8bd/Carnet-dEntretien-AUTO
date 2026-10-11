@echo off
chcp 65001 >nul
title Carnet d'Entretien - Test d'Envoi d'E-mails
cls
echo ======================================================================
echo   TEST IMMEDIAT DES ALERTES D'ENTRETIEN PAR E-MAIL (FORCE SEND)
echo ======================================================================
echo.
echo Ce test ignore le delai d'attente (cooldown) et envoie immediatement
echo le bilan des echeances aux destinataires configures.
echo.
cd /d "%~dp0\.."
node scripts/send-email-reminders.mjs --force
echo.
echo ======================================================================
echo Verification terminee ! Consultez scripts/reminders.log pour l'historique.
echo ======================================================================
pause
