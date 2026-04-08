import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { afterAll, describe, expect, it } from "vitest";
import { startApiProcess } from "../src/api";
import { closePool } from "../src/db";

const repoRoot = resolve(__dirname, "..", "..");
const serverRoot = resolve(repoRoot, "server");
const frontendEnvPath = resolve(repoRoot, ".env");
const serverEnvPath = resolve(serverRoot, ".env");
const setupBatPath = resolve(repoRoot, "scripts", "setup.bat");
const serverPackagePath = resolve(serverRoot, "package.json");

function readEnv(path: string) {
  return parse(readFileSync(path, "utf8"));
}

describe.sequential("local bootstrap smoke", () => {
  let server: Server | null = null;

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server?.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }

          resolveClose();
        });
      });
    }

    await closePool();
  });

  it("alinea EXPO_PUBLIC_API_URL con el puerto real del backend local", () => {
    const frontendEnv = readEnv(frontendEnvPath);
    const backendEnv = readEnv(serverEnvPath);
    const apiUrl = frontendEnv.EXPO_PUBLIC_API_URL;

    expect(apiUrl).toBeTruthy();
    expect(apiUrl).not.toContain("loca.lt");

    const parsedUrl = new URL(apiUrl);
    expect(parsedUrl.hostname).toBe("192.168.0.11");
    expect(parsedUrl.port).toBe(backendEnv.PORT);
    expect(backendEnv.PORT).toBe("3001");
  });

  it("define las variables mínimas de backend para PostgreSQL local y ticket real", () => {
    const backendEnv = readEnv(serverEnvPath);

    expect(backendEnv.DATABASE_URL).toBe(
      "postgresql://postgres:0901@localhost:5432/notichilec"
    );
    expect(backendEnv.DATABASE_POOL_URL).toBe(backendEnv.DATABASE_URL);
    expect(backendEnv.DATABASE_DIRECT_URL).toBe(backendEnv.DATABASE_URL);
    expect(backendEnv.CHILECOMPRA_TICKET).toBe(
      "344CA167-7B67-4644-8348-83B5B10A1719"
    );
    expect(backendEnv.CHILECOMPRA_TICKET).not.toBe("tu-ticket-aqui");
  });

  it(
    "usa PostgreSQL 17 absoluto y ejecuta el bootstrap reproducible sin depender del PATH",
    { timeout: 60_000 },
    () => {
      const setupBat = readFileSync(setupBatPath, "utf8");
      const serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf8")) as {
        scripts?: Record<string, string>;
      };

      expect(setupBat).toContain("C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe");
      expect(serverPackage.scripts?.["db:bootstrap"]).toContain(
        "C:/Program Files/PostgreSQL/17/bin/psql.exe"
      );

      const result = spawnSync(
        process.platform === "win32" ? "cmd.exe" : "npm",
        process.platform === "win32"
          ? ["/c", "npm run db:bootstrap"]
          : ["run", "db:bootstrap"],
        {
        cwd: serverRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ...readEnv(serverEnvPath),
        },
        }
      );

      expect(result.status, result.stdout + result.stderr).toBe(0);
    }
  );

  it(
    "responde readiness contra la base bootstrappeada real",
    { timeout: 30_000 },
    async () => {
      server = startApiProcess();
      const response = await fetch("http://127.0.0.1:3001/api/health/ready");
      const payload = (await response.json()) as {
        status: string;
        db: { ok: boolean; reason: string | null };
      };

      expect(response.status).toBe(200);
      expect(payload.status).toBe("ok");
      expect(payload.db.ok).toBe(true);
      expect(payload.db.reason).toBeNull();
    }
  );
});
