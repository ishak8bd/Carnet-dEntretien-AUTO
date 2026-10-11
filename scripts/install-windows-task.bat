@echo off
chcp 65001 >nul
echo ======================================================================
echo   INSTALLATION DE LA TÂCHE PLANIFIÉE AUTOMATIQUE WINDOWS
echo   Rappels d'Entretien par E-mail (Carnet d'Entretien Automobile)
echo ======================================================================
echo.
echo Ce script configure une tâche planifiée dans Windows pour exécuter
echo automatiquement les vérifications et envoyer vos alertes par e-mail
echo chaque jour à 08h30 (avec rappel régulier toutes les 4 heures en arrière-plan).
echo.
echo Chemin du script : "%~dp0run-reminders-silent.vbs"
echo.

schtasks /create /tn "CarnetAuto-EmailReminders" /tr "wscript.exe \"%~dp0run-reminders-silent.vbs\"" /sc daily /st 08:30 /ri 240 /du 24:00 /f

if %ERRORLEVEL% equ 0 (
    powershell -Command "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName 'CarnetAuto-EmailReminders' -Settings $s" >nul 2>&1
    echo.
    echo ✅ SUCCÈS ! La tâche planifiée 'CarnetAuto-EmailReminders' a été installée.
    echo Vos alertes seront désormais envoyées automatiquement en arrière-plan sans ouvrir de terminal.
    echo Vous pouvez consulter l'historique des envois dans scripts\reminders.log.
) else (
    echo.
    echo ❌ Erreur lors de la création de la tâche planifiée.
    echo Essayez de faire un clic droit sur ce fichier et "Exécuter en tant qu'administrateur".
)

echo.
pause
