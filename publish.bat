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
echo   [6] Set publish token            - ONE-TIME, fixes the 403 error
echo   [0] Exit
echo.
echo   Token is already set up on this PC: [3] publish, [4] check.
echo   Use [6] only if the token expires (Feb 4, 2027) or you switch accounts.
echo.
set "CHOICE="
set /p "CHOICE=Type 0-6 then press Enter: "
if "%CHOICE%"=="1" goto pack
if "%CHOICE%"=="2" goto login
if "%CHOICE%"=="3" goto publish
if "%CHOICE%"=="4" goto verify
if "%CHOICE%"=="5" goto signup
if "%CHOICE%"=="6" goto token
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
call npm whoami --registry=%NPM_REGISTRY%
if errorlevel 1 (
  echo.
  echo Not logged in. Opening the npm web login in your browser...
  echo If you have no account yet, choose [5] to sign up first.
  echo NOTE: a normal web login is NOT enough to publish; also run [6].
  echo.
  call npm login --registry=%NPM_REGISTRY%
  echo.
  call npm whoami --registry=%NPM_REGISTRY%
) else (
  echo.
  echo OK - logged in. To PUBLISH you still need [6] (2FA / token).
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
call npm whoami --registry=%NPM_REGISTRY% >nul 2>&1
if errorlevel 1 (
  echo You are NOT logged in. Choose [5] to sign up, then run [6].
  echo.
  pause
  goto menu
)
for /f "delims=" %%U in ('npm whoami --registry=%NPM_REGISTRY%') do set "NPMUSER=%%U"
echo Logged in as: %NPMUSER%
echo.
set "CONFIRM="
set /p "CONFIRM=Type YES to publish %PACKAGE_NAME%@%VER% : "
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled - nothing was uploaded.
  echo.
  pause
  goto menu
)
set "OTP="
set /p "OTP=2FA code (6 digits), or press Enter to skip: "
if defined OTP (
  call npm publish --access public --registry=%NPM_REGISTRY% --otp=%OTP%
) else (
  call npm publish --access public --registry=%NPM_REGISTRY%
)
echo.
echo Publish command finished. Choose [4] to verify.
echo npm processes uploads in the background: [4] may briefly show
echo 0.0.0-stage or E404. Wait 1-2 minutes and press [4] again.
echo.
echo If you saw "E403 ... Two-factor authentication ... is required":
echo   run [6] ONCE to install a publish token, then run [3] again.
echo   Long-term: enable 2FA on your npm account and type the 6-digit
echo   code at the prompt above. If --otp is rejected, use [6] instead.
echo If you saw "cannot publish over previously published version",
echo   bump the version on line 3 of package.json.
echo.
pause
goto menu

:verify
echo.
call npm view %PACKAGE_NAME% version --registry=%NPM_REGISTRY% >nul 2>&1
if errorlevel 1 (
  echo Not on npm yet. That is expected if [3] did not succeed.
  echo Fix the error shown by [3] first, then run [3] and try [4] again.
  echo.
  pause
  goto menu
)
call npm view %PACKAGE_NAME% version --registry=%NPM_REGISTRY%
call npm view %PACKAGE_NAME% dist.tarball --registry=%NPM_REGISTRY%
echo.
echo Install command for other people:
echo   dsh plugin --profile desktop add %PACKAGE_NAME%
echo.
pause
goto menu

:token
echo.
echo npm requires 2FA, or a token that bypasses 2FA, to publish.
echo A normal "npm login" token is NOT enough - that caused the 403.
echo.
echo   1) In your browser, sign in at https://www.npmjs.com
echo   2) Click your avatar (top right) then Access Tokens
echo      Direct URL: https://www.npmjs.com/settings/yonan1269/tokens
echo   3) Generate New Token ^> Granular Access Token
echo      Token name    : anything, e.g. dsh-publish
echo      Expiration    : 90 days or longer
echo      Packages and scopes ^> Permissions:
echo                      Read and write (publish and stage)
echo      CHECK THE BOX : Bypass two-factor authentication
echo   4) Generate Token, then COPY the token (starts with npm_)
echo.
echo   Note: npm plans to remove direct publishing from bypass-2FA
echo   tokens around January 2027. This works now, not forever.
echo.
echo The token is saved to your USER folder (%USERPROFILE%\.npmrc),
echo NOT into this project, so it cannot be pushed to GitHub.
echo.
set "TOKEN="
set /p "TOKEN=Paste the token here (leave empty to cancel): "
if not defined TOKEN (
  echo Cancelled - nothing changed.
  echo.
  pause
  goto menu
)
if exist "%USERPROFILE%\.npmrc" (
  copy /y "%USERPROFILE%\.npmrc" "%USERPROFILE%\.npmrc.bak" >nul
  echo Old config backed up to %USERPROFILE%\.npmrc.bak
)
> "%USERPROFILE%\.npmrc" echo //registry.npmjs.org/:_authToken=%TOKEN%
echo.
echo Checking the token with npm whoami ...
call npm whoami --registry=%NPM_REGISTRY%
if errorlevel 1 (
  echo.
  echo The token was NOT accepted. Check that you copied the whole string.
  echo Your old config is at %USERPROFILE%\.npmrc.bak
) else (
  echo.
  echo OK - token works. Now choose [3] to publish.
)
set "TOKEN="
echo.
pause
goto menu

:signup
echo.
echo Opening https://www.npmjs.com/signup ...
start "" "https://www.npmjs.com/signup"
echo After signup, come back here and run [6], not [2].
echo.
pause
goto menu

:end
endlocal
exit /b 0
