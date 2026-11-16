' Inicia "npm run dev" oculto (sem janela) no logon. Log em dev.log.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "cmd /c npm run dev >> dev.log 2>&1", 0, False
