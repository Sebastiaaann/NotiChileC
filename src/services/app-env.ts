export type AppEnvironment = "development" | "demo" | "production";
export type DemoDataMode = "live" | "hybrid" | "fallback";

function normalizeAppEnv(value: string | undefined): AppEnvironment {
  if (value === "demo") return "demo";
  if (value === "production") return "production";
  return "development";
}

export function getAppEnvironment(): AppEnvironment {
  return normalizeAppEnv(process.env.EXPO_PUBLIC_APP_ENV);
}

export function isDemoApp(): boolean {
  return getAppEnvironment() === "demo";
}

export function getDemoDataMode(): DemoDataMode {
  const value = process.env.EXPO_PUBLIC_DEMO_DATA_MODE;
  if (value === "fallback") return "fallback";
  if (value === "live") return "live";
  return isDemoApp() ? "hybrid" : "live";
}
