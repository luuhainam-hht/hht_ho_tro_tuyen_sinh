@echo off
REM ==========================================================================
REM  Dong bo co so du lieu giua Neon (dam may) va PostgreSQL chay bang Docker (may nay)
REM  - Truoc moi lan ghi de deu tu sao luu ben bi ghi vao thu muc backups\
REM  - Nap du lieu trong 1 transaction: loi giua chung thi ben dich giu nguyen
REM  - Khong can cai PostgreSQL tren Windows: pg_dump/psql chay trong container
REM  Cach dung: nhap dup file nay, hoac:
REM    dong-bo-neon-docker.bat status | neon-to-docker | docker-to-neon | backup-neon | backup-docker
REM ==========================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Dong bo Neon - Docker
cd /d "%~dp0"
REM Co dinh ten du an Docker: bien COMPOSE_PROJECT_NAME cua du an khac (vd hcc_mot_cua) se lam docker compose chay nham nhom container.
set "COMPOSE_PROJECT_NAME=hht-tuyen-sinh"

call :prepare || goto :end
if /i "%~1"=="status"         (node scripts\db-sync.js status & goto :end)
if /i "%~1"=="neon-to-docker" (node scripts\db-sync.js neon-to-docker & goto :end)
if /i "%~1"=="docker-to-neon" (node scripts\db-sync.js docker-to-neon & goto :end)
if /i "%~1"=="backup-neon"    (node scripts\db-sync.js backup neon & goto :end)
if /i "%~1"=="backup-docker"  (node scripts\db-sync.js backup docker & goto :end)

:menu
echo.
echo  ================================================================
echo    DONG BO CO SO DU LIEU  NEON  ^<--^>  DOCKER
echo  ================================================================
echo    1. Xem trang thai 2 ben (so dong cac bang chinh)
echo    2. Keo du lieu Neon  -^>  Docker   (lay du lieu that ve may de thu)
echo    3. Day du lieu Docker -^>  Neon    (dua du lieu len ban dang chay)
echo    4. Sao luu Neon
echo    5. Sao luu Docker
echo    6. Khoi phuc tu ban sao luu
echo    7. Doi chuoi ket noi Neon
echo    0. Thoat
echo  ================================================================
set "C="
set /p "C=  Chon so: "
if "%C%"=="1" node scripts\db-sync.js status & goto :pause
if "%C%"=="2" node scripts\db-sync.js neon-to-docker & goto :pause
if "%C%"=="3" (
  echo.
  echo  CANH BAO: du lieu tren Neon ^(ban dang phuc vu thi sinh^) se bi THAY bang du lieu tren may nay.
  echo  Nen tam dung dich vu web tren Render ^(Suspend^) truoc khi tiep tuc.
  node scripts\db-sync.js docker-to-neon
  goto :pause
)
if "%C%"=="4" node scripts\db-sync.js backup neon & goto :pause
if "%C%"=="5" node scripts\db-sync.js backup docker & goto :pause
if "%C%"=="6" goto :restore
if "%C%"=="7" goto :neon_url
if "%C%"=="0" goto :end
echo  Lua chon khong hop le.
goto :menu

:restore
echo.
if not exist backups\*.sql.gz (
  echo  Chua co ban sao luu nao trong thu muc backups\
  goto :pause
)
echo  Cac ban sao luu (moi nhat o tren):
dir /b /o-d backups\*.sql.gz
echo.
set "F="
set /p "F=  Ten file can khoi phuc: "
if "%F%"=="" goto :menu
set "T="
set /p "T=  Khoi phuc vao (docker/neon): "
node scripts\db-sync.js restore "%F%" %T%
goto :pause

:neon_url
findstr /v /b /c:"NEON_DATABASE_URL=" .env > .env.tmp && move /y .env.tmp .env >nul
node scripts\db-sync.js status
goto :pause

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
