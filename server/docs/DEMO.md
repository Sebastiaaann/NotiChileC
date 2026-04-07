# NotiChileC — Demo controlada

## Objetivo

Levantar una demo local separada del flujo normal, con:

- app en development build
- backend demo en `3002`
- DB demo separada
- push real desde un iPhone físico
- fallback curado si el feed real viene vacío o falla

## Archivos de entorno

- raíz app: `D:\Expo movil\NotiChileC\.env.demo`
- backend: `D:\Expo movil\NotiChileC\server\.env.demo`

> Estos archivos quedan ignorados por git. No los subas al repo.

## Secuencia exacta en Windows / PowerShell

### 0) Pararte en el repo

```powershell
Set-Location "D:\Expo movil\NotiChileC"
```

### 1) Backup de los env activos

```powershell
Copy-Item "D:\Expo movil\NotiChileC\.env" "D:\Expo movil\NotiChileC\.env.backup" -Force
Copy-Item "D:\Expo movil\NotiChileC\server\.env" "D:\Expo movil\NotiChileC\server\.env.backup" -Force
```

### 2) Crear la DB demo si no existe

```powershell
$env:PGPASSWORD = "0901"
$dbExists = & "D:\postgresl\bin\psql.exe" -h localhost -U postgres -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'notichilec_demo';"
if (-not $dbExists) {
  & "D:\postgresl\bin\psql.exe" -h localhost -U postgres -d postgres -c "CREATE DATABASE notichilec_demo;"
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```

### 3) Aplicar el schema a la DB demo

```powershell
& "D:\postgresl\bin\psql.exe" -h localhost -U postgres -d notichilec_demo -f "D:\Expo movil\NotiChileC\server\bootstrap.sql"
```

### 4) Activar la demo copiando los env

```powershell
Copy-Item "D:\Expo movil\NotiChileC\.env.demo" "D:\Expo movil\NotiChileC\.env" -Force
Copy-Item "D:\Expo movil\NotiChileC\server\.env.demo" "D:\Expo movil\NotiChileC\server\.env" -Force
```

### 5) Levantar API y worker demo

Abrí dos terminales separadas:

**Terminal A**
```powershell
Set-Location "D:\Expo movil\NotiChileC\server"
npm run dev:api
```

**Terminal B**
```powershell
Set-Location "D:\Expo movil\NotiChileC\server"
npm run dev:worker
```

### 6) Sembrar y chequear la demo

En otra terminal:

```powershell
Set-Location "D:\Expo movil\NotiChileC\server"
npm run demo:reset
npm run demo:smoke
npm run push:smoke
```

### 7) Abrir la app en tu iPhone

En otra terminal:

```powershell
Set-Location "D:\Expo movil\NotiChileC"
npx expo start --dev-client
```

Después abrí la **development build instalada en tu iPhone**.

### 8) Restaurar los env originales al terminar

```powershell
Copy-Item "D:\Expo movil\NotiChileC\.env.backup" "D:\Expo movil\NotiChileC\.env" -Force
Copy-Item "D:\Expo movil\NotiChileC\server\.env.backup" "D:\Expo movil\NotiChileC\server\.env" -Force
```

## Orden recomendado de uso

1. backup de envs
2. crear/aplicar DB demo
3. copiar `.env.demo` a `.env`
4. levantar API y worker demo
5. `npm run demo:reset`
6. `npm run demo:smoke`
7. `npm run push:smoke`
8. abrir la development build en el iPhone
9. restaurar `.env` y `server/.env` al terminar

## Recuperación rápida

- si el feed se ve vacío: volver a `demo:reset`
- si `ready` falla: revisar DB demo / worker demo
- si push no llega: revisar `DEMO_PUSH_INSTALLATION_ID`, token activo y permisos del iPhone

## Notas

- el feed demo usa datos reales primero y fallback curado si no hay respuesta útil
- el cold archive queda desactivado por default en demo
- no dependas de Expo Go para mostrar push; usá la build instalada en tu iPhone
