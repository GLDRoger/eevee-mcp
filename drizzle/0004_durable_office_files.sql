CREATE TYPE "public"."office_file_medium" AS ENUM('document', 'spreadsheet', 'presentation', 'pdf');
--> statement-breakpoint
CREATE TYPE "public"."office_file_state" AS ENUM('active', 'archived');
--> statement-breakpoint
CREATE TABLE "office_file" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "medium" "office_file_medium" NOT NULL,
  "state" "office_file_state" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "office_file_workspace_id_unique" UNIQUE("workspace_id", "id"),
  CONSTRAINT "office_file_name_length_check" CHECK (char_length("office_file"."name") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "office_file_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "bytes" bytea NOT NULL,
  "size" integer NOT NULL,
  "sha256" text NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "office_file_version_workspace_file_id_unique" UNIQUE("workspace_id", "file_id", "id"),
  CONSTRAINT "office_file_version_number_unique" UNIQUE("workspace_id", "file_id", "version"),
  CONSTRAINT "office_file_version_number_check" CHECK ("office_file_version"."version" > 0),
  CONSTRAINT "office_file_version_size_check" CHECK ("office_file_version"."size" = octet_length("office_file_version"."bytes") and "office_file_version"."size" between 1 and 26214400),
  CONSTRAINT "office_file_version_sha256_check" CHECK ("office_file_version"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "office_file" ADD CONSTRAINT "office_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_file_version" ADD CONSTRAINT "office_file_version_file_tenant_fk" FOREIGN KEY ("workspace_id", "file_id") REFERENCES "public"."office_file"("workspace_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "office_file_workspace_updated_idx" ON "office_file" USING btree ("workspace_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "office_file_version_workspace_file_created_idx" ON "office_file_version" USING btree ("workspace_id", "file_id", "created_at");
