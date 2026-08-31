Option Explicit
Dim shell, fso, root, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & fso.BuildPath(root, "..\..\install-openai.ps1") & """"
exitCode = shell.Run(command, 0, True)
If exitCode = 0 Then
  MsgBox "Native Context Compiler 0.6.3 low-latency mode installed successfully." & vbCrLf & vbCrLf & "Restart ChatGPT/Codex, trust the four reviewed hooks once, then use local Work tasks normally. The whole-turn Lean bridge stays disabled.", 64, "Native Context Compiler"
Else
  MsgBox "Installation failed. Run install-all.cmd to view the error.", 16, "Native Context Compiler"
End If
WScript.Quit exitCode
