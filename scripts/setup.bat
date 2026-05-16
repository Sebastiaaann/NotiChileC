@echo off
REM ============================================================
REM NotiChileC - Setup Script (Windows)
REM Automatiza la configuración inicial del proyecto
REM ============================================================

echo.
echo ========================================================
echo NotiChileC Setup Script - Windows
echo ========================================================

REM ------------------------------------------------------------
REM 1. Verificar prerequisites
REM ------------------------------------------------------------
echo.
echo [1/5] Verificando prerequisites...

REM Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   [ERROR] Node.js no esta instalado
    exit /b 1
)
for /f "delims=" %%i in ('node --version') do set NODE_VERSION=%%i
echo   [OK] Node.js: %NODE_VERSION%

REM ------------------------------------------------------------
REM 2. Instalar dependencias
REM ------------------------------------------------------------
echo.
echo [2/5] Instalando dependencias...

echo   -> Client (Expo)...
call npm install --silent 2>nul

echo   -> Server (Node)...
cd server
call npm install --silent 2>nul
cd ..

echo   [OK] Dependencias instaladas

REM ------------------------------------------------------------
REM 3. Verificar/configurar .env
REM ------------------------------------------------------------
echo.
echo [3/5] Verificando configuracion...

if not exist .env (
    echo   [WARN] No existe .env, creando desde .env.example...
    copy .env.example .env >nul
    echo   [WARN] IMPORTANTE: Edita .env y configura tu IP local
    echo   Para encontrar tu IP: ipconfig (Windows)
)

REM ------------------------------------------------------------
REM 4. Crear base de datos
REM ------------------------------------------------------------
echo.
echo [4/5] Configurando base de datos...

set "DATABASE_URL="
if exist "server\.env" (
    for /f "tokens=1,* delims==" %%A in (server\.env) do (
        if /I "%%A"=="DATABASE_URL" set "DATABASE_URL=%%B"
    )
)
set "POSTGRES_ADMIN_URL=%DATABASE_URL:/notichilec=/postgres%"

set "PSQL_CMD=C:\Program Files\PostgreSQL\17\bin\psql.exe"
if exist "%PSQL_CMD%" (
    echo   [OK] PostgreSQL detectado en "%PSQL_CMD%"
) else (
    where psql >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo   [ERROR] PostgreSQL no esta instalado
        echo   Descargar desde: https://www.postgresql.org/download/windows/
        goto :migrations
    )
    for /f "delims=" %%i in ('where psql') do (
        set "PSQL_CMD=%%i"
        goto :psql_ready
    )
)

:psql_ready

REM Crear base de datos si no existe
if exist "%PSQL_CMD%" (
    if defined POSTGRES_ADMIN_URL (
        "%PSQL_CMD%" "%POSTGRES_ADMIN_URL%" -tAc "SELECT 1 FROM pg_database WHERE datname='notichilec'" 2>nul | findstr /C:"1" >nul
    ) else (
        "%PSQL_CMD%" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='notichilec'" 2>nul | findstr /C:"1" >nul
    )
    if %ERRORLEVEL% neq 0 (
        echo   -> Creando base de datos notichilec...
        if defined POSTGRES_ADMIN_URL (
            "%PSQL_CMD%" "%POSTGRES_ADMIN_URL%" -c "CREATE DATABASE notichilec" 2>nul || echo   [WARN] No se pudo crear automaticamente
        ) else (
            "%PSQL_CMD%" -U postgres -d postgres -c "CREATE DATABASE notichilec" 2>nul || echo   [WARN] No se pudo crear automaticamente
        )
    ) else (
        echo   [OK] Base de datos notichilec ya existe
    )
)

:migrations

REM ------------------------------------------------------------
REM 5. Ejecutar migrations
REM ------------------------------------------------------------
echo.
echo [5/5] Ejecutando migrations...

cd server
if exist bootstrap.sql (
    if defined DATABASE_URL (
        "%PSQL_CMD%" "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f bootstrap.sql 2>nul && echo   [OK] bootstrap.sql ejecutado || echo   [WARN] Error ejecutando bootstrap.sql
    ) else (
        "%PSQL_CMD%" -v ON_ERROR_STOP=1 -U postgres -d notichilec -f bootstrap.sql 2>nul && echo   [OK] bootstrap.sql ejecutado || echo   [WARN] Error ejecutando bootstrap.sql
    )
)
if exist migrations\add_rubro_filters.sql (
    if defined DATABASE_URL (
        "%PSQL_CMD%" "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f migrations\add_rubro_filters.sql 2>nul && echo   [OK] add_rubro_filters.sql ejecutado || echo   [WARN] Error ejecutando add_rubro_filters.sql
    ) else (
        "%PSQL_CMD%" -v ON_ERROR_STOP=1 -U postgres -d notichilec -f migrations\add_rubro_filters.sql 2>nul && echo   [OK] add_rubro_filters.sql ejecutado || echo   [WARN] Error ejecutando add_rubro_filters.sql
    )
)
cd ..

REM ------------------------------------------------------------
REM Fin
REM ------------------------------------------------------------
echo.
echo ========================================================
echo [OK] Setup completado!
echo ========================================================
echo.
echo Proximos pasos:
echo 1. Edita .env con tu IP local (busca 192.168.0.4)
echo 2. Ejecuta: npm run dev
echo.
pause
