@echo off
REM Chay nhanh muc 1 cua cap-nhat-database-docker.bat (khong hoi), ghi nhat ky vao backups\cap-nhat-docker.log
cd /d "%~dp0"
if not exist backups mkdir backups
echo Dang cap nhat database Docker... (nhat ky: backups\cap-nhat-docker.log)
call cap-nhat-database-docker.bat update > backups\cap-nhat-docker.log 2>&1
type backups\cap-nhat-docker.log
echo.
echo [XONG] Cua so tu dong sau 60 giay.
timeout /t 60
