@echo off
chcp 65001 >nul
title Git
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo 缺少 runtime\node.exe
  echo 请在源码目录执行 node scripts\pack-portable.mjs
  echo 绿色包会输出到 dist\GitWorkbench
  pause
  exit /b 1
)
if not exist "%~dp0app\server.mjs" (
  echo 缺少 app\server.mjs
  echo 请重新执行 node scripts\pack-portable.mjs
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0app\server.mjs" --open
echo.
echo 程序已退出。如果上面写着「已经在运行」，浏览器里的页面还在，关掉这个窗口即可。
pause
