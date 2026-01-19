: <<'CMDEOF'
@echo off
setlocal

rem Windows CMD section - use Git Bash to run the shell script
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_NAME=%~1"

if "%SCRIPT_NAME%"=="" (
    echo Error: No script name provided
    exit /b 1
)

rem Try Git Bash first
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%SCRIPT_DIR%%SCRIPT_NAME%"
    exit /b %ERRORLEVEL%
)

rem Try WSL
wsl --exec bash "%SCRIPT_DIR%%SCRIPT_NAME%" 2>nul
if %ERRORLEVEL% EQU 0 exit /b 0

echo Error: Could not find bash. Install Git for Windows or WSL.
exit /b 1

CMDEOF

# Unix shell section
# Prevent terminal escape sequences from leaking
exec < /dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$1"

if [ -z "$SCRIPT_NAME" ]; then
    echo "Error: No script name provided"
    exit 1
fi

exec bash "$SCRIPT_DIR/$SCRIPT_NAME"
