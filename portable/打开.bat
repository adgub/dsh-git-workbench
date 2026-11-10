@echo off
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo 缺少 runtime\node.exe。
  echo 在源码目录执行: node scripts\pack-portable.mjs
  echo 它会下载绿色包用的 Node 和便携版 Git，输出到 dist\GitWorkbench\
  pause
  exit /b 1
)
if not exist "%~dp0app\server.mjs" (
  echo 缺少 app\server.mjs。请重新执行 node scripts\pack-portable.mjs
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0app\server.mjs" --open
if errorlevel 1 pause
