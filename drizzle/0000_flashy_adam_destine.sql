CREATE TYPE "public"."applet_medium" AS ENUM('web-app', 'document', 'spreadsheet', 'presentation', 'pdf', 'workflow', 'image', 'video');--> statement-breakpoint
CREATE TYPE "public"."applet_state" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."correction_state" AS ENUM('proposed', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."applet_run_state" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."applet_version_state" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "applet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"medium" "applet_medium" NOT NULL,
	"state" "applet_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applet_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "applet_deployment" (
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applet_deployment_workspace_id_applet_id_pk" PRIMARY KEY("workspace_id","applet_id")
);
--> statement-breakpoint
CREATE TABLE "applet_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"applet_version_id" uuid NOT NULL,
	"state" "applet_run_state" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "applet_run_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "applet_value" (
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applet_value_workspace_id_applet_id_key_pk" PRIMARY KEY("workspace_id","applet_id","key")
);
--> statement-breakpoint
CREATE TABLE "applet_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" "applet_version_state" DEFAULT 'draft' NOT NULL,
	"note" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"definition" jsonb NOT NULL,
	"quality_report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applet_version_workspace_applet_id_unique" UNIQUE("workspace_id","applet_id","id"),
	CONSTRAINT "applet_version_number_unique" UNIQUE("workspace_id","applet_id","version")
);
--> statement-breakpoint
CREATE TABLE "correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"state" "correction_state" DEFAULT 'proposed' NOT NULL,
	"instruction" text NOT NULL,
	"observed_issue" text NOT NULL,
	"desired_outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applet" ADD CONSTRAINT "applet_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_deployment" ADD CONSTRAINT "applet_deployment_applet_tenant_fk" FOREIGN KEY ("workspace_id","applet_id") REFERENCES "public"."applet"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_deployment" ADD CONSTRAINT "applet_deployment_version_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","version_id") REFERENCES "public"."applet_version"("workspace_id","applet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_run" ADD CONSTRAINT "applet_run_version_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","applet_version_id") REFERENCES "public"."applet_version"("workspace_id","applet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_value" ADD CONSTRAINT "applet_value_applet_tenant_fk" FOREIGN KEY ("workspace_id","applet_id") REFERENCES "public"."applet"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_version" ADD CONSTRAINT "applet_version_applet_tenant_fk" FOREIGN KEY ("workspace_id","applet_id") REFERENCES "public"."applet"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_applet_tenant_fk" FOREIGN KEY ("workspace_id","applet_id") REFERENCES "public"."applet"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_run_tenant_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."applet_run"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applet_workspace_updated_idx" ON "applet" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "applet_run_workspace_applet_created_idx" ON "applet_run" USING btree ("workspace_id","applet_id","created_at");--> statement-breakpoint
CREATE INDEX "correction_workspace_applet_created_idx" ON "correction" USING btree ("workspace_id","applet_id","created_at");