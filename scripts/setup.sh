#!/bin/bash

# ============================================================
# NotiChileC - Setup Script
# Automatiza la configuración inicial del proyecto
# ============================================================

set -e

echo "🚀 NotiChileC Setup Script"
echo "=========================="

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ------------------------------------------------------------
# 1. Verificar prerequisites
# ------------------------------------------------------------
echo -e "\n${YELLOW}[1/5]${NC} Verificando prerequisites..."

# Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js no está instalado${NC}"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ PostgreSQL no está instalado${NC}"
    echo "   Instalar desde: https://www.postgresql.org/download/"
    exit 1
fi
echo "✅ PostgreSQL instalado"

# ------------------------------------------------------------
# 2. Instalar dependencias
# ------------------------------------------------------------
echo -e "\n${YELLOW}[2/5]${NC} Instalando dependencias..."

echo "   → Client (Expo)..."
npm ci --silent 2>/dev/null || npm install --silent

echo "   → Server (Node)..."
cd server && npm ci --silent 2>/dev/null || npm install --silent
cd ..

echo "✅ Dependencias instaladas"

# ------------------------------------------------------------
# 3. Verificar/configurar .env
# ------------------------------------------------------------
echo -e "\n${YELLOW}[3/5]${NC} Verificando configuración..."

if [ ! -f .env ]; then
    echo "   ⚠️  No existe .env, creando desde .env.example..."
    cp .env.example .env
    echo -e "   ${YELLOW}   ⚠️  IMPORTANTE: Editá .env y configurá tu IP local${NC}"
    echo "   Para finding tu IP: ipconfig (Windows) / ip a (Linux/macOS)"
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "   ${YELLOW}   ⚠️  DATABASE_URL no está configurada${NC}"
fi

# ------------------------------------------------------------
# 4. Crear base de datos
# ------------------------------------------------------------
echo -e "\n${YELLOW}[4/5]${NC} Configurando base de datos..."

# Extraer db name de DATABASE_URL
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

# Verificar si la base de datos existe
if psql -lqt -h localhost -U postgres 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "   ✅ Base de datos '$DB_NAME' ya existe"
else
    echo "   → Creando base de datos '$DB_NAME'..."
    createdb -h localhost -U postgres "$DB_NAME" 2>/dev/null || echo "   ⚠️  No se pudo crear automáticamente (necesitás crear manually)"
fi

# ------------------------------------------------------------
# 5. Ejecutar migrations
# ------------------------------------------------------------
echo -e "\n${YELLOW}[5/5]${NC} Ejecutando migrations..."

cd server
if [ -n "$DATABASE_URL" ]; then
    PGPASSWORD=$(echo "$DATABASE_URL" | sed -E 's|.*:([^@]+)@.*|\1|') psql "$DATABASE_URL" -f bootstrap.sql 2>/dev/null && echo "   ✅ bootstrap.sql ejecutado" || echo "   ⚠️  Error ejecutando bootstrap.sql"
    
    if [ -f "migrations/add_rubro_filters.sql" ]; then
        PGPASSWORD=$(echo "$DATABASE_URL" | sed -E 's|.*:([^@]+)@.*|\1|') psql "$DATABASE_URL" -f "migrations/add_rubro_filters.sql" 2>/dev/null && echo "   ✅ add_rubro_filters.sql ejecutado" || echo "   ⚠️  Error ejecutando add_rubro_filters.sql"
    fi
else
    echo "   ⚠️  DATABASE_URL no configurada, saltando migrations"
fi
cd ..

# ------------------------------------------------------------
# Fin
# ------------------------------------------------------------
echo ""
echo "=========================="
echo -e "${GREEN}✅ Setup completado!${NC}"
echo ""
echo "Próximos pasos:"
echo "1. Editá .env con tu IP local (buscá 192.168.0.4)"
echo "2. Ejecutá: npm run dev"
echo ""
echo "Para más info, ver README.md"