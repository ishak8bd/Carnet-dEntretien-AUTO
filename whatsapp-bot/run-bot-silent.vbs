' whatsapp-bot/run-bot-silent.vbs
' Lance le Bot WhatsApp Baileys en arrière-plan sans fenêtre console visible.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

botDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = botDir
' 0 = fenêtre masquée, False = ne bloque pas (continue en tâche de fond)
WshShell.Run "node bot.js", 0, False
