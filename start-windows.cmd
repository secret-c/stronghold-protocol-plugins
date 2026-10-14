@echo off
rem sp-mp - start Stronghold-Protocol with the multiplayer capacity overlay (4 / 8 / 12-seat co-op rooms).
rem Nothing in the install is modified. Docs: sp-mp\README.md
rem Extra arguments are passed to start.mjs, e.g.:  start-windows.cmd --port 3001 --no-open
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 + sp-mp 多人叠加层
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 goto :oldnode

node "sp-mp\start.mjs" %*
if errorlevel 1 goto :fail
exit /b 0

:nonode
echo.
echo 未找到 Node.js（需要 22 或更高，22 / 24 LTS）。Node.js not found.
echo   winget install OpenJS.NodeJS.LTS
echo   或 https://nodejs.org/zh-cn/download
echo.
pause
exit /b 1

:oldnode
echo.
echo 当前 Node.js 版本太旧，需要 22 或更高（22 / 24 LTS）。Node.js is too old.
echo   升级：winget upgrade OpenJS.NodeJS.LTS
echo.
pause
exit /b 1

:fail
echo.
echo 启动失败：请看上面的信息。两种常见原因：
echo   端口被占用  -^> 换端口启动： sp-mp\start-windows.cmd --port 3001
echo   官方更新过  -^> 先重基叠加层： node sp-mp\tools\rebase.mjs
echo.
echo Start failed - see the message above.
echo.
pause
exit /b 1
