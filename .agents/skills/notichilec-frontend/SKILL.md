---
name: notichilec-frontend
description: >
  Frontend web de NotiChileC (Bun + Vite + React 19 + shadcn/ui + Tailwind CSS v4 + TypeScript).
  Trigger: Cuando se trabaja en el frontend web, componentes, páginas, auth, o API calls.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Crear o modificar páginas/componentes del frontend web
- Agregar rutas, navegación, o layouts
- Trabajar con autenticación (Better Auth)
- Definir entidades, repositorios, o casos de uso
- Consumir la API de licitaciones
- Configurar TanStack Query, Zustand, o shadcn/ui

## Stack

| Componente | Tecnología |
|------------|------------|
| Runtime | Bun |
| Bundler | Vite 6.x |
| UI | React 19 + TypeScript 5.x |
| Componentes | shadcn/ui (v4, Tailwind CSS v4) |
| Ruteo | React Router v7 |
| Auth | Better Auth 1.6.x (cliente React + servidor Express) |
| Formularios | React Hook Form 7.x + Zod 3.x |
| Server state | TanStack Query 5.x |
| Client state | Zustand 5.x |
| Iconos | Lucide React |

## Arquitectura

### Regla de dependencias

```
core/  ←  infrastructure/  ←  application/  ←  features/  ←  shared/
```

Cada capa solo importa de capas iguales o más internas. Las features NUNCA importan de otras features.

### Estructura de directorios

```
src/
├── core/                       # Entidades de dominio + interfaces (CERO deps externas)
│   ├── entities/
│   │   ├── Licitacion.ts
│   │   ├── User.ts
│   │   └── FiltroFeed.ts
│   └── repositories/
│       ├── ILicitacionesRepo.ts
│       └── IAuthRepo.ts
│
├── infrastructure/             # Implementaciones concretas
│   ├── api/
│   │   ├── http-client.ts
│   │   ├── licitaciones-repo.ts
│   │   └── adapters/
│   │       ├── licitacion-adapter.ts
│   │       └── feed-adapter.ts
│   ├── auth/
│   │   ├── auth-client.ts
│   │   └── auth-repo.ts
│   └── storage/
│       └── local-storage.ts
│
├── application/                # Orquestación global
│   ├── stores/                 # Zustand — solo client state
│   │   ├── filter-store.ts
│   │   └── ui-store.ts
│   ├── providers/
│   │   ├── query-provider.tsx
│   │   ├── auth-provider.tsx
│   │   └── theme-provider.tsx
│   └── hooks/
│       ├── use-feed.ts
│       └── use-auth.ts
│
├── features/                   # Módulos funcionales autocontenidos
│   ├── feed/
│   │   ├── FeedContainer.tsx
│   │   ├── components/
│   │   └── index.ts
│   ├── auth/
│   │   ├── AuthContainer.tsx
│   │   ├── components/
│   │   └── index.ts
│   ├── licitacion-detail/
│   └── settings/
│
├── shared/                     # Componentes root (alcance global)
│   ├── ui/                     # shadcn components
│   ├── lib/
│   │   ├── cn.ts
│   │   ├── format.ts
│   │   └── constants.ts
│   ├── hooks/
│   └── components/
│
└── app.tsx                     # Root con providers + router
```

## Reglas críticas

### 1. Separación de estado

| Tipo de estado | Dónde va | Herramienta |
|----------------|----------|-------------|
| Datos de API | TanStack Query | `useQuery`, `useInfiniteQuery` |
| UI efímera | Local component | `useState`, `useReducer` |
| UI global compartida | Zustand store | `filter-store`, `ui-store` |
| Form inputs | React Hook Form | `useForm` + `FormField` |
| Sesión / auth | Better Auth | `useSession()` hook |

**NUNCA guardar datos de API en Zustand.** TanStack Query maneja caché, stale, refetch.

### 2. Patrón contenedor

Cada feature tiene un **Container** que:
1. Obtiene datos (via hooks de application/)
2. Maneja estado del layout
3. Renderiza componentes hijos (tontos)

Los componentes hijos NO hacen fetch, NO llaman a stores directamente. Son puramente presentacionales.

### 3. Tipado estricto

Ver skill `notichilec-typescript` + companion doc `docs/plans/typescript-patterns.md` para reglas completas:

| Concepto | Regla |
|----------|-------|
| `any` | Prohibido. Usar `unknown` con narrowing |
| Enums | Preferir `as const` objects. Enums solo con reverse mapping |
| Interfaces vs Types | Interfaces para APIs públicas, Types para uniones/derivados |
| Utility types | Usar `Partial`, `Pick`, `Omit`, `Record`, `ReturnType` por defecto |
| Genéricos | `IRepositorio<T>` obligatorio en repositorios |
| Zod + `z.infer` | Única fuente de verdad para datos de entrada |

### 4. Better Auth

- El servidor Express monta Better Auth como middleware en `/api/auth`
- El frontend usa `createAuthClient` desde `better-auth/react`
- `useSession()` es el hook para leer sesión
- Las rutas protegidas checkean sesión en el layout antes de renderizar

### 5. Formularios

Todos los formularios siguen este patrón:
```tsx
const formSchema = z.object({ ... })
const form = useForm<z.infer<typeof formSchema>>({
  resolver: zodResolver(formSchema),
})
// <FormField> + <FormLabel> + <FormControl> + <FormMessage>
```

## Pantallas

| Ruta | Feature | Auth required |
|------|---------|---------------|
| `/` | feed | No |
| `/licitacion/:id` | licitacion-detail | No |
| `/login` | auth | No |
| `/register` | auth | No |
| `/settings` | settings | Sí |

### 6. Networking (HTTP Client)

El `http-client` ya implementa el wrapper base. Reglas para usarlo/extenderlo:

#### Timeouts

```ts
// El http-client soporta AbortSignal para timeouts:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

try {
  await httpClient("/licitaciones", { signal: controller.signal });
} finally {
  clearTimeout(timeoutId);
}
```

#### Retry strategy

TanStack Query ya maneja retry para queries. Para llamadas directas con `httpClient`:

- **GET**: No retry manual — TanStack Query lo maneja con `retry: 2`
- **POST/PUT**: No retry automático (riesgo de duplicados). Usar idempotency keys.
- **Errores 401**: No retry — redirigir a login.
- **Errores 5xx**: Retry con exponential backoff (TanStack Query default: `retryDelay: attempt => Math.min(1000 * 2 ** attempt, 30000)`)

#### Cache headers

El servidor no setea cache headers explícitos. Las queries de TanStack Query usan `staleTime`:

```ts
// Configuración global (main.tsx)
staleTime: 1000 * 60 * 2,  // 2 minutos

// Por query (si el dato cambia más/menos seguido)
useQuery({
  queryKey: ["feed"],
  staleTime: 1000 * 60 * 5,  // 5 min para licitaciones
})
```

#### Manejo de errores HTTP

El `HttpClientError` incluye `status` y `code`. Usarlo para manejo granular:

```ts
try {
  await httpClient("/licitaciones");
} catch (error) {
  if (error instanceof HttpClientError) {
    switch (error.status) {
      case 401: navigate("/login"); break;
      case 404: showNotFound(); break;
      case 429: showRateLimited(); break;
      default: showError(error.message);
    }
  }
}
```

#### Content Security Policy (Frontend)

El frontend no necesita CSP explícito en dev (Vite lo maneja). En producción, el servidor Express debe enviar headers CSP (ver skill `notichilec-backend-architecture` sección Seguridad).

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Component Design: `docs/plans/component-design-patterns.md` + skill `notichilec-component-design`
- Performance: `docs/plans/performance-patterns.md` + skill `notichilec-performance`
- Testing: `docs/plans/testing-strategy.md` + skill `notichilec-testing-strategy`
- Barrel exports: `docs/plans/barrel-exports-convention.md` + skill `notichilec-barrels`
- React patterns: `docs/plans/react-patterns.md` + skill `notichilec-react-patterns`
- TypeScript patterns: `docs/plans/typescript-patterns.md` + skill `notichilec-typescript`
