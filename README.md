# NotiChileC 📱

App de licitaciones ChileCompra - Mantente al día con las oportunidades de negocio del Estado chileno.

## 🚀 Quick Start

### Requisitos Previos

- Node.js 20+
- PostgreSQL 14+
- npm o yarn

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/Sebastiaaann/NotiChileC.git
cd NotiChileC

# 2. Setup automático (recomendado)
npm run setup
```

Esto instalará todas las dependencias y configurará la base de datos automáticamente.

### Configuración Manual

Si preferís la configuración manual:

```bash
# 1. Instalar dependencias
npm install
cd server && npm install && cd ..

# 2. Crear base de datos
createdb notichilec

# 3. Configurar variables de entorno
cp .env.example .env
# ⚠️ Editar .env con tu IP local

# 4. Ejecutar migrations
cd server
psql $DATABASE_URL -f bootstrap.sql
psql $DATABASE_URL -f migrations/add_rubro_filters.sql
cd ..
```

### Encontrar tu IP Local

Para que el celular acceda al servidor:

```bash
# Windows
ipconfig | findstr "IPv4"

# Linux/macOS
ip a | grep "inet " | grep -v "127.0.0.1"
```

Editá `.env` con tu IP (reemplazá `192.168.0.4`).

### Ejecutar la App

```bash
# Terminal 1 - Backend (API + Worker)
npm run dev:server

# Terminal 2 - Frontend (Expo)
npm run dev
```

O en una sola terminal:
```bash
npm run dev
```

## 📁 Estructura del Proyecto

```
NotiChileC/
├── app/                    # Expo Router (frontend)
├── server/
│   ├── src/
│   │   ├── server.ts      # API Express
│   │   ├── worker.ts      # ChileCompra scraper
│   │   ├── scraper.ts     # Lógica de scraping
│   │   ├── chilecompra.ts # Cliente ChileCompra API
│   │   ├── routes/        # Endpoints API
│   │   └── db.ts          # Conexión PostgreSQL
│   ├── migrations/        # Schema de DB
│   └── bootstrap.sql      # Tablas principales
├── .github/workflows/      # GitHub Actions CI/CD
└── scripts/               # Utilidades de setup
```

## 🔧 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Iniciar app en desarrollo |
| `npm run dev:server` | Iniciar solo el backend |
| `npm run setup` | Setup automático (Linux/Mac) |
| `npm run setup:win` | Setup automático (Windows) |
| `npm run lint` | Linter de código |

## 🌿 Ramas Git

- `main` - Producción (protegida)
- `develop` - Desarrollo

## 📄 Licencia

MIT