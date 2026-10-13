# 注册 Windows 计划任务「YearFlow 屏幕时间」：周一到周五 9:00 起每 30 分钟跑一次，持续 10 小时。
# 脚本自己判断「今天已成功」就立即退出，所以重复触发只是兜底重试（手机没连上 / 电脑 9 点还没开机）。
# StartWhenAvailable：9:00 电脑关着，开机后补跑。只在用户登录时运行（要弹通知、连手机）。
$ErrorActionPreference = 'Stop'
$name = 'YearFlow 屏幕时间'
$vbs = Join-Path $PSScriptRoot 'run-hidden.vbs'

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 9:00
$repeat = New-ScheduledTaskTrigger -Once -At 9:00 -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 10)
$trigger.Repetition = $repeat.Repetition

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Trigger $trigger -Action $action -Settings $settings -Principal $principal `
  -Description '读手机应用使用时长并自动打卡（scripts/screentime/collect.ts）' -Force | Out-Null
Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
