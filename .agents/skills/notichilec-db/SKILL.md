---
name: notichilec-db
description: >
  PostgreSQL operativo y cambios de schema para NotiChileC. Trigger: Cuando se trabaja con PostgreSQL, psql, schema, migrations, bootstrap.sql, SQL, tablas del proyecto, device_installations, notification_preferences, notification_events, notification_deliveries o debugging de base de datos.
license: Apache-2.0
metadata:
  author: codex
  version: "1.0"
---

## When to Use

- Cualquier cambio de base de datos en NotiChileC
- Aplicar `server/bootstrap.sql` o futuras migraciones
- Inspeccionar schema, constraints, índices o datos con `psql`
- Depurar contratos entre backend/worker y tablas PostgreSQL
- Verificar que rutas, worker y schema usen los mismos nombres de columnas

## Required Companion Skill

Antes de trabajar con la DB de NotiChileC, cargá también:
- `C:\Users\elwax\.agents\skills\postgres\SKILL.md`

Usá esa skill para buenas prácticas generales de PostgreSQL. Esta skill agrega el contexto específico del proyecto y del entorno local.

## NotiChileC Database Workflow

1. **Leer la conexión real**
   - Tomar `DATABASE_URL` desde `server/.env`
   - No inventar credenciales ni hosts

2. **Usar las herramientas locales correctas**
   - En esta máquina preferir:
     - `D:\postgresl\bin\psql.exe`
     - `D:\postgresl\bin\pg_dump.exe`

3. **Antes de mutar schema**
   - Inspeccionar tablas/columnas actuales con `information_schema`
   - Hacer backup schema-only en `D:\tmp\NotiChileC-db-backups\`

4. **Aplicar cambios de schema de forma reproducible**
   - Preferir `server/bootstrap.sql` o migraciones versionadas
   - Evitar DDL manual ad hoc salvo debugging puntual
   - Si el cambio es importante, verificar luego tablas, columnas, índices y filas backfilled

5. **Contratos críticos del proyecto**
   - La identidad nueva de push es `device_installations.installation_id`
   - `notification_preferences.enabled` representa si la instalación recibe notificaciones por defecto; no depende de que haya filtros activos
   - `notification_deliveries.notification_event_id` es el nombre canónico de columna
   - Mantener compatibilidad temporal con `device_tokens` hasta que deje de usarse del todo

6. **Después de cambios DB/backend**
   - Verificar con queries reales que el schema quedó alineado con el código
   - Ejecutar tests del server relevantes
   - No hacer build de la app por esta tarea

## Smoke Queries Útiles

```powershell
# Conectividad
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select current_database(), current_user;"

# Tablas push nuevas
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select table_name from information_schema.tables where table_schema='public' and table_name like 'notification_%' or table_name = 'device_installations';"

# Columnas críticas de deliveries
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select column_name from information_schema.columns where table_name='notification_deliveries';"
```

## Project-Specific Rules

- Si tocás nombres de columnas/tablas, verificá `server/src/routes/*`, `server/src/worker.ts` y cualquier helper SQL relacionado
- Si aplicás bootstrap, verificá que los backfills legacy no dupliquen instalaciones
- Si el usuario pide “aplicar cambios de DB”, primero conectividad, después backup, después apply, después verify
