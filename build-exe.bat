@echo off
chcp 65001 >nul
title AuraLine — 本地一键编译独立 Windows .exe

echo ============================================================================
echo   AuraLine — 隐身声学细线 (100%% 纯输出回环 / 零麦克风占用 / 独立 .exe 打包)
echo ============================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js ^(https://nodejs.org/^)
    pause
    exit /b 1
)

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Rust 编译环境 ^(cargo^)。
    echo 提示：如果您不想在办公电脑安装 Rust 环境，请直接将仓库推送到 GitHub，
    echo 在 GitHub 仓库的 Actions 页面即可直接下载云端自动编译好的 AuraLine-Portable.exe！
    pause
    exit /b 1
)

echo [1/4] 正在安装前端与 Tauri 依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] npm install 失败
    pause
    exit /b 1
)

echo [2/4] 正在生成 Windows .exe 应用图标与系统托盘图标...
call npx tauri icon src-tauri/icons/app-icon.svg

echo [3/4] 正在编译 Rust WASAPI 声卡回环内核与独立 .exe ^(首次编译约需 2-4 分钟^)...
call npx tauri build
if %errorlevel% neq 0 (
    echo [错误] Tauri 编译失败，请检查上方错误日志
    pause
    exit /b 1
)

echo [4/4] 正在提取免安装单文件 AuraLine-Portable.exe 到当前根目录...
if exist "src-tauri\target\release\auraline-native.exe" (
    copy /Y "src-tauri\target\release\auraline-native.exe" ".\AuraLine-Portable.exe" >nul
)

echo.
echo ============================================================================
echo   编译成功！
echo   1. 免安装单文件版已生成在当前目录： .\AuraLine-Portable.exe
echo   2. 安装包位于： src-tauri\target\release\bundle\nsis\
echo   双击 AuraLine-Portable.exe 即可脱离浏览器直接运行，并在右下角系统托盘显示图标！
echo ============================================================================
pause
