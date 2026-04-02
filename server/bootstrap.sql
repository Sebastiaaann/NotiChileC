BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  expo_push_token TEXT NOT NULL UNIQUE,
  installation_id TEXT,
  platform TEXT NOT NULL DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS installation_id TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_installation_id
  ON device_tokens (installation_id)
  WHERE installation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_tokens_active
  ON device_tokens (active)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS device_installations (
  installation_id TEXT PRIMARY KEY,
  push_token TEXT UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  environment TEXT NOT NULL DEFAULT 'development',
  app_version TEXT NOT NULL DEFAULT 'unknown',
  push_capable BOOLEAN NOT NULL DEFAULT FALSE,
  permission_status TEXT NOT NULL DEFAULT 'undetermined',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at TIMESTAMPTZ,
  invalid_reason TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_installations_active
  ON device_installations (active)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_device_installations_push_token
  ON device_installations (push_token)
  WHERE push_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  installation_id TEXT PRIMARY KEY
    REFERENCES device_installations(installation_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rubro TEXT,
  tipo TEXT,
  region TEXT,
  monto_min NUMERIC(14, 0),
  monto_max NUMERIC(14, 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_events (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  licitacion_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, licitacion_id)
);

CREATE TABLE IF NOT EXISTS licitacion_registry (
  codigo_externo TEXT PRIMARY KEY,
  licitacion_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licitacion_registry_licitacion_id
  ON licitacion_registry (licitacion_id);

DO $$
BEGIN
  IF to_regclass('public.licitaciones') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE public.licitaciones (
        id TEXT NOT NULL,
        codigo_externo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        organismo_nombre TEXT,
        tipo TEXT,
        monto_estimado NUMERIC(14, 0),
        monto_label TEXT,
        moneda TEXT NOT NULL DEFAULT 'CLP',
        fecha_publicacion TIMESTAMPTZ,
        fecha_cierre TIMESTAMPTZ,
        estado TEXT NOT NULL DEFAULT 'Publicada',
        url TEXT,
        region TEXT,
        categoria TEXT NOT NULL DEFAULT 'General',
        rubro_code TEXT,
        notificada BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE (created_at)
    $ddl$;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'licitaciones'
  ) THEN
    IF to_regclass('public.licitaciones_legacy_unpartitioned') IS NULL THEN
      EXECUTE 'ALTER TABLE public.licitaciones RENAME TO licitaciones_legacy_unpartitioned';
    END IF;

    EXECUTE $ddl$
      CREATE TABLE IF NOT EXISTS public.licitaciones (
        id TEXT NOT NULL,
        codigo_externo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        organismo_nombre TEXT,
        tipo TEXT,
        monto_estimado NUMERIC(14, 0),
        monto_label TEXT,
        moneda TEXT NOT NULL DEFAULT 'CLP',
        fecha_publicacion TIMESTAMPTZ,
        fecha_cierre TIMESTAMPTZ,
        estado TEXT NOT NULL DEFAULT 'Publicada',
        url TEXT,
        region TEXT,
        categoria TEXT NOT NULL DEFAULT 'General',
        rubro_code TEXT,
        notificada BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE (created_at)
    $ddl$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.licitaciones_default
  PARTITION OF public.licitaciones DEFAULT;
CREATE OR REPLACE FUNCTION ensure_licitaciones_monthly_partitions(
  hot_months INTEGER DEFAULT 12,
  months_ahead INTEGER DEFAULT 2
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  start_month DATE := date_trunc('month', NOW())::date - make_interval(months => hot_months);
  end_month DATE := date_trunc('month', NOW())::date + make_interval(months => months_ahead + 1);
  current_month DATE := start_month;
  partition_name TEXT;
BEGIN
  WHILE current_month < end_month LOOP
    partition_name := format('licitaciones_%s', to_char(current_month, 'YYYYMM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.licitaciones FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      current_month::timestamptz,
      (current_month + INTERVAL '1 month')::timestamptz
    );
    current_month := (current_month + INTERVAL '1 month')::date;
  END LOOP;
END;
$$;

SELECT ensure_licitaciones_monthly_partitions(12, 2);

CREATE INDEX IF NOT EXISTS idx_licitaciones_created_at_desc
  ON licitaciones (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_tipo_created_at_desc
  ON licitaciones (tipo, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_region_created_at_desc
  ON licitaciones (region, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_rubro_code_prefix
  ON licitaciones (rubro_code text_pattern_ops, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_monto_estimado_created_at_desc
  ON licitaciones (monto_estimado, created_at DESC, id DESC)
  WHERE monto_estimado IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licitaciones_notificada_false
  ON licitaciones (notificada)
  WHERE notificada = FALSE;

CREATE TABLE IF NOT EXISTS archive.licitaciones (
  id TEXT NOT NULL,
  codigo_externo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  organismo_nombre TEXT,
  tipo TEXT,
  monto_estimado NUMERIC(14, 0),
  monto_label TEXT,
  moneda TEXT NOT NULL DEFAULT 'CLP',
  fecha_publicacion TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  estado TEXT NOT NULL DEFAULT 'Publicada',
  url TEXT,
  region TEXT,
  categoria TEXT NOT NULL DEFAULT 'General',
  rubro_code TEXT,
  notificada BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_licitaciones_codigo_externo
  ON archive.licitaciones (codigo_externo);

CREATE OR REPLACE FUNCTION archive_old_licitaciones(
  hot_months INTEGER DEFAULT 12
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff TIMESTAMPTZ := date_trunc('month', NOW()) - make_interval(months => hot_months);
  archived_count INTEGER := 0;
BEGIN
  WITH moved AS (
    DELETE FROM licitaciones
    WHERE created_at < cutoff
    RETURNING *
  )
  INSERT INTO archive.licitaciones (
    id, codigo_externo, nombre, organismo_nombre, tipo,
    monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
    estado, url, region, categoria, rubro_code, notificada,
    created_at, updated_at
  )
  SELECT
    id, codigo_externo, nombre, organismo_nombre, tipo,
    monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
    estado, url, region, categoria, rubro_code, notificada,
    created_at, updated_at
  FROM moved
  ON CONFLICT (codigo_externo) DO UPDATE SET
    updated_at = EXCLUDED.updated_at,
    notificada = EXCLUDED.notificada;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_event_id BIGINT NOT NULL
    REFERENCES notification_events(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  installation_id TEXT NOT NULL
    REFERENCES device_installations(installation_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  provider TEXT NOT NULL DEFAULT 'expo',
  status TEXT NOT NULL DEFAULT 'pending',
  next_attempt_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  completed_at TIMESTAMPTZ,
  provider_ticket_id TEXT,
  provider_receipt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notification_event_id, installation_id)
);

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_ticket_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_receipt_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON notification_deliveries (status, next_attempt_at, created_at)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_receipts
  ON notification_deliveries (provider, provider_ticket_id)
  WHERE status = 'sent' AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS archive.notification_deliveries (
  LIKE notification_deliveries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);

CREATE TABLE IF NOT EXISTS archive_exports (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  partition_month TEXT NOT NULL,
  object_key TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  min_created_at TIMESTAMPTZ,
  max_created_at TIMESTAMPTZ,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  exported_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  drop_eligible_at TIMESTAMPTZ,
  dropped_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity, partition_month)
);

CREATE INDEX IF NOT EXISTS idx_archive_exports_status
  ON archive_exports (status, drop_eligible_at, exported_at);

CREATE OR REPLACE FUNCTION archive_old_notification_deliveries(
  retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - make_interval(days => retention_days);
  archived_count INTEGER := 0;
BEGIN
  WITH moved AS (
    DELETE FROM notification_deliveries
    WHERE completed_at IS NOT NULL
      AND completed_at < cutoff
    RETURNING *
  )
  INSERT INTO archive.notification_deliveries
  SELECT * FROM moved;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;

INSERT INTO licitacion_registry (codigo_externo, licitacion_id, created_at, updated_at)
SELECT DISTINCT ON (codigo_externo)
  codigo_externo,
  id,
  created_at,
  NOW()
FROM licitaciones
ORDER BY codigo_externo, created_at DESC, updated_at DESC, id DESC
ON CONFLICT (codigo_externo) DO UPDATE SET updated_at = EXCLUDED.updated_at;

DO $$
BEGIN
  IF to_regclass('public.licitaciones_legacy_unpartitioned') IS NOT NULL THEN
    EXECUTE $migrate$
      INSERT INTO licitaciones (
        id, codigo_externo, nombre, organismo_nombre, tipo,
        monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
        estado, url, region, categoria, rubro_code, notificada, created_at, updated_at
      )
      SELECT
        legacy.id, legacy.codigo_externo, legacy.nombre, legacy.organismo_nombre, legacy.tipo,
        legacy.monto_estimado, legacy.monto_label, legacy.moneda, legacy.fecha_publicacion, legacy.fecha_cierre,
        legacy.estado, legacy.url, legacy.region, legacy.categoria, legacy.rubro_code,
        legacy.notificada, legacy.created_at, COALESCE(legacy.updated_at, NOW())
      FROM licitaciones_legacy_unpartitioned legacy
      WHERE NOT EXISTS (
        SELECT 1 FROM licitaciones current WHERE current.codigo_externo = legacy.codigo_externo
      )
    $migrate$;
  END IF;
END $$;

UPDATE device_tokens
SET installation_id = 'legacy:' || expo_push_token
WHERE installation_id IS NULL;

INSERT INTO device_installations (
  installation_id,
  push_token,
  platform,
  environment,
  app_version,
  push_capable,
  permission_status,
  active,
  invalidated_at,
  invalid_reason,
  last_seen_at,
  created_at,
  updated_at
)
SELECT
  installation_id,
  expo_push_token,
  platform,
  'development',
  'legacy-import',
  TRUE,
  'granted',
  active,
  CASE WHEN active THEN NULL ELSE NOW() END,
  CASE WHEN active THEN NULL ELSE 'legacy-import' END,
  last_seen_at,
  created_at,
  NOW()
FROM device_tokens
WHERE installation_id IS NOT NULL
ON CONFLICT (installation_id) DO UPDATE SET
  push_token = EXCLUDED.push_token,
  platform = EXCLUDED.platform,
  environment = EXCLUDED.environment,
  app_version = EXCLUDED.app_version,
  push_capable = EXCLUDED.push_capable,
  permission_status = EXCLUDED.permission_status,
  active = EXCLUDED.active,
  invalidated_at = EXCLUDED.invalidated_at,
  invalid_reason = EXCLUDED.invalid_reason,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at = NOW();

INSERT INTO notification_preferences (installation_id)
SELECT installation_id
FROM device_installations
ON CONFLICT (installation_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS worker_runs (
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

ALTER TABLE worker_runs
  ADD COLUMN IF NOT EXISTS worker_name TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN IF NOT EXISTS notifications_retryable INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notifications_failed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notifications_invalidated INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS targets_selected INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deliveries_created INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipts_processed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_licitaciones INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_deliveries INTEGER NOT NULL DEFAULT 0;

COMMIT;
