@echo off
rem Local Windows build (same as the GitHub Action). Needs Node.js 20+ and the .NET 8 SDK.
cd /d "%~dp0"
call npm ci || exit /b 1
call npm run publish:core:win || exit /b 1
call npm run dist:win || exit /b 1
echo.
echo Done: see the dist\ folder (installer + portable zip)
pause
