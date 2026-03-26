-- Migration: Agregar filtros por rubro/categoría
-- Fecha: 2026-03-26

-- 1. Tabla de rubros/CPV codes
CREATE TABLE IF NOT EXISTS rubros_chilecompra (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  parent_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_rubros_parent ON rubros_chilecompra(parent_code);
CREATE INDEX IF NOT EXISTS idx_rubros_code ON rubros_chilecompra(code);

-- 3. Columna rubro_code en licitaciones
ALTER TABLE licitaciones ADD COLUMN IF NOT EXISTS rubro_code VARCHAR(20);

-- 4. Índice para filtrar licitaciones por rubro
CREATE INDEX IF NOT EXISTS idx_licitaciones_rubro ON licitaciones(rubro_code);

-- 5. Insertar rubros principales de CPV para construcción
-- CPV División 45: Trabajos de construcción
INSERT INTO rubros_chilecompra (code, name, parent_code) VALUES
  ('45000000', 'Trabajos de construcción', NULL),
  ('45100000', 'Preparación del terreno', '45000000'),
  ('45110000', 'Excavación y movimiento de tierras', '45100000'),
  ('45111000', 'Trabajos de demolición', '45100000'),
  ('45112000', 'Perforación y sondeos', '45100000'),
  ('45200000', 'Obras civiles', '45000000'),
  ('45210000', 'Obras hidráulicas', '45200000'),
  ('45220000', 'Obras de carreteras', '45200000'),
  ('45221000', 'Construcción de carreteras', '45220000'),
  ('45222000', 'Construcción de puentes', '45220000'),
  ('45230000', 'Construcción de tuberías', '45200000'),
  ('45240000', 'Construcción de presas', '45200000'),
  ('45250000', 'Obras marítimas', '45200000'),
  ('45300000', 'Instalaciones', '45000000'),
  ('45310000', 'Instalaciones eléctricas', '45300000'),
  ('45320000', 'Instalaciones de fontanería', '45300000'),
  ('45330000', 'Instalaciones de calefacción', '45300000'),
  ('45340000', 'Instalaciones de ventilación', '45300000'),
  ('45400000', 'Acabados de edificios', '45000000'),
  ('45410000', 'Trabajos de carpintería', '45400000'),
  ('45420000', 'Trabajos de cerrajería', '45400000'),
  ('45430000', 'Trabajos de pintura', '45400000'),
  ('45440000', 'Trabajos de revestimiento', '45400000'),
  ('45450000', 'Trabajos de aislamiento', '45400000'),
  ('45500000', 'Instalación de equipos', '45000000'),
  ('45600000', 'Instalación de equipos de climatización', '45000000'),
  ('45700000', 'Instalación de equipos de seguridad', '45000000'),
  ('45800000', 'Trabajos de instalación en edificios', '45000000'),
  ('45900000', 'Trabajos diversos de construcción', '45000000')
ON CONFLICT (code) DO NOTHING;

-- 6. Otros rubros comunes en ChileCompra
INSERT INTO rubros_chilecompra (code, name, parent_code) VALUES
  ('70000000', 'Servicios inmobiliarios', NULL),
  ('71000000', 'Servicios de arquitectura', NULL),
  ('72000000', 'Servicios de ingeniería', NULL),
  ('73000000', 'Servicios científicos y técnicos', NULL),
  ('79000000', 'Servicios empresariales', NULL),
  ('80000000', 'Servicios de salud', NULL),
  ('85000000', 'Servicios educativos', NULL),
  ('90000000', 'Servicios de eliminación de residuos', NULL),
  ('92000000', 'Servicios recreativos y culturales', NULL),
  ('98000000', 'Otros servicios', NULL)
ON CONFLICT (code) DO NOTHING;

-- 7. Verificar estructura
SELECT 
  'rubros_chilecompra' as tabla,
  COUNT(*) as total_rubros 
FROM rubros_chilecompra
UNION ALL
SELECT 
  'licitaciones con rubro' as tabla,
  COUNT(*) as total_con_rubro 
FROM licitaciones 
WHERE rubro_code IS NOT NULL;
