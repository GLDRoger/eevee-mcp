ALTER TABLE "applet_deployment" DROP CONSTRAINT "applet_deployment_version_tenant_fk";
--> statement-breakpoint
ALTER TABLE "applet_run" DROP CONSTRAINT "applet_run_version_tenant_fk";
--> statement-breakpoint
ALTER TABLE "correction" DROP CONSTRAINT "correction_run_tenant_fk";
--> statement-breakpoint
ALTER TABLE "applet_deployment" ADD CONSTRAINT "applet_deployment_version_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","version_id") REFERENCES "public"."applet_version"("workspace_id","applet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applet_run" ADD CONSTRAINT "applet_run_version_tenant_fk" FOREIGN KEY ("workspace_id","applet_id","applet_version_id") REFERENCES "public"."applet_version"("workspace_id","applet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_run_tenant_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."applet_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;