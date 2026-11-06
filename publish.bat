@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title DSH Sidebar Suite - Publish Helper

set "PACKAGE_NAME=dsh-sidebar-suite"
set "PACK_OUT_DIR=dist"
set "NPM_REGISTRY=https://registry.npmjs.org/"
if exist "publish-config.txt" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("publish-config.txt") do set "%%A=%%B"
)

for /f "delims=" %%V in ('npm pkg get version') do set "VER=%%~V"

:menu
cls
echo ============================================================
echo   DSH Sidebar Suite - Publish Helper
echo   Package : %PACKAGE_NAME%
echo   Version : %VER%   - edit line 3 of package.json to bump
echo   Folder  : %CD%
echo ============================================================
echo.
echo   [1] Pack a local .tgz installer   - no npm account needed
echo   [2] Log in to npm / check login
echo   [3] Publish to npm               - PUBLIC, cannot be undone
echo   [4] Verify the published package
echo   [5] Open npm signup page in browser
echo   [0] Exit
echo.
set "CHOICE="
set /p "CHOICE=Type 0-5 then press Enter: "
if "%CHOICE%"=="1" goto pack
if "%CHOICE%"=="2" goto login
if "%CHOICE%"=="3" goto publish
if "%CHOICE%"=="4" goto verify
if "%CHOICE%"=="5" goto signup
if "%CHOICE%"=="0" goto end
goto menu

:pack
echo.
if not exist "%PACK_OUT_DIR%" mkdir "%PACK_OUT_DIR%"
call npm pack --pack-destination "%PACK_OUT_DIR%"
echo.
echo Done. Installer: %CD%\%PACK_OUT_DIR%\%PACKAGE_NAME%-%VER%.tgz
echo Others can install it with:
echo   dsh plugin --profile desktop add %CD%\%PACK_OUT_DIR%\%PACKAGE_NAME%-%VER%.tgz
echo.
pause
goto menu

:login
echo.
call npm whoami
if errorlevel 1 (
  echo.
  echo Not logged in. Opening the npm web login in your browser...
  echo If you have no account yet, choose [5] to sign up first, then come back.
  echo.
  call npm login --registry=%NPM_REGISTRY%
  echo.
  call npm whoami
) else (
  echo.
  echo OK - already logged in. You can choose [3] to publish.
)
echo.
pause
goto menu

:publish
echo.
echo ------------------------------------------------------------
echo WARNING: this uploads to the PUBLIC npm registry.
echo Source code and the WeChat Pay QR image become public.
echo Version %VER% can NEVER be re-published once used.
echo ------------------------------------------------------------
echo.
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo You are NOT logged in. Choose [5] to sign up, then run: npm login
  echo.
  pause
  goto menu
)
for /f "delims=" %%U in ('npm whoami') do set "NPMUSER=%%U"
echo Logged in as: %NPMUSER%
set "CONFIRM="
set /p "CONFIRM=Type YES to publish %PACKAGE_NAME%@%VER% : "
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled - nothing was uploaded.
  echo.
  pause
  goto menu
)
call npm publish --access public --registry=%NPM_REGISTRY%
echo.
echo Publish command finished. Choose [4] to verify.
echo If it failed with 403, bump the version on line 3 of package.json.
echo.
pause
goto menu

:verify
echo.
call npm view %PACKAGE_NAME% version --registry=%NPM_REGISTRY%
call npm view %PACKAGE_NAME% dist.tarball --registry=%NPM_REGISTRY%
echo.
echo Install command for other people:
echo   dsh plugin --profile desktop add %PACKAGE_NAME%
echo.
pause
goto menu

:signup
echo.
echo Opening https://www.npmjs.com/signup ...
start "" "https://www.npmjs.com/signup"
echo After signup, come back here and run: npm login
echo.
pause
goto menu

:end
endlocal
exit /b 0
