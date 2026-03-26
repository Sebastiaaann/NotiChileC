export const colors = {
  // Azul principal (referencia: blue-600)
  primary: "#2563EB",
  primaryLight: "#3B82F6",
  primaryDark: "#1D4ED8",
  primaryBg: "#EFF6FF",     // blue-50

  // Fondos
  background: "#F9FAFB",    // gray-50
  surface: "#FFFFFF",
  surfaceElevated: "#F3F4F6", // gray-100

  // Texto
  textPrimary: "#111827",   // gray-900
  textSecondary: "#6B7280", // gray-500
  textMuted: "#9CA3AF",     // gray-400
  textOnPrimary: "#FFFFFF",

  // Estados
  success: "#059669",       // emerald-600
  successBg: "#ECFDF5",     // emerald-50
  warning: "#D97706",
  warningBg: "#FFF7ED",     // orange-50
  error: "#DC2626",
  errorBg: "#FEF2F2",       // red-50
  info: "#0284C7",

  // Bordes y separadores
  border: "#F3F4F6",        // gray-100
  divider: "#F9FAFB",       // gray-50

  // Sombras
  shadow: "rgba(0, 0, 0, 0.05)",
} as const;

export const tipoColors: Record<string, string> = {
  L1: "#7C3AED",
  LE: "#0891B2",
  LP: "#059669",
  LQ: "#D97706",
  LR: "#DC2626",
  E2: "#6366F1",
  LS: "#0D9488",
  CO: "#8B5CF6",
  CM: "#EA580C",
};

export const tipoLabels: Record<string, string> = {
  L1: "Trato Directo",
  LE: "Licitación Privada",
  LP: "Licitación Pública",
  LQ: "Gran Compra",
  LR: "Licitación Regional",
  E2: "Compra Ágil",
  LS: "Licit. Servicios",
  CO: "Convenio Marco",
  CM: "Convenio Marco",
};
