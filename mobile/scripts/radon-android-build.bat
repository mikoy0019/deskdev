@echo off
REM Custom Android build for Radon IDE — works around Radon 1.3.1's broken
REM ./gradlew invocation on Windows (this machine sets
REM NoDefaultCurrentDirectoryInExePath=1, disabling cmd's current-dir exe
REM search, so gradlew must be called by full path). Builds the debug APK for
REM the emulator's x86_64 ABI and prints the APK path as the LAST stdout line,
REM which is what Radon's customBuild.android.buildCommand expects.
setlocal
for %%I in ("%~dp0..\android") do set "ANDROID_DIR=%%~fI"
call "%ANDROID_DIR%\gradlew.bat" -p "%ANDROID_DIR%" -x lint -PreactNativeArchitectures=x86_64 assembleDebug
if errorlevel 1 exit /b %errorlevel%
echo %ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk
