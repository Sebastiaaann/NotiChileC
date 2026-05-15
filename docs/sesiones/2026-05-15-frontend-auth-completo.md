---
title: "Frontend + Auth — Sesión Completa"
date: 2026-05-15
tags:
  - frontend
  - auth
  - arquitectura
  - sdds
status: completed
project: NotiChileC
---

# Frontend + Auth — Sesión Completa

> Desde documentación de arquitectura hasta implementación funcional del frontend web + backend auth.

## Documentos analizados

| Documento | Skills creados | Docs generados |
|-----------|---------------|----------------|
| [[Clean Architecture en Front End]] | `notichilec-component-design` | `component-design-patterns.md` |
| [[Manual Definitivo del Frontend Developer]] | `notichilec-performance`, `notichilec-testing-strategy` | `performance-patterns.md`, `testing-strategy.md` |
| [[Guía Barrel Exports]] | `notichilec-barrels` | `barrel-exports-convention.md` |
| [[Dominando React]] | `notichilec-react-patterns` | `react-patterns.md` |
| [[TypeScript Con De Tuti]] | `notichilec-typescript` | `typescript-patterns.md` |
| [[Conceptos de Arquitectura]] | `notichilec-backend-architecture`, `notichilec-worker-architecture` | — (skills only) |
| [[blocks.so]] | — | Mapeo UI para Phase 1 |

## Archivos clave

### Frontend — `D:\Expo movil\FrontNotiChileC\`

```
src/
├── core/entities/           Licitacion, User, FiltroFeed, ApiResponse
├── core/repositories/       ILicitacionesRepo, IAuthRepo
├── infrastructure/api/      http-client, licitaciones-repo, adapters
├── infrastructure/auth/     auth-client
├── application/stores/      filter-store, auth-store, sidebar-store (Zustand)
├── application/hooks/       useFeed, useAuth (TanStack Query)
├── features/feed/           FeedContainer + FeedTable/Filters/Skeleton
├── features/auth/           AuthContainer + LoginForm/RegisterForm
├── shared/components/       AppLayout, AppSidebar, AuthGuard, Guards
├── shared/lib/              cn, format, constants
└── components/ui/           15 shadcn components
```

### Backend Auth — `D:\Expo movil\NotiChileC\server\`

```
src/routes/auth.ts    register, login, session, logout
scripts/migrate-auth.ts    Creación tabla users
bootstrap.sql          Tabla users agregada al schema
```

## Skills del proyecto (15 total)

> [!tip] Todos los skills están en `.agents/skills/` y el registry en `.atl/skill-registry.md`

| # | Skill | Tipo |
|---|-------|------|
| 1 | `notichilec-frontend` | Arquitectura web |
| 2 | `notichilec-component-design` | Container Pattern |
| 3 | `notichilec-performance` | Performance |
| 4 | `notichilec-testing-strategy` | Testing |
| 5 | `notichilec-barrels` | Barrel exports |
| 6 | `notichilec-react-patterns` | React patterns |
| 7 | `notichilec-typescript` | TypeScript rules |
| 8 | `notichilec-backend-architecture` | Backend capas |
| 9 | `notichilec-worker-architecture` | Worker locking |
| 10 | `notichilec-api` | API Express |
| 11 | `notichilec-db` | PostgreSQL |
| 12 | `notichilec-scraper` | ChileCompra |
| 13 | `notichilec-project` | Convenciones |
| 14 | `find-skills` | Skill discovery |
| 15 | `expect` | Browser testing |

## Implementación entregada

### PRs mergeados a `develop`

| PR | Branch | Contenido | Líneas |
|----|--------|-----------|--------|
| PR 1 | `feat/pr1-core-layer` | Entities, infra, stores, hooks | +427 |
| PR 2 | `feat/pr2-shared-components` | Sidebar, layout, guards, dialogs | +438 |
| PR 3 | `feat/pr3-auth-feature` | Login/Register forms + Zod | +252 |
| PR 4 | `feat/pr4-feed-wiring` | Feed table + filters + routing | +292 |

### Auth backend

- `POST /api/auth/register` — registro con nombre, email, password
- `POST /api/auth/login` — login con JWT (7 días)
- `GET /api/auth/session` — verificación de token
- `POST /api/auth/logout` — cierre de sesión
- Tabla `users` en PostgreSQL con bcrypt

### UI

- Login como pantalla inicial (feed protegido)
- Sidebar sin "Ingresar", con email + "Cerrar sesión"
- Feed con tabla paginada, filtros, skeleton, empty/error states

## Pendientes

- [ ] Detalle de licitación (`/licitacion/:id`)
- [ ] Settings page
- [ ] Modo oscuro
- [ ] Tests
- [ ] Deploy

---

> [!info] Persistencia
> Todo está guardado en **Engram** (cross-session) y en **filesystem** (`.agents/skills/`, `docs/plans/`, código fuente).
