@echo off
chcp 65001 >nul
echo ======================================================================
echo   INSTALLATION DE LA TÂCHE PLANIFIÉE AUTOMATIQUE WINDOWS
echo   Rappels d'Entretien par E-mail (Période de Test : Toutes les 5 min)
echo ======================================================================
echo.
echo Ce script configure une tâche planifiée dans Windows pour exécuter
echo automatiquement les vérifications et envoyer vos alertes par e-mail
echo toutes les 5 minutes en arrière-plan sans ouvrir de fenêtre.
echo.
echo Chemin du script : "%~dp0run-reminders-silent.vbs"
echo.

schtasks /create /tn "CarnetAuto-EmailReminders" /tr "wscript.exe \"%~dp0run-reminders-silent.vbs\"" /sc minute /mo 1 /f

if %ERRORLEVEL% equ 0 (
    powershell -Command "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName 'CarnetAuto-EmailReminders' -Settings $s" >nul 2>&1
    echo.
    echo ✅ SUCCÈS ! La tâche planifiée 'CarnetAuto-EmailReminders' est configurée toutes les minutes (1 min).
    echo Vos alertes seront désormais vérifiées automatiquement en arrière-plan chaque minute.
    echo Vous pouvez consulter l'historique des passages dans scripts\reminders.log.
) else (
    echo.
    echo ❌ Erreur lors de la création de la tâche planifiée.
    echo Essayez de faire un clic droit sur ce fichier et "Exécuter en tant qu'administrateur".
)

echo.
pause
