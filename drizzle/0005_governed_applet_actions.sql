CREATE TYPE "public"."applet_action_request_state" AS ENUM('pending', 'approved', 'rejected', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "applet_action_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"applet_version_id" uuid NOT NULL,
	"action" jsonb NOT NULL,
	"state" "applet_action_request_state" NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "applet_run_workspace_applet_id_id_unique" ON "applet_run" USING btree ("workspace_id","applet_id","id");--> statement-breakpoint
ALTER TABLE "applet_action_request" ADD CONSTRAINT "applet_action_request_run_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","run_id") REFERENCES "public"."applet_run"("workspace_id","applet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_action_request" ADD CONSTRAINT "applet_action_request_version_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","applet_version_id") REFERENCES "public"."applet_version"("workspace_id","applet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applet_action_request_workspace_id_unique" ON "applet_action_request" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "applet_action_request_run_created_idx" ON "applet_action_request" USING btree ("workspace_id","run_id","created_at");
