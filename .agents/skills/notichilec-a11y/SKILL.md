---
name: notichilec-a11y
description: >
  Reglas de accesibilidad WCAG 2.1 y HTML semántico para FrontNotiChileC.
  Trigger: Crear componentes, templates, formularios, o revisar accesibilidad.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Crear componentes que interactúan con el usuario (botones, enlaces, formularios, iconos)
- Revisar accesibilidad de components ya creados (FeedTable, FeedFilters, AppSidebar)
- Implementar modales, dropdowns, tooltips o menús personalizados (fuera de shadcn)
- Asegurar que la app cumple WCAG 2.1 nivel AA

---

## 1. HTML Semántico

### Usá el elemento correcto para cada cosa

```tsx
// ❌ MAL
<div onClick={handleClick}>Guardar</div>
<div className="heading">Título</div>
<nav>
  <div onClick={() => navigate("/")}>Inicio</div>
</nav>

// ✅ BIEN
<button onClick={handleClick}>Guardar</button>
<h1>Título</h1>
<nav>
  <a href="/">Inicio</a>
</nav>
```

| Elemento | Cuándo usarlo |
|----------|---------------|
| `<button>` | Acciones (guardar, eliminar, toggle) |
| `<a>` | Navegación a otra ruta/URL |
| `<h1>`-`<h6>` | Títulos, jerarquía sin saltos |
| `<nav>` | Navegación principal (sidebar, topbar) |
| `<main>` | Contenido principal (uno por página) |
| `<form>` | Formularios con submit |
| `<table>` | Datos tabulares (ya en FeedTable ✅) |

### Jerarquía de headings

```tsx
// ❌ SALTO: h1 → h3 (se salta h2)
<h1>Licitaciones</h1>
<h3>Filtros</h3>

// ✅ BIEN: h1 → h2
<h1>Licitaciones</h1>
<h2>Filtros</h2>
```

**Regla**: No saltear niveles. Un `h3` solo si hay un `h2` antes.

---

## 2. Componentes Interactivos

### Botones y elementos clickeables

```tsx
// ❌ MAL: icon-only button sin label
<button><XIcon /></button>

// ✅ BIEN: con aria-label
<button aria-label="Cerrar"><XIcon /></button>

// ❌ MAL: div clickeable
<div onClick={handleClick} role="button">Aceptar</div>

// ✅ BIEN: button real
<button onClick={handleClick}>Aceptar</button>
```

### Elementos con onClick NO semánticos

Si por alguna razón usás un `<div>` o `<span>` con onClick (evitarlo), agregá:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
>
```

---

## 3. Focus Visible

```tsx
// ❌ MAL: outline none sin reemplazo
*:focus { outline: none; }

// ✅ BIEN: personalizar focus-visible
:focus-visible {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
}
```

shadcn/ui ya lo maneja en sus componentes. Verificar en componentes custom.

---

## 4. Imágenes y SVG

```tsx
// ❌ MAL: sin alt
<img src="/logo.png" />
<img src="/chart.svg" />

// ✅ BIEN: alt descriptivo
<img src="/logo.png" alt="NotiChileC" />
<img src="/chart.svg" alt="Gráfico de licitaciones por mes" />

// ✅ Iconos decorativos: alt vacío
<img src="/decorative.svg" alt="" role="presentation" />
```

Para íconos SVG inline (lucide-react), usar `aria-hidden`:

```tsx
<XIcon className="h-4 w-4" aria-hidden="true" />
```

---

## 5. Formularios Accesibles

```tsx
// ❌ MAL: sin label asociado
<input placeholder="Email" />

// ✅ BIEN: label + htmlFor
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" />

// ✅ BIEN: aria-label cuando no hay label visible
<Input aria-label="Buscar licitaciones" placeholder="Buscar..." />
```

### Mensajes de error

```tsx
// ❌ MAL: solo color rojo
{error && <span style={{ color: 'red' }}>{error}</span>}

// ✅ BIEN: role="alert" + texto visible
{error && (
  <p role="alert" className="text-sm text-destructive">
    {error}
  </p>
)}
```

---

## 6. Componentes Custom (no shadcn)

Para componentes que NO son de shadcn/Radix, verificar:

| Componente | Requiere |
|------------|----------|
| FeedTable | `<table>` + `<th scope="col">` ✅ ya ok |
| FeedFilters | `<label>` en cada selector ✅ |
| FeedSkeleton | `aria-hidden="true"` (es decorativo) |
| AppSidebar | `<nav>` + `aria-current="page"` en link activo |
| ConfirmDialog | Radix AlertDialog lo maneja |
| ErrorState | `role="alert"` |
| EmptyState | `role="status"` |

---

## 7. Contraste de Color

- **AA (mínimo)**: 4.5:1 texto normal, 3:1 texto grande
- **AAA (óptimo)**: 7:1 texto normal, 4.5:1 texto grande

shadcn/ui usa CSS variables con contraste AA por defecto. Si se personalizan colores, verificar con herramienta de contraste.

---

## Referencias

- Skill: `notichilec-component-design` (Container Pattern)
- Skill: `notichilec-react-patterns` (Error Boundaries, formularios)
- WCAG 2.1: https://www.w3.org/TR/WCAG21/
- shadcn/ui: accesibilidad incluida en componentes Radix
