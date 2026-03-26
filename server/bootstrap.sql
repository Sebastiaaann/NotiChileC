BEGIN;

-- ============================================================
-- Tabla de licitaciones (datos sincronizados desde ChileCompra)
-- ============================================================
CREATE TABLE IF NOT EXISTS licitaciones (
  id TEXT PRIMARY KEY,
  codigo_externo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  organismo_nombre TEXT,
  tipo TEXT CHECK (tipo IN ('L1', 'LE', 'LP', 'LQ', 'LR')),
  monto_estimado NUMERIC(14, 0),
  moneda TEXT NOT NULL DEFAULT 'CLP',
  fecha_publicacion TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  estado TEXT NOT NULL DEFAULT 'Publicada',
  url TEXT,
  region TEXT,
  categoria TEXT NOT NULL DEFAULT 'General',
  notificada BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_pub
  ON licitaciones (fecha_publicacion DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_notificada
  ON licitaciones (notificada) WHERE notificada = FALSE;

-- ============================================================
-- Tabla de tokens de dispositivos (push notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_active
  ON device_tokens (active) WHERE active = TRUE;

-- ============================================================
-- Log de ejecuciones del worker
-- ============================================================
CREATE TABLE IF NOT EXISTS worker_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  licitaciones_found INTEGER NOT NULL DEFAULT 0,
  licitaciones_new INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
