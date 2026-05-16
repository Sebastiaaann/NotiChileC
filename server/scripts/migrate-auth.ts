import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:0901@localhost:5432/notichilec";

async function migrate() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log("Creando tabla users...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    `);

    console.log("Tabla users creada correctamente ✅");
  } catch (error) {
    console.error("Error creando tabla users:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
