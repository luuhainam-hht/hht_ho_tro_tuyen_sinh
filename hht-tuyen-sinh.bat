@echo off
REM ==========================================================================
REM  HHT Tuyen sinh - cong cu cai dat, sua loi, chay, kiem thu va day len GitHub
REM  Cach dung:
REM    hht-tuyen-sinh.bat            mo menu
REM    hht-tuyen-sinh.bat install    cai dat + sua loi tu dong
REM    hht-tuyen-sinh.bat start      chay he thong
REM    hht-tuyen-sinh.bat test       chay kiem thu
REM    hht-tuyen-sinh.bat doctor     kiem tra loi
REM    hht-tuyen-sinh.bat push       day ma nguon len GitHub
REM    hht-tuyen-sinh.bat docker     chay toan bo bang Docker
REM  Thong bao trong file nay viet khong dau de hien thi dung tren moi phien ban Windows.
REM ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title HHT Tuyen sinh
cd /d "%~dp0"
REM Co dinh ten du an Docker: bien COMPOSE_PROJECT_NAME cua du an khac (vd hcc_mot_cua) se lam docker compose chay nham nhom container.
set "COMPOSE_PROJECT_NAME=hht-tuyen-sinh"

set "REPO_URL=https://github.com/luuhainam-hht/hht_ho_tro_tuyen_sinh.git"
set "BRANCH=main"
set "PORT=3000"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set "PORT=%%b"

if /i "%~1"=="install" (call :install & goto :end)
if /i "%~1"=="start"   (call :start   & goto :end)
if /i "%~1"=="test"    (call :test    & goto :end)
if /i "%~1"=="doctor"  (call :doctor  & goto :end)
if /i "%~1"=="push"    (call :push    & goto :end)
if /i "%~1"=="docker"  (call :docker_all & goto :end)

:menu
echo.
echo  ================================================================
echo    HHT TUYEN SINH - Truong Cao dang Cong nghe cao Ha Noi
echo  ================================================================
echo    1. Cai dat va tu sua loi (lan dau chay chon muc nay)
echo    2. Chay he thong (mo trinh duyet)
echo    3. Kiem tra loi moi truong
echo    4. Chay kiem thu tu dong
echo    5. Chay CSDL PostgreSQL bang Docker
echo    6. Chay toan bo he thong bang Docker
echo    7. Dat lai mat khau quan tri (admin)
echo    8. Day ma nguon len GitHub
echo    9. Cau hinh lai file .env
echo    0. Thoat
echo  ================================================================
set "CHOICE="
set /p "CHOICE=  Chon so: "
if "%CHOICE%"=="1" call :install & goto :menu
if "%CHOICE%"=="2" call :start & goto :menu
if "%CHOICE%"=="3" call :doctor & goto :menu
if "%CHOICE%"=="4" call :test & goto :menu
if "%CHOICE%"=="5" call :docker_db & goto :menu
if "%CHOICE%"=="6" call :docker_all & goto :menu
if "%CHOICE%"=="7" call :reset_admin & goto :menu
if "%CHOICE%"=="8" call :push & goto :menu
if "%CHOICE%"=="9" call :setup_env & goto :menu
if "%CHOICE%"=="0" goto :end
echo  Lua chon khong hop le.
goto :menu

REM --------------------------------------------------------------------------
:check_node
where node >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai.
  start "" "https://nodejs.org/vi/download"
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=10)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo  [LOI] Node.js %%v qua cu, can 20.10 tro len. Tai ban LTS tai https://nodejs.org
  exit /b 1
)
for /f %%v in ('node -v') do echo  [OK]  Node.js %%v
exit /b 0

REM --------------------------------------------------------------------------
:deps
echo.
echo  Dang cai thu vien (npm ci)...
call npm ci --no-audit --no-fund
if not errorlevel 1 exit /b 0
echo  [!!] npm ci loi - thu sua: xoa node_modules, kiem tra bo nho dem, cai lai...
if exist node_modules rmdir /s /q node_modules
call npm cache verify >nul 2>&1
call npm ci --no-audit --no-fund
if not errorlevel 1 exit /b 0
echo  [!!] Van loi - thu "npm install" (cap nhat package-lock)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [LOI] Khong cai duoc thu vien. Kiem tra ket noi mang/proxy roi chay lai.
  exit /b 1
)
exit /b 0

REM --------------------------------------------------------------------------
:setup_env
node scripts\setup-env.js
exit /b %errorlevel%

REM --------------------------------------------------------------------------
:install
echo.
echo  ===== CAI DAT VA SUA LOI =====
call :check_node || exit /b 1
call :deps || exit /b 1
if not exist ".env" (
  call :setup_env || exit /b 1
) else (
  node scripts\setup-env.js --defaults >nul
)
findstr /b /c:"USE_DOCKER_DB=true" .env >nul 2>&1 && call :docker_db
echo.
echo  Kiem tra va sua loi moi truong...
node scripts\doctor.js --fix
set "DOC=%errorlevel%"
if "%DOC%"=="2" (
  call :deps || exit /b 1
  node scripts\doctor.js --fix
  set "DOC=!errorlevel!"
)
if "%DOC%"=="5" (
  echo  File .env chua hop le - cau hinh lai:
  call :setup_env
  node scripts\doctor.js --fix
  set "DOC=!errorlevel!"
)
if "%DOC%"=="4" (
  echo.
  echo  [LOI] Chua ket noi duoc CSDL. Cach xu ly:
  echo     - Neu may co Docker Desktop: chon muc 5 de chay PostgreSQL bang Docker.
  echo     - Neu da cai PostgreSQL: bat dich vu PostgreSQL, kiem tra mat khau, chon muc 9 de sua .env.
  exit /b 1
)
echo.
echo  Tao bang va nap du lieu tuyen sinh...
call npm run db:init
if errorlevel 1 (
  echo  [LOI] Khoi tao CSDL that bai - xem thong bao loi o tren.
  exit /b 1
)
echo.
echo  [OK] Cai dat xong. Chon muc 2 de chay he thong.
exit /b 0

REM --------------------------------------------------------------------------
:doctor
call :check_node || exit /b 1
if not exist node_modules (
  echo  [!!] Chua co node_modules - dang cai...
  call :deps || exit /b 1
)
node scripts\doctor.js --fix
if errorlevel 3 if not errorlevel 4 call :free_port
exit /b 0

REM --------------------------------------------------------------------------
:free_port
set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do set "PIDS=%%p"
if "%PIDS%"=="" exit /b 0
echo.
for /f "tokens=1" %%n in ('tasklist /fi "PID eq %PIDS%" /nh') do echo  Cong %PORT% dang bi tien trinh %%n (PID %PIDS%) su dung.
set "ANS="
set /p "ANS=  Tat tien trinh nay de giai phong cong? (y/N): "
if /i "!ANS!"=="y" (
  taskkill /PID %PIDS% /F >nul && echo  [OK] Da giai phong cong %PORT%.
)
exit /b 0

REM --------------------------------------------------------------------------
:start
call :check_node || exit /b 1
if not exist node_modules call :deps || exit /b 1
if not exist ".env" (
  echo  Chua cai dat - chay buoc cai dat truoc.
  call :install || exit /b 1
)
findstr /b /c:"USE_DOCKER_DB=true" .env >nul 2>&1 && call :docker_db
node scripts\doctor.js --fix
set "DOC=%errorlevel%"
if "%DOC%"=="3" (
  call :free_port
  set "DOC=0"
)
if not "%DOC%"=="0" if not "%DOC%"=="3" (
  echo  [LOI] Con loi moi truong - chon muc 1 de tu sua.
  exit /b 1
)
echo.
echo  He thong chay tai http://localhost:%PORT%   (Quan tri: http://localhost:%PORT%/admin.html)
echo  Nhan Ctrl+C de dung.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"
node src\server.js
exit /b 0

REM --------------------------------------------------------------------------
:test
call :check_node || exit /b 1
if not exist node_modules call :deps || exit /b 1
if not exist ".env" call :setup_env
findstr /b /c:"USE_DOCKER_DB=true" .env >nul 2>&1 && call :docker_db
REM Kiem thu XOA SACH du lieu CSDL test -> luon dung CSDL rieng ten *_test, khong dung CSDL that.
set "TEST_DATABASE_URL="
for /f "delims=" %%u in ('node scripts\doctor.js --test-db ^| findstr /b "postgres"') do set "TEST_DATABASE_URL=%%u"
if "%TEST_DATABASE_URL%"=="" (
  echo  [LOI] Khong tao duoc CSDL kiem thu. Chay muc 3 de xem loi CSDL.
  exit /b 1
)
echo  Dung CSDL kiem thu rieng (ten ket thuc _test).
call npm test
if errorlevel 1 (
  echo  [LOI] Co kiem thu that bai - xem chi tiet o tren.
  exit /b 1
)
echo  [OK] Tat ca kiem thu dat.
exit /b 0

REM --------------------------------------------------------------------------
:check_docker
where docker >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Chua cai Docker Desktop: https://www.docker.com/products/docker-desktop/
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo  [!!] Docker Desktop chua chay - dang mo, doi khoang 30 giay...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  for /l %%i in (1,1,30) do (
    timeout /t 3 >nul
    docker info >nul 2>&1 && exit /b 0
  )
  echo  [LOI] Docker Desktop chua san sang. Mo Docker Desktop roi chay lai.
  exit /b 1
)
exit /b 0

:docker_db
call :check_docker || exit /b 1
if not exist ".env" call :setup_env
echo  Khoi dong PostgreSQL bang Docker...
docker compose up -d db
if errorlevel 1 (
  echo  [LOI] Khong chay duoc container CSDL. Kiem tra cong 5432 co bi PostgreSQL khac chiem khong.
  exit /b 1
)
echo  Doi CSDL san sang...
for /l %%i in (1,1,20) do (
  docker compose exec -T db pg_isready -U hht -d hht_tuyen_sinh >nul 2>&1 && (echo  [OK] CSDL san sang. & exit /b 0)
  timeout /t 2 >nul
)
echo  [!!] CSDL khoi dong cham, thu lai sau it phut.
exit /b 0

:docker_all
call :check_docker || exit /b 1
if not exist ".env" call :setup_env
docker compose up -d --build
if errorlevel 1 (
  echo  [LOI] docker compose loi - xem thong bao o tren.
  exit /b 1
)
echo  [OK] Da chay. Mo https://localhost (Caddy tu cap chung chi; tren may ca nhan trinh duyet co the canh bao).
docker compose ps
exit /b 0

REM --------------------------------------------------------------------------
:reset_admin
if not exist node_modules call :deps || exit /b 1
set "ADMIN_USER=admin"
set /p "ADMIN_USER=  Ten dang nhap can dat lai [admin]: "
node scripts\reset-admin-password.js %ADMIN_USER%
exit /b 0

REM --------------------------------------------------------------------------
:git_safe_dir
REM O dia exFAT/FAT32 (USB, o cung ngoai) khong luu chu so huu file -> Git bao
REM "detected dubious ownership" va chan moi lenh. Them thu muc hien tai vao
REM danh sach tin cay cua Git (chi them 1 lan, khong trung lap).
set "SAFE_DIR=%CD:\=/%"
git config --global --get-all safe.directory 2>nul | findstr /i /x /c:"%SAFE_DIR%" /c:"*" >nul
if errorlevel 1 (
  git config --global --add safe.directory "%SAFE_DIR%"
  if errorlevel 1 (
    echo  [LOI] Khong ghi duoc cau hinh safe.directory cho Git.
    exit /b 1
  )
  echo  [OK] Da them %SAFE_DIR% vao danh sach thu muc tin cay cua Git.
)
exit /b 0

REM --------------------------------------------------------------------------
:push
echo.
echo  ===== DAY MA NGUON LEN GITHUB =====
where git >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Chua cai Git: https://git-scm.com/download/win
  start "" "https://git-scm.com/download/win"
  exit /b 1
)
call :git_safe_dir || exit /b 1
if not exist ".git" (
  git init >nul
  git checkout -b %BRANCH% >nul 2>&1
  echo  [OK] Da khoi tao kho Git.
)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Git khong mo duoc kho tai %CD%:
  git rev-parse --is-inside-work-tree
  exit /b 1
)
for /f "delims=" %%n in ('git config user.name 2^>nul') do set "GIT_NAME=%%n"
if "%GIT_NAME%"=="" (
  set /p "GIT_NAME=  Ho ten hien thi tren commit: "
  git config user.name "!GIT_NAME!"
)
for /f "delims=" %%e in ('git config user.email 2^>nul') do set "GIT_EMAIL=%%e"
if "%GIT_EMAIL%"=="" (
  set /p "GIT_EMAIL=  Email GitHub: "
  git config user.email "!GIT_EMAIL!"
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (git remote add origin %REPO_URL%) else (git remote set-url origin %REPO_URL%)
REM Bao ve bi mat: .env va du lieu tai len khong bao gio duoc day len.
git rm --cached -q .env >nul 2>&1
git rm -r --cached -q data >nul 2>&1
git rm -r --cached -q node_modules >nul 2>&1
echo  Chay kiem tra cu phap truoc khi day...
for /r src %%f in (*.js) do node --check "%%f" >nul 2>&1 || (echo  [LOI] Loi cu phap: %%f & exit /b 1)
git add -A
if errorlevel 1 (
  echo  [LOI] git add that bai - xem thong bao o tren.
  exit /b 1
)
git diff --cached --quiet
if errorlevel 1 (
  set "MSG=Cap nhat HHT Tuyen sinh"
  set /p "MSG=  Noi dung commit [Cap nhat HHT Tuyen sinh]: "
  git commit -q -m "!MSG!"
  if errorlevel 1 (
    echo  [LOI] Tao commit that bai - xem thong bao o tren.
    exit /b 1
  )
  echo  [OK] Da tao commit.
) else (
  echo  Khong co thay doi moi de commit.
)
git branch -M %BRANCH%
echo  Lay thay doi tren GitHub (neu co)...
git fetch origin >nul 2>&1
git rev-parse --verify -q origin/%BRANCH% >nul 2>&1
if not errorlevel 1 (
  git pull --rebase --allow-unrelated-histories origin %BRANCH%
  if errorlevel 1 (
    git rebase --abort >nul 2>&1
    echo  [!!] Ma tren GitHub khac ma tren may va khong gop tu dong duoc.
    set "ANS="
    set /p "ANS=  Ghi de ma tren GitHub bang ma tren may? (y/N): "
    if /i not "!ANS!"=="y" exit /b 1
    git push --force-with-lease -u origin %BRANCH%
    goto :push_done
  )
)
git push -u origin %BRANCH%
:push_done
if errorlevel 1 (
  echo.
  echo  [LOI] Day len that bai. Kiem tra:
  echo     - Dang nhap GitHub khi cua so dang nhap hien ra ^(Git Credential Manager^).
  echo     - Tai khoan co quyen ghi vao luuhainam-hht/hht_ho_tro_tuyen_sinh.
  exit /b 1
)
echo  [OK] Da day len %REPO_URL%
exit /b 0

:end
endlocal
exit /b