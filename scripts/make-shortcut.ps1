# 在桌面放一个 YearFlow 快捷方式。
#
# 为什么不做安装包：桌面壳通过 app:// 协议直接读项目里的 dist/，所以「更新」＝重跑一次
# `npm run electron:build`，壳子本身不用动。做成 NSIS 安装包反而会变成每次更新都要重装
# （除非加自动更新，那需要服务器 + 代码签名，单人自用太重）。
# 另外这台机器上 Symantec Endpoint Protection 会在打包过程中抹掉未签名的 Electron 二进制，
# 安装包本来也打不出来 —— 见 docs/PROGRESS.md「桌面化」§六。
#
# 跑法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts/make-shortcut.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $exe)) { throw "找不到 $exe —— 先跑 npm install" }
if (-not (Test-Path (Join-Path $repo 'dist\index.html'))) {
  Write-Warning 'dist/ 还没构建，快捷方式会打开空白窗口。先跑：npm run electron:build'
}

$icon = Join-Path $repo 'build\icon.ico'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'YearFlow.lnk'))
$lnk.TargetPath = $exe
$lnk.Arguments = '.'          # 项目根目录即 app 目录，package.json 的 main 指向 dist-electron/main.cjs
$lnk.WorkingDirectory = $repo
if (Test-Path $icon) { $lnk.IconLocation = $icon }
$lnk.Description = 'YearFlow 年度计划（桌面版）'
$lnk.Save()

Write-Host "已创建桌面快捷方式。更新方式：git pull 后跑 npm run electron:build，快捷方式不用重建。"
