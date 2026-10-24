@echo off
title Logic Design Web Sitesi
cd /d "%~dp0"
echo ========================================================
echo   Logic Design Web Sitesi Baslatiliyor...
echo   Tarayici otomatik acilacaktir (http://localhost:5173)
echo ========================================================
start "" http://localhost:5173
call npm.cmd run dev
