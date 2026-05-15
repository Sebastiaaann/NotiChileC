---
name: notichilec-project
description: >
  Convenciones y arquitectura del proyecto NotiChileC.
  Trigger: Cuando se trabaja en cualquier parte del proyecto NotiChileC.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
---

## When to Use

- Cualquier trabajo en el proyecto NotiChileC
- Agregar features nuevas
- Modificar la app móvil o el backend
- Deploy o configuración
- Decidir nombres de funciones, endpoints o archivos
- Escribir o revisar código para asegurar consistencia

## Project Overview

**NotiChileC** es una app de alertas de licitaciones de Mercado Público (ChileCompra). Notifica al usuario cuando se publican nuevas licitaciones relevantes.

### Stack

| Componente | Tecnología |
|------------|------------|
| App móvil | React Native + Expo (Expo Router) |
| Backend | Express.js + TypeScript |
| Base de datos | PostgreSQL |
| Push | Expo Push Notifications |
| Scraper | HTTP fetch + HTML parsing |
| Cron | node-cron (cada 2 min) |

### Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  iPhone/Android │────▶│  Express Server  │────▶│   PostgreSQL    │
│  (Expo App)     │◀────│  (:3000)         │◀────│   (notichilec)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        ▲                       │
        │                       ▼
        │                ┌──────────────────┐
        │                │ ChileCompra API/ │
        │                │ Scraper Web      │
        └────────────────│ (cada 2 min)     │
        Push             └──────────────────┘
```

El servidor ejecuta dos workloads en el mismo proceso:
- **API (read)**: Express en puerto 3000/3001, endpoints REST
- **Worker (write)**: 5 ciclos cron asincrónicos (ingest, dispatch, receipt, cleanup, archive-export)

## Principio de Menor Sorpresa

Todas las decisiones de diseño deben priorizar que el código se comporte de la manera
más predecible y menos sorpresiva posible. Esto aplica a:

### GET endpoints no mutan estado

```typescript
// ✅ Correcto — GET read-only
router.get("/", async (req, res) => {
  const rows = await query<LicitacionRow>(`SELECT ...`, params);
  res.json({ data: rows, ... });
});

// ❌ Incorrecto — GET que muta estado
router.get("/notify-all", async (req, res) => {
  await query(`UPDATE licitaciones SET notificada = TRUE`); // NO
  res.json({ ok: true });
});
```

### Function names match behavior

```typescript
// ✅ Correcto — nombre describe acción
function lockDispatchDeliveries(deps, workerId, limit): Promise<DispatchDeliveryRow[]>
function createNotificationDeliveries(deps, eventId, installationIds): Promise<number>
function invalidateInstallation(deps, installationId, reason): Promise<void>
function isInstallationAllowed(row): boolean

// ❌ Incorrecto — nombre engañoso
function getDeliveries(deps) { await query(`UPDATE ...`); } // get NO actualiza
```

### Consistent error responses

Toda respuesta de error tiene la misma estructura:

```typescript
// 400 — Bad request (validación)
res.status(400).json({ error: "Cursor inválido" });

// 404 — Not found
res.status(404).json({ error: "Licitación no encontrada" });

// 500 — Error interno (siempre loggeado)
res.status(500).json({ status: "error", message, requestId });
```

### Idempotent writes

Las operaciones de escritura deben poder ejecutarse múltiples veces sin efectos secundarios:

```typescript
// ON CONFLICT DO NOTHING para inserts idempotentes
ON CONFLICT (codigo_externo) DO NOTHING
ON CONFLICT (notification_event_id, installation_id) DO NOTHING

// ON CONFLICT DO UPDATE para upserts
ON CONFLICT (installation_id) DO UPDATE SET push_token = EXCLUDED.push_token
```

### Predictable cursor pagination

```typescript
// GET /api/licitaciones?cursor=<base64>&limit=20
// Siempre devuelve pageInfo con hasMore + nextCursor
res.json({
  data: pageRows,
  pageInfo: { limit, hasMore, nextCursor, sortMode, windowDays, windowStart },
});
```

## Directory Structure

```
NotiChileC/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout (push registration)
│   ├── (tabs)/
│   │   ├── index.tsx       # Lista de licitaciones
│   │   └── settings.tsx    # Configuración
│   └── licitacion/
│       └── [id].tsx        # Detalle de licitación
├── src/
│   ├── services/
│   │   ├── api.ts          # Cliente API (fetch licitaciones)
│   │   └── push.ts         # Push token registration
│   └── theme/
│       └── colors.ts       # Paleta de colores
├── server/
│   ├── src/
│   │   ├── server.ts       # Bootstrap combinado (API + worker)
│   │   ├── api-server.ts   # Bootstrap API solo
│   │   ├── app.ts          # Express app (middleware, routes, error handler)
│   │   ├── worker.ts       # 5 ciclos del worker
│   │   ├── worker-runtime.ts # Scheduler cron + run-with-lock
│   │   ├── scraper.ts      # Scraper web ChileCompra
│   │   ├── chilecompra.ts  # API ChileCompra
│   │   ├── push.ts         # Expo Push server (ExpoPushProvider)
│   │   ├── push-provider.ts # Interfaces PushProvider
│   │   ├── db.ts           # PostgreSQL pool
│   │   ├── notification-targeting.ts  # Matching preferencias
│   │   ├── feed-sort.ts    # Modos de ordenamiento
│   │   ├── archive-jobs.ts # Exportación Parquet + S3
│   │   ├── archive-storage.ts # S3 client helpers
│   │   ├── runtime-schema.ts # Schema management
│   │   └── routes/         # Express routes
│   │       ├── devices.ts        # POST /api/devices/register
│   │       ├── installations.ts  # POST /api/installations/sync
│   │       ├── licitaciones.ts   # GET /api/licitaciones
│   │       └── rubros.ts        # GET /api/rubros
│   ├── .env                # Variables (NO commitear)
│   └── package.json
├── server/migrations/      # Migraciones versionadas
│   └── add_rubro_filters.sql
├── .agents/skills/         # Skills del proyecto
└── .github/workflows/     # CI/CD
    ├── ci-server.yml
    ├── ci-client.yml
    └── deploy-main.yml
```

## Critical Patterns

### API URL en el cliente

```typescript
// src/services/api.ts
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
```

### Orden de licitaciones

Ordenar por `created_at DESC` (cuándo se insertó en DB), NO por `fecha_publicacion`.

### Montos

- `monto_estimado`: NUMERIC (cuando es un monto específico)
- `monto_label`: TEXT (cuando es descriptivo: "Igual o superior a 1.000 UTM")
- Mostrar `montoLabel` en la app (generado desde `monto_estimado` o `monto_label`)

### URLs de fichas

Formato correcto:
```
https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=XXX
```

## Commands

```bash
# Iniciar app
npm start                    # Metro bundler

# Iniciar backend
cd server && npm run dev     # Express + worker

# Test backend
cd server && npm run test    # Vitest

# Deploy (futuro)
npx expo export:web
# o Railway/VPS deployment
```

## Environment

- **Dev**: Local PC con PostgreSQL
- **Prod (futuro)**: Railway, VPS, o Oracle Cloud Free
- **Costo estimado**: $0-5 USD/mes para 20 clientes

## Target Client

**Calafquen SPA** — Constructora. Necesita:
- Filtros por rubro (construcción, obras civiles)
- Filtros por región
- Filtros por monto
- Notificaciones push instantáneas

## Referencias

- Backend architecture: `.agents/skills/notichilec-backend-architecture/SKILL.md`
- Worker architecture: `.agents/skills/notichilec-worker-architecture/SKILL.md`
- API patterns: `.agents/skills/notichilec-api/SKILL.md`
- DB schema: `.agents/skills/notichilec-db/SKILL.md`
- `server/src/app.ts` — error handler unificado
- `server/src/routes/*.ts` — ejemplos de endpoints
- `server/src/worker.ts` — idempotent writes
