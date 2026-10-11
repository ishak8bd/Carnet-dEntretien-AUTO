' scripts/run-reminders-silent.vbs
' Lance la vérification des échéances d'entretien et l'envoi des alertes e-mail
' en arrière-plan 100% silencieux (sans aucune fenêtre noire console visible).

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
nodeScript = scriptDir & "\send-email-reminders.mjs"

WshShell.CurrentDirectory = rootDir
' 0 = fenêtre masquée, True = attend la fin de l'exécution
WshShell.Run "node """ & nodeScript & """", 0, True
