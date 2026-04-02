# NotiChileC 📱

App de licitaciones ChileCompra para mantenerte al día con oportunidades de negocio del Estado chileno.

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

# 2. Setup automático multiplataforma
npm run setup
```

`npm run setup` delega a:
- `scripts/setup.bat` en Windows
- `scripts/setup.sh` en Linux/macOS

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
# ⚠️ Editar .env con la URL pública/local del backend

cd server
cp .env.example .env
cd ..

# 4. Ejecutar migrations
cd server
psql $DATABASE_URL -f bootstrap.sql
psql $DATABASE_URL -f migrations/add_rubro_filters.sql
cd ..
```

## 🔐 Variables de entorno

- `D:\Expo movil\NotiChileC\.env` → variables públicas del cliente Expo (`EXPO_PUBLIC_*`)
- `D:\Expo movil\NotiChileC\server\.env` → variables privadas del backend (`DATABASE_URL`, `CHILECOMPRA_TICKET`, `PORT`, `WORKER_INTERVAL_MINUTES`)

### Encontrar tu IP local

Para que el celular acceda al servidor:

```bash
# Windows
ipconfig | findstr "IPv4"

# Linux/macOS
ip a | grep "inet " | grep -v "127.0.0.1"
```

Editá `D:\Expo movil\NotiChileC\.env` con tu IP o URL del backend (reemplazá `192.168.0.4`).

### Ejecutar la App

```bash
# Terminal 1 - Backend combinado (API + Worker)
npm run dev:server

# Terminal 2 - Frontend (Expo)
npm run dev
```

### Modos de backend

```bash
# API solamente
npm run dev:server:api

# Worker solamente
npm run dev:server:worker

# Ejecutar un ciclo manual del worker
npm run server:worker:once
```

Usá el modo combinado solo para desarrollo local rápido. Para crecer la aplicación, preferí API y worker como procesos separados.

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
| `npm run dev` | Iniciar app Expo |
| `npm run dev:server` | Iniciar backend combinado (API + Worker) |
| `npm run dev:server:api` | Iniciar solo la API |
| `npm run dev:server:worker` | Iniciar solo el worker |
| `npm run server:worker:once` | Ejecutar un ciclo manual del worker |
| `npm run setup` | Setup automático multiplataforma |
| `npm run setup:win` | Setup automático (Windows) |
| `npm run setup:unix` | Setup automático (Linux/macOS) |
| `npm run lint` | Linter de código |

## 🌿 Ramas Git

- `main` - Producción (protegida)
- `develop` - Desarrollo

## 📄 Licencia

MIT
