---
name: notichilec-react-patterns
description: >
  Patrones avanzados de React para FrontNotiChileC (Error Boundaries,
  Custom Hooks, useEffect discipline, Portals).
  Trigger: Manejar errores de componentes, extraer lógica a hooks, o decidir uso de useEffect.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Capturar errores de renderizado en componentes (Error Boundary)
- Extraer lógica repetitiva a custom hooks
- Decidir si algo va en useEffect o en un event handler
- Implementar modales, tooltips, o dropdowns con Portals

---

## 1. Error Boundaries

### ¿Qué capturan?

Error Boundaries capturan errores durante el **renderizado**, en **ciclos de vida**, y en **constructores** de componentes hijos. NO capturan:
- Errores asíncronos (fetch, setTimeout)
- Errores en event handlers (usar try/catch ahí)
- Errores de SSR

### Implementación

En React 19, los Error Boundaries siguen siendo componentes de clase:

```tsx
// shared/components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: string) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error capturado:', error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo.componentStack ?? '');
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div role="alert">
          <h2>Algo salió mal</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### Dónde poner Error Boundaries

```
<ErrorBoundary fallback={<FullPageError />}>       ← Nivel app (catch-all)
  <AppLayout>
    <ErrorBoundary fallback={<SectionError />}>     ← Por feature
      <FeedContainer />
    </ErrorBoundary>
    <ErrorBoundary fallback={<WidgetError />}>      ← Por widget
      <SidebarWidget />
    </ErrorBoundary>
  </AppLayout>
</ErrorBoundary>
```

**Regla**: Cada feature lazy-loadable DEBE tener su propio ErrorBoundary. Así si una feature falla, las otras siguen funcionando.

### Error Boundary + Lazy Loading

```tsx
const FeedPage = lazy(() => import('@/features/feed'));

<ErrorBoundary fallback={<FeedError />}>
  <Suspense fallback={<FeedSkeleton />}>
    <FeedPage />
  </Suspense>
</ErrorBoundary>
```

**Regla**: Todo `lazy()` debe estar envuelto en un ErrorBoundary + Suspense. ErrorBoundary por fuera, Suspense por dentro.

---

## 2. Custom Hooks

### Cuándo extraer un hook

```
¿La lógica se repite en 2+ componentes?
  ├── ¿Usa estado o efectos de React?
  │   ├── Sí → Custom Hook (useX)
  │   └── No → Función utilitaria en shared/lib/
  └── ¿Solo la usa un componente?
      ├── ¿Tiene más de 15 líneas?
      │   ├── Sí → Extraer a hook local en features/X/hooks/
      │   └── No → Dejarla inline
```

### Estructura de un custom hook

```tsx
// application/hooks/use-feed.ts
export function useFeed() {
  const filters = useFilterStore(state => state.filters);

  const query = useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) => api.getFeed({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = query.data?.pages.flatMap(p => p.items) ?? [];

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    refetch: query.refetch,
  };
}
```

**Reglas**:
- Nombre: `useAlgo` — siempre con `use` prefix
- Cada hook hace UNA cosa (SRP)
- El hook devuelve SOLO lo que el componente necesita, no todo el query object
- Los hooks de TanStack Query van en `application/hooks/`
- Los hooks específicos de feature van en `features/X/hooks/`

### Hooks que envuelven APIs externas

```tsx
// application/hooks/use-auth.ts
export function useAuth() {
  const { data: session, isPending, error } = useSession();

  return {
    user: session?.user ?? null,
    isAuthenticated: !!session?.user,
    isLoading: isPending,
    error,
  };
}
```

Nunca exponer la librería externa (Better Auth, TanStack Query) directamente al componente. El hook es la abstracción.

---

## 3. useEffect Discipline

### Regla de oro

> useEffect es para **sincronizar** tu componente con un sistema externo (API, subscription, DOM, localStorage). NO es para reaccionar a cambios de estado.

### Lo que NO va en useEffect

```tsx
// ❌ MAL: useEffect para reaccionar a cambios de estado
const [value, setValue] = useState('');
useEffect(() => {
  console.log('El valor cambió:', value);
}, [value]);

// ✅ BIEN: Ejecutar la lógica en el handler directamente
const handleChange = (newValue: string) => {
  setValue(newValue);
  console.log('El valor cambió:', newValue);
};
```

```tsx
// ❌ MAL: derivar estado con useEffect
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${first} ${last}`);
}, [first, last]);

// ✅ BIEN: derivar directamente
const fullName = `${first} ${last}`;
```

### Lo que SÍ va en useEffect

```tsx
// ✅ Llamada a API al montar (solo si NO usás TanStack Query)
useEffect(() => {
  fetch('/api/data')
    .then(r => r.json())
    .then(setData)
    .catch(setError);
}, []);

// ✅ Suscripciones con cleanup
useEffect(() => {
  const sub = eventBus.subscribe(handleEvent);
  return () => sub.unsubscribe();
}, []);

// ✅ Sincronización con localStorage
useEffect(() => {
  localStorage.setItem('theme', theme);
}, [theme]);
```

**En la práctica con TanStack Query**: useEffect para llamadas a APIs es innecesario. TanStack Query lo maneja. useEffect queda solo para: suscripciones, sincronización con APIs externas no-TanStack, y efectos secundarios que NO son datos.

### Anti-patrones comunes

| Anti-patrón | Problema | Solución |
|---|---|---|
| Bucle infinito | `useEffect` actualiza una dependencia suya | Separar lógica o usar functional update |
| Estado derivado en useEffect | Render extra innecesario | Calcular valor directamente |
| fetch en useEffect sin cleanup | Race condition en respuestas | Usar `useRef` + flag o TanStack Query |
| useEffect sin dependencias (`[]`) que debería tener | Stale closure | Agregar las dependencias que necesita |
| Múltiples useEffect uno tras otro que podrían ser uno | Dificulta lectura | Combinarlos si comparten lógica |

---

## 4. Portals

shadcn/ui (Radix UI) ya maneja Portals internamente para modales, dropdowns, tooltips. No necesitamos `createPortal` manual.

**Solo implementar Portal manual cuando**:
- Necesitás renderizar contenido en un nodo específico fuera del root de la app
- Estás creando un componente custom que Radix no cubre

```tsx
import { createPortal } from 'react-dom';

function CustomModal({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div className="modal-overlay">{children}</div>,
    document.getElementById('portal-root')!
  );
}
```

Para el 99% de los casos: shadcn/ui + Radix alcanza y sobra.

---

## 5. Formularios Avanzados

### Estados del formulario

TODO formulario maneja 3 estados explícitos:

```tsx
function LoginForm({ onSubmit, isPending, error }: Props) {
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* ... inputs ... */}

      {/* ERROR */}
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}

      {/* SUBMIT con loading */}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Ingresando..." : "Ingresar"}
      </Button>
    </form>
  );
}
```

### Validación asíncrona con Zod

```tsx
const registerSchema = z.object({
  email: z.string().email("Email inválido")
    .refine(async (email) => {
      // Verificar si el email ya existe en el backend
      const res = await fetch(`/api/auth/check-email?email=${email}`);
      const data = await res.json();
      return !data.exists;
    }, "Este email ya está registrado"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});
```

> **Ojo**: La validación asíncrona en `refine` se ejecuta en cada cambio. Usar `debounce` o `onBlur` para evitar llamadas excesivas. Mejor aún: dejar la validación de unicidad para el backend y mostrar el error del mutation.

### Accesibilidad en formularios

```tsx
// ❌ MAL: error solo con color rojo
{errors.email && <span style={{ color: 'red' }}>{errors.email.message}</span>}

// ✅ BIEN: error con role="alert" + texto visible + aria-invalid
<Input
  id="email"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? "email-error" : undefined}
/>
{errors.email && (
  <p id="email-error" role="alert" className="text-sm text-destructive">
    {errors.email.message}
  </p>
)}
```

### Patrón: Formulario con mutación (TanStack Query + React Hook Form)

```tsx
const schema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
});

type FormData = z.infer<typeof schema>;

function ProfileForm() {
  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (data: FormData) => httpClient("/api/profile", { method: "PATCH", body: data }),
    onSuccess: () => { toast.success("Perfil actualizado"); },
    onError: (error) => { toast.error(error.message); },
  });

  return (
    <form onSubmit={form.handleSubmit((data) => mutation.mutateAsync(data))}>
      {/* ... */}
      <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
        {mutation.isPending ? "Guardando..." : "Guardar"}
      </Button>
    </form>
  );
}
```

### Buenas prácticas

- `isDirty` → deshabilitar submit si no hay cambios
- `isPending` → deshabilitar submit + mostrar spinner en botón
- `disabled` fields → NO eliminar del DOM, solo deshabilitar con atributo `disabled`
- Errores del servidor → mostrar en `toast` o en `error` del formulario
- Campos requeridos → marcar visualmente con `*` y `aria-required="true"`

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Doc React patterns: `docs/plans/react-patterns.md`
- Skill: `notichilec-component-design` (Component Design)
- Skill: `notichilec-performance` (Performance)
- Skill: `notichilec-frontend` (arquitectura general)
- Skill: `notichilec-a11y` (Accesibilidad WCAG)
