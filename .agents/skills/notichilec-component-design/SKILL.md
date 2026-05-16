---
name: notichilec-component-design
description: >
  Patrones de diseño de componentes para FrontNotiChileC (Container Pattern,
  SRP, composición, compound components).
  Trigger: Crear o modificar componentes React, containers, features, o shared components.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Crear un nuevo componente o feature
- Refactorizar un componente que mezcla lógica + presentación
- Decidir si algo va en Container vs Component vs Hook
- Diseñar componentes que otros van a reutilizar

## Principios

### 1. Single Responsibility (SRP)

> Un componente = una responsabilidad.

```
❌ MAL: Un componente que fetchea, transforma, renderiza, y maneja estado de UI
✅ BIEN: Container fetchea + orquesta, Componente renderiza
```

```tsx
// ❌ MAL
function FeedCard({ productId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/products/${productId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [productId]);

  return <div>{/* ... TODO mezclado ... */}</div>;
}

// ✅ BIEN: Container que orquesta
function FeedCardContainer({ productId }) {
  const { data, isLoading } = useProduct(productId);
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading) return <CardSkeleton />;
  return <FeedCard product={data} isExpanded={isExpanded}
                   onToggle={() => setIsExpanded(e => !e)} />;
}

// ✅ BIEN: Componente presentacional
function FeedCard({ product, isExpanded, onToggle }) {
  return (<div onClick={onToggle}>
    <h3>{product.nombre}</h3>
    {isExpanded && <p>{product.descripcion}</p>}
  </div>);
}
```

### 2. Container Pattern

Cada feature tiene UN Container que:
1. **Obtiene datos** (via hooks de `application/` o TanStack Query directo)
2. **Maneja estado UI** del layout (expansión, tabs, modales)
3. **Renderiza componentes hijos** pasándoles props

```
features/feed/
├── FeedContainer.tsx    ← Datos + layout + estado
├── components/
│   ├── FeedCard.tsx     ← Solo props, no lógica
│   └── FeedFilters.tsx  ← Solo props
└── index.ts
```

**Regla**: Los componentes hijos NO hacen fetch, NO llaman a stores, NO usan TanStack Query. Son **puramente presentacionales**.

### 3. Composición sobre Props Explosión

Cuando un componente tiene demasiadas props, es hora de componer:

```tsx
// ❌ MAL: Explosión de props
<Card variant="elevated" size="lg" showImage={true} imageUrl="..."
      showBadge={true} badgeText="Nuevo" badgeVariant="success"
      showActions={true} onEdit={...} onDelete={...} />

// ✅ BIEN: Composición
<Card variant="elevated" size="lg">
  <CardImage src="..." />
  <CardBadge variant="success">Nuevo</CardBadge>
  <CardActions>
    <Button onClick={...}>Editar</Button>
    <Button onClick={...}>Eliminar</Button>
  </CardActions>
</Card>
```

Usar `children` y slots (como `<CardImage>`, `<CardActions>`) en lugar de boolean flags.

### 4. Compound Components

Para componentes con múltiples partes relacionadas que comparten estado interno:

```tsx
<FeedFilters>
  <FeedFilters.Selector name="rubro" />
  <FeedFilters.Selector name="region" />
  <FeedFilters.Range name="monto" min={0} max={100000000} />
  <FeedFilters.ActiveTags />
</FeedFilters>
```

Implementación: `React.createContext` + `useContext` dentro del mismo módulo. El estado se comparte via contexto interno, no via props.

### 5. State Location Decision Tree

```
¿El estado lo usa solo este componente?
  → useState (local)

¿Lo usan componentes hermanos?
  → Lifting State Up al padre común

¿Lo usan componentes lejanos en el árbol?
  → Zustand store (client state global)

¿Son datos de API?
  → TanStack Query (server state)

¿Es parte de la URL?
  → React Router search params

¿Son valores de un formulario?
  → React Hook Form + Zod
```

## Anti-Patterns

### ❌ Prop Drilling
Pasar props a través de 3+ niveles que no las usan.
**Fix**: Extraer a un Container intermedio o usar Context (solo si realmente es necesario).

### ❌ Efectos para derivar estado
```tsx
// ❌ MAL
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ BIEN
const fullName = `${first} ${last}`;
```

### ❌ Fetch en componentes hijos
```tsx
// ❌ MAL: Dos componentes hacen fetch del mismo endpoint
// ✅ BIEN: El padre fetchea, los hijos reciben por props
```

### ❌ Un componente que hace demasiado
Si un archivo tiene más de 200 líneas y mezcla lógica + JSX, **partilo**.

## Reglas de importación

| Componente | Puede importar de |
|-----------|-------------------|
| Container | `core/`, `shared/`, `application/stores`, `application/hooks` |
| Presentational | `shared/`, `core/entities` (solo tipos) |
| Shared component | `shared/`, `core/` |
| Feature component | NUNCA otra feature |

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Doc component design: `docs/plans/component-design-patterns.md`
- Skill: `notichilec-frontend` (arquitectura general)
- Skill: `notichilec-performance` (Performance)
- Skill: `notichilec-testing-strategy` (Testing)
