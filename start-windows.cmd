@echo off
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 · 多人扩充版
cd /d "%~dp0.."

set "SP_NODE=node"
if exist "%~dp0..\..\node\node.exe" set "SP_NODE=%~dp0..\..\node\node.exe"
if exist "%~dp0..\node\node.exe" set "SP_NODE=%~dp0..\node\node.exe"
"%SP_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)" >nul 2>nul
if errorlevel 1 goto :nonode

echo.
echo   卫戍协议：盟约 · 多人扩充版
echo   正在启动。浏览器会自动打开，请保留这个窗口。
echo   结束游戏服务器：回到此窗口按 Ctrl+C，或关闭窗口。
echo.
"%SP_NODE%" "sp-mp\start.mjs" %*
if errorlevel 1 goto :fail
exit /b 0

:nonode
echo.
echo   没找到可用的 Node.js 22 或更高版本。
echo   独立扩充包需要在开服电脑安装 Node.js；整合包请双击顶层「启动游戏.cmd」。
echo   下载： https://nodejs.org/zh-cn/download
echo.
pause
exit /b 1

:fail
echo.
echo   启动没有成功，请查看上面的具体原因。
echo   如果 3000 端口被旧游戏占用，请关闭旧游戏的黑色窗口，再双击本文件。
echo   也可以换端口：sp-mp\start-windows.cmd --port 3001
echo.
pause
exit /b 1
