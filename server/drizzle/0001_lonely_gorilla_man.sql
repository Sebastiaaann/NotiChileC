CREATE SCHEMA "archive";
--> statement-breakpoint
CREATE TABLE "archive"."notification_deliveries" (
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
CREATE TABLE "archive"."licitaciones" (
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
