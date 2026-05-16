CREATE TABLE "archive_exports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"partition_month" text NOT NULL,
	"object_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"min_created_at" timestamp with time zone,
	"max_created_at" timestamp with time zone,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"exported_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"drop_eligible_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_exports_entity_partition_month_unique" UNIQUE("entity","partition_month")
);
--> statement-breakpoint
CREATE TABLE "device_installations" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"push_token" text,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"app_version" text DEFAULT 'unknown' NOT NULL,
	"push_capable" boolean DEFAULT false NOT NULL,
	"permission_status" text DEFAULT 'undetermined' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalid_reason" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_installations_push_token_unique" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"expo_push_token" text NOT NULL,
	"installation_id" text,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_expo_push_token_unique" UNIQUE("expo_push_token")
);
--> statement-breakpoint
CREATE TABLE "licitacion_registry" (
	"codigo_externo" text PRIMARY KEY NOT NULL,
	"licitacion_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licitaciones" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo_externo" text NOT NULL,
	"nombre" text NOT NULL,
	"organismo_nombre" text,
	"tipo" text,
	"monto_estimado" numeric(14, 0),
	"monto_label" text,
	"moneda" text DEFAULT 'CLP' NOT NULL,
	"fecha_publicacion" timestamp with time zone,
	"fecha_cierre" timestamp with time zone,
	"estado" text DEFAULT 'Publicada' NOT NULL,
	"url" text,
	"region" text,
	"categoria" text DEFAULT 'General' NOT NULL,
	"rubro_code" text,
	"source_rank" integer,
	"notificada" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_event_id" bigint NOT NULL,
	"installation_id" text NOT NULL,
	"provider" text DEFAULT 'expo' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"provider_ticket_id" text,
	"provider_receipt_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_event_id_installation_id_unique" UNIQUE("notification_event_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"licitacion_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_events_type_licitacion_id_unique" UNIQUE("type","licitacion_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rubro" text,
	"tipo" text,
	"region" text,
	"monto_min" numeric(14, 0),
	"monto_max" numeric(14, 0),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubros_chilecompra" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_code" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"verification_token" text,
	"verification_token_expires_at" timestamp with time zone,
	"reset_token" text,
	"reset_token_expires_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_name" text DEFAULT 'sync' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"licitaciones_found" integer DEFAULT 0 NOT NULL,
	"licitaciones_new" integer DEFAULT 0 NOT NULL,
	"notifications_sent" integer DEFAULT 0 NOT NULL,
	"notifications_retryable" integer DEFAULT 0 NOT NULL,
	"notifications_failed" integer DEFAULT 0 NOT NULL,
	"notifications_invalidated" integer DEFAULT 0 NOT NULL,
	"targets_selected" integer DEFAULT 0 NOT NULL,
	"deliveries_created" integer DEFAULT 0 NOT NULL,
	"receipts_processed" integer DEFAULT 0 NOT NULL,
	"archived_licitaciones" integer DEFAULT 0 NOT NULL,
	"archived_deliveries" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_event_id_notification_events_id_fk" FOREIGN KEY ("notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_installation_id_device_installations_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."device_installations"("installation_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_installation_id_device_installations_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."device_installations"("installation_id") ON DELETE cascade ON UPDATE cascade;