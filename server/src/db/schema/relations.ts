import { relations } from "drizzle-orm";
import { deviceInstallations } from "./device-installations";
import { notificationPreferences } from "./notification-preferences";
import { notificationEvents } from "./notification-events";
import { notificationDeliveries } from "./notification-deliveries";
import { licitaciones } from "./licitaciones";

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  deviceInstallation: one(deviceInstallations, {
    fields: [notificationPreferences.installation_id],
    references: [deviceInstallations.installation_id],
  }),
}));

export const notificationDeliveriesRelations = relations(notificationDeliveries, ({ one }) => ({
  notificationEvent: one(notificationEvents, {
    fields: [notificationDeliveries.notification_event_id],
    references: [notificationEvents.id],
  }),
  deviceInstallation: one(deviceInstallations, {
    fields: [notificationDeliveries.installation_id],
    references: [deviceInstallations.installation_id],
  }),
}));

export const notificationEventsRelations = relations(notificationEvents, ({ one }) => ({
  licitacion: one(licitaciones, {
    fields: [notificationEvents.licitacion_id],
    references: [licitaciones.id],
  }),
}));
