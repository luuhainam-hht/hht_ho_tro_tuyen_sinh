@echo off
REM ==========================================================================
REM  Cap nhat co so du lieu du an vao PostgreSQL chay bang Docker
REM    - Tao/cap nhat cac bang theo db\schema.sql, them tham so cau hinh moi
REM    - Nap du lieu tuyen sinh (FAQ, nganh, ho so, lich, nguon) tu db\seed
REM    - Tuy chon: nhap lai file Excel du lieu roi ghi de du lieu tuyen sinh trong Docker
REM  Cach dung: nhap dup, hoac:
REM    cap-nhat-database-docker.bat update | refresh | excel "duong\dan\file.xlsx"
REM ==========================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Cap nhat database du an vao Docker
cd /d "%~dp0"

call :prepare || goto :end
if /i "%~1"=="update"  (call :update & goto :end)
if /i "%~1"=="refresh" (call :refresh & goto :end)
if /i "%~1"=="excel"   (call :excel "%~2" & goto :end)

:menu
echo.
echo  ================================================================
echo    CAP NHAT DATABASE DU AN VAO DOCKER
echo  ================================================================
echo    1. Cap nhat bang + nap du lieu con thieu (an toan, giu chinh sua cua can bo)
echo    2. Ghi de du lieu tuyen sinh bang ban moi nhat cua du an (co sao luu truoc)
echo    3. Nhap lai file Excel du lieu roi ghi de vao Docker
echo    4. Dat lai mat khau quan tri trong Docker
echo    5. Xem trang thai CSDL Docker
echo    0. Thoat
echo  ================================================================
set "C="
set /p "C=  Chon so: "
if "%C%"=="1" call :update & goto :pause
if "%C%"=="2" call :refresh & goto :pause
if "%C%"=="3" call :excel "" & goto :pause
if "%C%"=="4" goto :admin
if "%C%"=="5" node scripts\db-sync.js status & goto :pause
if "%C%"=="0" goto :end
echo  Lua chon khong hop le.
goto :menu

:update
node scripts\db-sync.js migrate-docker || exit /b 1
call :restart_app
exit /b 0

:refresh
node scripts\db-sync.js migrate-docker --refresh-seed || exit /b 1
call :restart_app
exit /b 0

:excel
set "XLSX=%~1"
if "%XLSX%"=="" set "XLSX=docs\HHT_du_lieu_chatbot_tuyen_sinh.xlsx"
set "IN="
set /p "IN=  Duong dan file Excel [%XLSX%]: "
if not "%IN%"=="" set "XLSX=%IN:"=%"
if not exist "%XLSX%" (
  echo  [LOI] Khong tim thay file: %XLSX%
  exit /b 1
)
echo  Doc file Excel va tao lai du lieu db\seed ...
node scripts\import-excel.js "%XLSX%" || (echo  [LOI] File Excel sai cau truc - can dung mau HHT_du_lieu_chatbot_tuyen_sinh.xlsx & exit /b 1)
call :refresh
exit /b %errorlevel%

:admin
set "U=admin"
set /p "U=  Ten dang nhap [admin]: "
node scripts\db-sync.js reset-admin-docker %U%
goto :pause

:restart_app
REM Khoi dong lai container app (neu dang chay) de nap lai cau hinh va du lieu moi.
for /f %%i in ('docker compose ps -q --status running app 2^>nul') do (
  echo  Khoi dong lai container app...
  docker compose restart app >nul && echo  [OK] App da khoi dong lai.
)
exit /b 0

:pause
echo.
pause
goto :menu

REM --------------------------------------------------------------------------
:prepare
where node >nul 2>&1 || (echo  [LOI] Chua cai Node.js: https://nodejs.org & exit /b 1)
where docker >nul 2>&1 || (echo  [LOI] Chua cai Docker Desktop: https://www.docker.com/products/docker-desktop/ & exit /b 1)
docker info >nul 2>&1
if errorlevel 1 (
  echo  [!!] Docker Desktop chua chay - dang mo, doi toi da 90 giay...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  for /l %%i in (1,1,30) do (
    timeout /t 3 >nul
    docker info >nul 2>&1 && goto :docker_ok
  )
  echo  [LOI] Docker Desktop chua san sang.
  exit /b 1
)
:docker_ok
if not exist node_modules (
  echo  Cai thu vien lan dau...
  call npm ci --no-audit --no-fund || exit /b 1
)
if not exist ".env" (
  echo  Chua co file .env - tao moi:
  node scripts\setup-env.js || exit /b 1
) else (
  node scripts\setup-env.js --defaults >nul
)
exit /b 0

:end
endlocal
exit /b
