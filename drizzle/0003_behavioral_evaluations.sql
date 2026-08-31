CREATE TYPE "public"."evaluation_run_state" AS ENUM('running', 'passed', 'failed');
--> statement-breakpoint
CREATE TABLE "evaluation_suite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "applet_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "name" text NOT NULL,
  "cases" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_suite_workspace_applet_id_unique" UNIQUE("workspace_id", "applet_id", "id"),
  CONSTRAINT "evaluation_suite_revision_unique" UNIQUE("workspace_id", "applet_id", "revision")
);
--> statement-breakpoint
CREATE TABLE "evaluation_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "applet_id" uuid NOT NULL,
  "candidate_version_id" uuid NOT NULL,
  "baseline_version_id" uuid,
  "suite_id" uuid NOT NULL,
  "state" "evaluation_run_state" DEFAULT 'running' NOT NULL,
  "report" jsonb,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "evaluation_run_workspace_id_unique" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
ALTER TABLE "evaluation_suite" ADD CONSTRAINT "evaluation_suite_applet_tenant_fk" FOREIGN KEY ("workspace_id", "applet_id") REFERENCES "public"."applet"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_applet_tenant_fk" FOREIGN KEY ("workspace_id", "applet_id") REFERENCES "public"."applet"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_suite_tenant_fk" FOREIGN KEY ("workspace_id", "applet_id", "suite_id") REFERENCES "public"."evaluation_suite"("workspace_id", "applet_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_candidate_tenant_fk" FOREIGN KEY ("workspace_id", "applet_id", "candidate_version_id") REFERENCES "public"."applet_version"("workspace_id", "applet_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_baseline_tenant_fk" FOREIGN KEY ("workspace_id", "applet_id", "baseline_version_id") REFERENCES "public"."applet_version"("workspace_id", "applet_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "evaluation_run_workspace_applet_created_idx" ON "evaluation_run" USING btree ("workspace_id", "applet_id", "created_at");
