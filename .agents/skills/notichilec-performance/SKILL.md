---
name: notichilec-performance
description: >
  Patrones de performance para FrontNotiChileC (skeleton screens, lazy loading,
  optimistic UI, Core Web Vitals, caching).
  Trigger: Optimizar carga, implementar feeds con scroll infinito, o manejar estados de carga/error.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Implementar feed con scroll infinito (uso intensivo de cursor pagination)
- Mostrar estados de carga (skeleton, spinner)
- Optimizar tiempos de carga percibida
- Manejar mutaciones con feedback instantáneo
- Implementar lazy loading de rutas o imágenes

## Principios de Performance

### 1. Performance Percibida > Performance Real

> El usuario recuerda cómo se sintió, no los milisegundos reales.

| Tiempo | Sensación | Qué hacer |
|--------|-----------|-----------|
| < 100ms | Instantáneo | Nada |
| 100-300ms | Retraso leve | Feedback sutil |
| 300ms-1s | Notable | Skeleton/spinner |
| 1-3s | Espera | Spinner + mensaje |
| > 3s | Abandono | Progress + fallback |

### 2. Skeleton Screens

Siempre mostrar estructura ANTES de que carguen los datos. Se siente 2x más rápido que un spinner.

```tsx
function FeedContainer() {
  const { data, isLoading } = useFeed();

  if (isLoading) return <FeedSkeleton />;
  if (!data) return <FeedEmpty />;
  return <FeedList items={data} />;
}

// Skeleton que matchea la estructura real
function FeedSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse space-y-2 p-4">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-full" />
        </div>
      ))}
    </div>
  );
}
```

**Regla**: Cada Container que fetchea datos DEBE tener su Skeleton correspondiente.

### 3. Estados: Loading → Empty → Error → Success

TODO componente que fetchea datos maneja estos 4 estados:

```tsx
function DataContainer() {
  const { data, isLoading, error } = useQuery(...);

  // loading
  if (isLoading) return <Skeleton />;

  // error
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  // empty (éxito pero sin datos)
  if (!data || data.length === 0) return <EmptyState message="Sin resultados" />;

  // success
  return <DataView data={data} />;
}
```

No hay excusa para no cubrir los 4 estados. Un componente que solo maneja éxito tiene experiencia de usuario pobre.

### 4. Scroll Infinito con TanStack Query

Para el feed de licitaciones:

```tsx
function FeedContainer() {
  const filters = useFilterStore(state => state.filters);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) => api.getFeed({ ...filters, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  if (isLoading) return <FeedSkeleton />;

  return (
    <div>
      {data.pages.map(page =>
        page.items.map(item => <FeedCard key={item.id} item={item} />)
      )}

      {hasNextPage && (
        <IntersectionSensor onIntersect={() => fetchNextPage()}>
          {isFetchingNextPage ? <Spinner /> : <LoadMore />}
        </IntersectionSensor>
      )}
    </div>
  );
}
```

**Regla**: Usar `IntersectionObserver` (o `IntersectionSensor` de shadcn) para trigger de carga. NO usar scroll events.

### 5. Optimistic UI

Para mutaciones (si las hay: like, favorito, etc.), actualizar UI antes de confirmar con servidor:

```tsx
const toggleFavorite = useMutation({
  mutationFn: (id) => api.post(`/licitaciones/${id}/favorite`),
  onMutate: async (id) => {
    // Cancelar queries salientes
    await queryClient.cancelQueries({ queryKey: ['feed'] });

    // Snapshot para rollback
    const previous = queryClient.getQueriesData({ queryKey: ['feed'] });

    // Actualizar optimistamente
    queryClient.setQueryData(['feed'], (old) => /* updated data */);

    return { previous };
  },
  onError: (err, id, context) => {
    // Rollback en error
    queryClient.setQueriesData({ queryKey: ['feed'] }, context.previous);
    toast.error('No se pudo actualizar');
  },
  onSettled: () => {
    // Refetch para asegurar consistencia
    queryClient.invalidateQueries({ queryKey: ['feed'] });
  },
});
```

### 6. Lazy Loading de Rutas

Todas las rutas usan `lazy()` + `Suspense`:

```tsx
const FeedPage = lazy(() => import('@/features/feed'));
const DetailPage = lazy(() => import('@/features/licitacion-detail'));
const AuthPage = lazy(() => import('@/features/auth'));
const SettingsPage = lazy(() => import('@/features/settings'));

function AppRouter() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/licitacion/:id" element={<DetailPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  );
}
```

### 7. Imágenes

```tsx
// Lazy loading nativo
<img src="..." alt="..." loading="lazy" />

// Reservar espacio para evitar CLS
.image-container {
  aspect-ratio: 16 / 9;
  width: 100%;
  background: #f0f0f0;
}
```

## Core Web Vitals

| Métrica | Objetivo | Cómo lograrlo |
|---------|----------|---------------|
| LCP | < 2.5s | Lazy loading de rutas, skeleton screens, preload fonts |
| FID | < 100ms | Evitar long tasks, chunk grandes cálculos |
| CLS | < 0.1 | aspect-ratio en imágenes, reservar espacio para skeletons |

## Anti-Patterns

### ❌ Layout thrashing
```tsx
// MAL: Reflow en cada iteración
items.forEach(el => {
  el.style.width = el.offsetWidth + 10 + 'px';
});

// BIEN: Batch reads, luego writes
const widths = items.map(el => el.offsetWidth);
items.forEach((el, i) => {
  el.style.width = widths[i] + 10 + 'px';
});
```

### ❌ Spinner genérico para todo
Usar skeleton screens que matcheen la estructura. Spinner solo para acciones (submit, delete).

### ❌ Scroll event listener
Usar Intersection Observer para detectar scroll. Los scroll events causan repaint.

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Doc performance: `docs/plans/performance-patterns.md`
- Skill: `notichilec-frontend` (arquitectura general)
- Skill: `notichilec-component-design` (Component Design)
- Skill: `notichilec-testing-strategy` (Testing)
