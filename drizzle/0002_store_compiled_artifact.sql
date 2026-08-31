DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "applet_version"
    WHERE "definition"->>'kind' IS DISTINCT FROM 'react-app'
  ) THEN
    RAISE EXCEPTION 'The React cutover requires a fresh database; legacy HTML versions are not executable';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "applet_version" ADD COLUMN "artifact" jsonb;
