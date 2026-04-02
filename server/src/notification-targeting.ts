export interface NotificationPreferenceSnapshot {
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
}

export interface NewLicitacionNotificationContext {
  id: string;
  codigo_externo: string;
  nombre: string;
  monto_estimado: number | null;
  monto_label: string | null;
  moneda: string;
  tipo: string | null;
  region: string | null;
  rubro_code: string | null;
}

export interface NewLicitacionNotificationPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function formatCurrency(
  amount: number,
  currency: string = "CLP"
): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function matchesNotificationPreferences(
  licitacion: NewLicitacionNotificationContext,
  preferences: NotificationPreferenceSnapshot
): boolean {
  if (!preferences.enabled) return false;

  if (preferences.rubro && preferences.rubro !== licitacion.rubro_code) {
    return false;
  }

  if (preferences.tipo && preferences.tipo !== licitacion.tipo) {
    return false;
  }

  if (preferences.region && preferences.region !== licitacion.region) {
    return false;
  }

  if (preferences.montoMin !== null) {
    if (
      licitacion.monto_estimado === null ||
      licitacion.monto_estimado < preferences.montoMin
    ) {
      return false;
    }
  }

  if (preferences.montoMax !== null) {
    if (
      licitacion.monto_estimado === null ||
      licitacion.monto_estimado > preferences.montoMax
    ) {
      return false;
    }
  }

  return true;
}

export function buildNewLicitacionNotificationPayload(
  licitacion: NewLicitacionNotificationContext,
  notificationEventId?: number
): NewLicitacionNotificationPayload {
  const monetaryText = licitacion.monto_label
    ? licitacion.monto_label
    : licitacion.monto_estimado !== null
      ? formatCurrency(licitacion.monto_estimado, licitacion.moneda || "CLP")
      : "";

  return {
    title: "📋 Nueva Licitación",
    body: `${licitacion.nombre}${monetaryText ? ` — ${monetaryText}` : ""}`,
    data: {
      licitacionId: licitacion.id,
      codigo: licitacion.codigo_externo,
      type: "new_licitacion",
      notificationEventId: notificationEventId ?? null,
    },
  };
}
