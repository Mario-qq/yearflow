' Scheduled-task entry: run one collection with no console window (cmd would flash a black box at 9:00)
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo
WScript.Quit sh.Run("cmd /c node node_modules\tsx\dist\cli.mjs scripts\screentime\collect.ts run", 0, True)
