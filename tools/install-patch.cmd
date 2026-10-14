@echo off
rem sp-mp - copy the overlay's 28 files INTO the install so the normal launcher (scripts\start-windows.bat,
rem npm start, a service) starts the multiplayer build. Revert before applying an official update.
rem Prefer sp-mp\start-windows.cmd if you want the install left untouched.
rem
rem   install-patch.cmd apply | revert | status
rem   install-patch.cmd              (no argument: asks interactively)
chcp 65001 >nul
setlocal EnableExtensions
title sp-mp 安装补丁
cd /d "%~dp0..\.."

if /i "%~1"=="apply"  goto :apply
if /i "%~1"=="revert" goto :revert
if /i "%~1"=="status" goto :status

echo.
echo  [1] 打进安装（普通启动 = 多人版；官方更新前需先还原）
echo  [2] 从安装还原（恢复原版 4 人）
echo  [3] 查看当前状态
echo  [4] 退出
echo.
echo 也可以直接用参数： install-patch.cmd apply ^| revert ^| status
echo.
set "pick="
set /p "pick=选择 1/2/3/4 并回车： "
if "%pick%"=="1" goto :apply
if "%pick%"=="2" goto :revert
if "%pick%"=="3" goto :status
if "%pick%"=="4" exit /b 0
echo 没有选择 1-4。
goto :pause

:apply
node "sp-mp\tools\install-patch.mjs" apply
goto :pause

:revert
node "sp-mp\tools\install-patch.mjs" revert
goto :pause

:status
node "sp-mp\tools\install-patch.mjs" status
goto :pause

:pause
echo.
pause
exit /b 0
