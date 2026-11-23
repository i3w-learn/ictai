@echo off
rem Puts the videos of this folder into the ICT App server, then restarts the server.
net session >nul 2>&1
if errorlevel 1 (
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "SERVER=%ProgramFiles%\ICT App\server"
if not exist "%SERVER%\server.cjs" (
  echo The ICT App server is not on this PC. Run ICT-Setup first and choose "Server PC".
  pause
  exit /b 1
)
if not exist "%SERVER%\starter-videos" mkdir "%SERVER%\starter-videos"
rem Our own videos and books come locked (.ictlock): they open only inside ICT App.
copy /Y "%~dp0videos\*.ictlock" "%SERVER%\starter-videos\" >nul 2>&1
copy /Y "%~dp0videos\*.mp4" "%SERVER%\starter-videos\" >nul 2>&1
copy /Y "%~dp0videos\*.webm" "%SERVER%\starter-videos\" >nul 2>&1
copy /Y "%~dp0videos\*.html" "%SERVER%\starter-videos\" >nul 2>&1
"%SERVER%\ict-server.exe" restart
echo.
echo Done. The videos show under "Videos" in the app within a minute
echo (after the first Super Admin account has been made).
pause
