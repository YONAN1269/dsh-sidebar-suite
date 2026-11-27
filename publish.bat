@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title DSH Sidebar Suite - Local Pack Helper

set "PACKAGE_NAME=dsh-sidebar-suite"
set "PACK_OUT_DIR=dist"
if exist "publish-config.txt" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("publish-config.txt") do set "%%A=%%B"
)

for /f "delims=" %%V in ('npm pkg get version') do set "VER=%%~V"

:menu
cls
echo ============================================================
echo   DSH Sidebar Suite - Local Pack Helper
echo   Package : %PACKAGE_NAME%
echo   Version : %VER%   - edit package.json to bump
echo   Folder  : %CD%
echo ============================================================
echo.
echo   This script only builds local packages. It never uploads to
echo   the npm registry, and it does not read or write any npm token.
echo.
echo   To release: push a v* tag and let GitHub Actions publish via
echo   OIDC. See RELEASING.md (日常发布).
echo.
echo   [1] Pack a local .tgz installer into %PACK_OUT_DIR%
echo   [2] Pack, then install the tarball locally
echo   [3] Exit
echo.
set "CHOICE="
set /p "CHOICE=Type 1-3 then press Enter: "
if "%CHOICE%"=="1" goto pack
if "%CHOICE%"=="2" goto packinstall
if "%CHOICE%"=="3" goto end
goto menu

:pack
call :packtarball
echo.
echo Done. Installer: %CD%\%PACK_OUT_DIR%\%PACKAGE_NAME%-%VER%.tgz
echo Others can install it with:
echo   dsh plugin --profile desktop add %CD%\%PACK_OUT_DIR%\%PACKAGE_NAME%-%VER%.tgz
echo.
pause
goto menu

:packinstall
call :packtarball
echo.
echo Installing %TGZ% locally ...
call npm install "%TGZ%"
echo.
pause
goto menu

:packtarball
if not exist "%PACK_OUT_DIR%" mkdir "%PACK_OUT_DIR%"
call npm pack --pack-destination "%PACK_OUT_DIR%"
set "TGZ="
for /f "delims=" %%F in ('dir /b /o-n "%PACK_OUT_DIR%\%PACKAGE_NAME%-%VER%.tgz"') do if not defined TGZ set "TGZ=%CD%\%PACK_OUT_DIR%\%%F"
goto :eof

:end
endlocal
exit /b 0