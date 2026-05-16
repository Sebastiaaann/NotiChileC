---
name: notichilec-db
description: >
  PostgreSQL operativo y cambios de schema para NotiChileC. Trigger: Cuando se trabaja con PostgreSQL, psql, schema, migrations, bootstrap.sql, SQL, tablas del proyecto, device_installations, notification_preferences, notification_events, notification_deliveries o debugging de base de datos.
license: Apache-2.0
metadata:
  author: codex
  version: "2.0"
---

## When to Use

- Cualquier cambio de base de datos en NotiChileC
- Aplicar `server/bootstrap.sql` o futuras migraciones
- Inspeccionar schema, constraints, índices o datos con `psql`
- Depurar contratos entre backend/worker y tablas PostgreSQL
- Verificar que rutas, worker y schema usen los mismos nombres de columnas
- Crear o modificar migraciones versionadas
- Trabajar con archiving (archive_jobs, archive_storage, archive_exports)
- Revisar worker_runs para tracking de ejecución

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

## Schema Evolution: Versioned Migrations

`server/bootstrap.sql` es el schema base (idempotente). Los cambios evolutivos se hacen
como migraciones versionadas en `server/migrations/`:

```
server/migrations/
├── add_rubro_filters.sql      # Ejemplo: agregar rubro_code, rubros_chilecompra
└── ...
```

**Reglas de migraciones:**
- Nombrar archivos con prefijo descriptivo + `_YYYYMMDD.sql` o incluir fecha en comentario
- Cada migración debe ser **idempotente** — usar `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- Las migraciones se aplican con un script dedicado (no desde bootstrap)
- No modificar `bootstrap.sql` para cambios evolutivos (solo para schema base)
- Verificar antes de aplicar: `psql` → `\dt` + `\d table_name`

Ejemplo de migración idempotente:
```sql
-- Migration: add_rubro_filters.sql
ALTER TABLE licitaciones ADD COLUMN IF NOT EXISTS rubro_code VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_licitaciones_rubro ON licitaciones(rubro_code);
INSERT INTO rubros_chilecompra (code, name) VALUES ('45000000', 'Trabajos de construcción')
ON CONFLICT (code) DO NOTHING;
```

## Archiving Pattern

El archiving usa un schema dedicado `archive` con tablas mirror:

```
┌──────────────────────────────────────────────────────┐
│ Hot Tables (public)    │  Archive Tables (archive)   │
├────────────────────────┼─────────────────────────────┤
│ licitaciones           │ archive.licitaciones        │
│ notification_deliveries│ archive.notification_deliveries│
└────────────────────────┴─────────────────────────────┘
```

### archive_old_licitaciones (PL/pgSQL)

Mueve licitaciones más viejas que `hot_months` (default 12) al schema `archive`:

```sql
CREATE OR REPLACE FUNCTION archive_old_licitaciones(hot_months INTEGER DEFAULT 12)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  cutoff TIMESTAMPTZ := date_trunc('month', NOW()) - make_interval(months => hot_months);
  archived_count INTEGER := 0;
BEGIN
  WITH moved AS (
    DELETE FROM licitaciones WHERE created_at < cutoff RETURNING *
  )
  INSERT INTO archive.licitaciones (...) SELECT ... FROM moved
  ON CONFLICT (codigo_externo) DO UPDATE SET updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;
```

### archive_old_notification_deliveries (PL/pgSQL)

Mueve deliveries completados más viejos que `retention_days` (default 90):

```sql
CREATE OR REPLACE FUNCTION archive_old_notification_deliveries(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - make_interval(days => retention_days);
  archived_count INTEGER := 0;
BEGIN
  WITH moved AS (
    DELETE FROM notification_deliveries
    WHERE completed_at IS NOT NULL AND completed_at < cutoff
    RETURNING *
  )
  INSERT INTO archive.notification_deliveries SELECT * FROM moved;
  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;
```

### archive_exports table

Para exportación a Parquet + S3:

```sql
CREATE TABLE archive_exports (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,             -- 'licitaciones' | 'notification_deliveries'
  partition_month TEXT NOT NULL,    -- '2026-05'
  object_key TEXT NOT NULL,         -- S3 object key
  row_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  exported_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  drop_eligible_at TIMESTAMPTZ,    -- cuándo se puede dropear del hot storage
  dropped_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity, partition_month)  -- un export por entidad/mes
);
```

Los estados de `archive_exports`: `pending → exporting → exported → verified → drop_eligible → dropped`

El ciclo de archive export corre diariamente (03:47 cron) y:
1. Busca particiones candidatas con `ensureArchiveCandidates()`
2. Exporta a Parquet con `parquetjs-lite`
3. Sube a S3 vía `archive-storage.ts`
4. Verifica checksum
5. Marca `drop_eligible_at` para cleanup futuro

### archive_jobs.ts + archive_storage.ts

El código de archiving está en:
- `server/src/archive-jobs.ts` — lógica de exportación (Parquet + S3)
- `server/src/archive-storage.ts` — S3 client (GetObject, PutObject, HeadObject)

Configuración vía env vars:
```env
ARCHIVE_BUCKET=notichilec-archive
ARCHIVE_PREFIX=notichilec/archive
ARCHIVE_REGION=us-east-1
ARCHIVE_ENDPOINT=https://s3.custom.com  # opcional (S3-compatible)
```

## Audit: worker_runs Table

Cada ejecución de worker se registra en `worker_runs` para trazabilidad:

```sql
CREATE TABLE worker_runs (
  id SERIAL PRIMARY KEY,
  worker_name TEXT NOT NULL DEFAULT 'sync',
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  licitaciones_found INTEGER NOT NULL DEFAULT 0,
  licitaciones_new INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  notifications_retryable INTEGER NOT NULL DEFAULT 0,
  notifications_failed INTEGER NOT NULL DEFAULT 0,
  notifications_invalidated INTEGER NOT NULL DEFAULT 0,
  targets_selected INTEGER NOT NULL DEFAULT 0,
  deliveries_created INTEGER NOT NULL DEFAULT 0,
  receipts_processed INTEGER NOT NULL DEFAULT 0,
  archived_licitaciones INTEGER NOT NULL DEFAULT 0,
  archived_deliveries INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

El tracking se hace desde `worker.ts`:
```typescript
// startRun
await deps.query(`INSERT INTO worker_runs (started_at, worker_name) VALUES ($1, $2) RETURNING id`, [now, workerName]);

// finishRun
await deps.query(`UPDATE worker_runs SET finished_at = NOW(), ... error_message = $13 WHERE id = $14`, [...]);
```

**Regla de auditoría:** Cada ciclo (`ingest`, `dispatch`, `receipt`, `cleanup`, `archive_export`)
tiene su propio `worker_name` y se registra individualmente. Consultar ejecuciones recientes:
```sql
SELECT worker_name, started_at, finished_at, error_message
FROM worker_runs
ORDER BY started_at DESC
LIMIT 20;
```

## Hot Partition: Region-Based Partitioning

La tabla `licitaciones` usa **PARTITION BY RANGE (created_at)** con particiones mensuales:

```sql
CREATE TABLE licitaciones (...) PARTITION BY RANGE (created_at);

CREATE TABLE licitaciones_default PARTITION OF licitaciones DEFAULT;
```

Las particiones se crean automáticamente via `ensure_licitaciones_monthly_partitions()`:

```sql
CREATE OR REPLACE FUNCTION ensure_licitaciones_monthly_partitions(
  hot_months INTEGER DEFAULT 12,    -- 12 meses hacia atrás
  months_ahead INTEGER DEFAULT 2     -- 2 meses hacia adelante
)
```

Esto asegura que siempre haya 14 particiones activas (12 pasadas + actual + 2 futuras).
Particiones anteriores se archivan automáticamente via `archive_old_licitaciones()`.

**Indices clave por partición:**
```sql
CREATE INDEX idx_licitaciones_created_at_desc ON licitaciones (created_at DESC, id DESC);
CREATE INDEX idx_licitaciones_tipo_created_at_desc ON licitaciones (tipo, created_at DESC, id DESC);
CREATE INDEX idx_licitaciones_rubro_code_prefix ON licitaciones (rubro_code text_pattern_ops, ...);
CREATE INDEX idx_licitaciones_fecha_publicacion_source_rank ON licitaciones (...);
```

**Regla:** Siempre incluir `created_at DESC, id DESC` en los índices de licitaciones para
soportar cursor pagination eficiente. El `DEFAULT` partition captura datos fuera de rango.

## Smoke Queries Útiles

```powershell
# Conectividad
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select current_database(), current_user;"

# Tablas push nuevas
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select table_name from information_schema.tables where table_schema='public' and table_name like 'notification_%' or table_name = 'device_installations';"

# Columnas críticas de deliveries
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "select column_name from information_schema.columns where table_name='notification_deliveries';"

# Últimas ejecuciones de worker
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "SELECT worker_name, started_at, finished_at, error_message FROM worker_runs ORDER BY started_at DESC LIMIT 10;"

# Estado de archive_exports
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "SELECT entity, partition_month, status, row_count FROM archive_exports ORDER BY created_at DESC LIMIT 10;"

# Ver particiones activas de licitaciones
& 'D:\postgresl\bin\psql.exe' "$dbUrl" -c "SELECT tablename FROM pg_tables WHERE tablename LIKE 'licitaciones_%' AND tablename != 'licitaciones_default' ORDER BY tablename DESC;"
```

## Project-Specific Rules

- Si tocás nombres de columnas/tablas, verificá `server/src/routes/*`, `server/src/worker.ts` y cualquier helper SQL relacionado
- Si aplicás bootstrap, verificá que los backfills legacy no dupliquen instalaciones
- Si el usuario pide "aplicar cambios de DB", primero conectividad, después backup, después apply, después verify
- Las migraciones deben ser idempotentes: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`
- No modificar `bootstrap.sql` para cambios evolutivos — crear migración versionada en `server/migrations/`
- `worker_runs` ya no es opcional — forma parte del contrato de auditoría

## Referencias

- NotiChileC project: `.agents/skills/notichilec-project/SKILL.md`
- Backend architecture: `.agents/skills/notichilec-backend-architecture/SKILL.md`
- Worker architecture: `.agents/skills/notichilec-worker-architecture/SKILL.md`
- `server/bootstrap.sql` — schema base idempotente
- `server/migrations/add_rubro_filters.sql` — ejemplo de migración versionada
- `server/src/archive-jobs.ts` — lógica de exportación Parquet + S3
- `server/src/archive-storage.ts` — S3 client helpers
- `server/src/db.ts` — pool y query helpers
- `server/src/worker.ts` — tracking de worker_runs en cada ciclo
