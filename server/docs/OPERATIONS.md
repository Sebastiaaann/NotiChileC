# NotiChileC — Operaciones backend

## Runtime / pooling

- `DATABASE_POOL_URL`: la usa el runtime (`API` y `worker`) y debe apuntar a **PgBouncer**.
- `DATABASE_DIRECT_URL`: la usan mantenimiento, bootstrap, restore/export y cualquier operación que requiera conexión directa a PostgreSQL.
- Sizing inicial recomendado:
  - `DB_POOL_MAX=4` por proceso Node
  - `PgBouncer default_pool_size=20`
  - `PgBouncer reserve_pool_size=5`
  - `PgBouncer max_client_conn=200`

## Healthchecks

- `GET /api/health/live` — liveness, no depende de DB.
- `GET /api/health/ready` — readiness, valida DB y presupuesto de pool.
- `GET /api/health` — alias de compatibilidad.
- `GET /api/metrics` — métricas Prometheus.

## Logs y errores

- `LOG_FORMAT=json` para producción.
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` habilitan captura de errores en API/worker/scripts.
- Campos esperados en logs: `timestamp`, `level`, `service`, `env`, `request_id`, `run_id`, `job`, `duration_ms`, `error_code`.

## Cold storage

- `archive` schema sigue siendo **staging local**.
- El export real escribe objetos Parquet en storage S3-compatible y deja manifiesto en `archive_exports`.
- Scripts:
  - `npm run archive:export`
  - `npm run archive:restore -- --entity=licitaciones --partition=2025-03`

## Troubleshooting rápido

- `ready=503` con `reason=pool_saturated`: revisar PgBouncer y cantidad de procesos API/worker.
- `archive_exports.status=failed`: revisar bucket/credenciales/metadatos del objeto.
- si el worker no exporta frío: validar `ARCHIVE_BUCKET`, `ARCHIVE_PREFIX`, `ARCHIVE_REGION`, `ARCHIVE_ENDPOINT` y credenciales AWS compatibles.
