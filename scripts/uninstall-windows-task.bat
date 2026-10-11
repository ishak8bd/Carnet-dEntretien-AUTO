@echo off
chcp 65001 >nul
echo ======================================================================
echo   DÉSINSTALLATION DE LA TÂCHE PLANIFIÉE WINDOWS
echo   Rappels d'Entretien (Carnet d'Entretien)
echo ======================================================================
echo.

schtasks /delete /tn "CarnetAuto-EmailReminders" /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ La tâche planifiée 'CarnetAuto-EmailReminders' a été supprimée avec succès.
) else (
    echo.
    echo ℹ️ La tâche n'a pas été trouvée ou a déjà été supprimée.
)

echo.
pause
