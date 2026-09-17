@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "URL=http://127.0.0.1:5173/"
cd /d "%PROJECT_ROOT%"

echo Real Estate Savant launcher
echo Project: %PROJECT_ROOT%
echo URL: %URL%
echo.

call :check_ready
if not errorlevel 1 (
  echo Real Estate Savant is already running.
  start "" "%URL%"
  exit /b 0
)

echo Starting Vite on port 5173...
start "Real Estate Savant Server" cmd /k "cd /d ""%PROJECT_ROOT%"" && npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort"

echo Waiting for Real Estate Savant to respond...
for /l %%i in (1,1,75) do (
  call :check_ready
  if not errorlevel 1 (
    echo Real Estate Savant is ready.
    start "" "%URL%"
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo.
echo Real Estate Savant did not respond on port 5173.
echo Check the "Real Estate Savant Server" window for the exact Vite/Node error.
echo Common causes: another app is using port 5173, OneDrive is syncing project data, or Node cannot access the project folder.
pause
exit /b 1

:check_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%URL%'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ exit 0 } } catch {}; exit 1"
exit /b %errorlevel%
