CREATE TYPE "public"."human_authority_challenge_kind" AS ENUM('registration', 'authorization');--> statement-breakpoint
CREATE TABLE "human_authority_credential" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" bytea NOT NULL,
	"counter" bigint NOT NULL,
	"transports" jsonb NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_authority_credential_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "human_authority_counter_check" CHECK ("human_authority_credential"."counter" >= 0)
);--> statement-breakpoint
CREATE TABLE "human_authority_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "human_authority_challenge_kind" NOT NULL,
	"challenge" text NOT NULL,
	"scope" jsonb,
	"rp_id" text NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_authority_challenge_length_check" CHECK (char_length("human_authority_challenge"."challenge") between 16 and 512)
);--> statement-breakpoint
CREATE TABLE "human_authority_lease" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applet_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"granted_writes" integer NOT NULL,
	"remaining_writes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_authority_lease_write_count_check" CHECK ("human_authority_lease"."granted_writes" between 1 and 20 and "human_authority_lease"."remaining_writes" between 0 and "human_authority_lease"."granted_writes")
);--> statement-breakpoint
ALTER TABLE "human_authority_credential" ADD CONSTRAINT "human_authority_credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_authority_challenge" ADD CONSTRAINT "human_authority_challenge_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_authority_lease" ADD CONSTRAINT "human_authority_lease_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_authority_lease" ADD CONSTRAINT "human_authority_lease_run_tenant_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."applet_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_authority_challenge_workspace_created_idx" ON "human_authority_challenge" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "human_authority_lease_workspace_run_idx" ON "human_authority_lease" USING btree ("workspace_id","run_id","expires_at");
