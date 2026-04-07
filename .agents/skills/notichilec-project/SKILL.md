---
name: notichilec-project
description: >
  Convenciones y arquitectura del proyecto NotiChileC.
  Trigger: Cuando se trabaja en cualquier parte del proyecto NotiChileC.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Cualquier trabajo en el proyecto NotiChileC
- Agregar features nuevas
- Modificar la app móvil o el backend
- Deploy o configuración

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
│   │   ├── server.ts       # Express + cron
│   │   ├── worker.ts       # Sync cycle
│   │   ├── scraper.ts      # Scraper web
│   │   ├── chilecompra.ts  # API ChileCompra
│   │   ├── push.ts         # Expo Push server
│   │   ├── db.ts           # PostgreSQL pool
│   │   └── routes/         # Express routes
│   ├── .env                # Variables (NO commitear)
│   └── package.json
└── .agents/skills/         # Skills del proyecto
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
