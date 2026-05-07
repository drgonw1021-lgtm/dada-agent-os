@echo off
setlocal
title Download Model

cd /d "%~dp0"

echo ========================================
echo    Dada Model Downloader
echo ========================================
echo.

echo 正在下载 Qwen2.5-0.5B 模型...
echo 这可能需要几分钟时间...
echo.

set "MODEL_URL=https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
set "OUTPUT=models\qwen2.5-0.5b-instruct-q4_k_m.gguf"

:: Try with curl
echo 使用 curl 下载...
curl -L -o "%OUTPUT%" "%MODEL_URL%" --progress-bar

if errorlevel 1 (
    echo.
    echo curl 下载失败，尝试 PowerShell...
    powershell -Command "Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%OUTPUT%'"
)

if exist "%OUTPUT%" (
    echo.
    echo ========================================
    echo 下载完成!
    echo 模型路径: %OUTPUT%
    echo ========================================
) else (
    echo.
    echo ========================================
    echo 下载失败!
    echo.
    echo 请手动下载:
    echo 1. 访问: https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF
    echo 2. 下载: qwen2.5-0.5b-instruct-q4_k_m.gguf
    echo 3. 放入: models\ 目录
    echo ========================================
)

pause