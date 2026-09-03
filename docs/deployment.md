# Deployment

EEVEE needs one Node 24 web service, PostgreSQL 17, HTTPS, and three environment variables:

- `DATABASE_URL`: the PostgreSQL connection string. Managed providers that require TLS need `?sslmode=require` on the URL.
- `EEVEE_SESSION_SECRET`: at least 32 random characters. Keep it stable across deployments or existing workspace cookies become invalid. `/api/health` reports 503 when it is missing or short, so a platform health check catches a bad deploy before a judge does.
- `EEVEE_DEMO_VIDEO_URL` and `EEVEE_REPO_URL` (optional): override the landing page's **Watch demo** and **GitHub** links, which default to `https://www.youtube.com/watch?v=AviwsWmeq7E` and `https://github.com/GLDRoger/eevee-mcp`.
- `EEVEE_PUBLIC_ORIGIN`: the exact origin browsers use, for example `https://eevee.example.com`. Same-origin checks compare against it and passkeys bind to its hostname. Without it, EEVEE reads `X-Forwarded-Proto`, `X-Forwarded-Host`, then `Host`; `next start` alone reports `http://localhost:3000` for every request, which breaks both on a real hostname.

HTTPS is required. Passkeys bind to the hostname the browser sees, so a passkey created on `localhost` does not work on the deployed host, and a passkey created on one deployed hostname does not work on another.

On Vercel, connect a PostgreSQL integration as `DATABASE_URL`. The `build` script applies pending migrations before `next build`, so a deployment cannot go live against an outdated schema. Keep production deploys serialized; concurrent builds should not race schema changes.

## Docker image

The `Dockerfile` builds the app, prunes dev dependencies, applies migrations on start, and runs Next.js on `PORT` (default 3000). It exposes `/api/health` for the container health check.

```bash
docker build -t eevee-mcp .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://user:password@host:5432/eevee_mcp' \
  -e EEVEE_SESSION_SECRET='replace-with-a-stable-random-secret' \
  eevee-mcp
```

Run one web replica. Migration on start is safe for a single replica during the challenge. A multi-replica service should move `npm run db:migrate` into one release job.

## Release proof

Do this on the exact commit you will submit, in this order.

1. `npm run verify` against a disposable PostgreSQL database with `DATABASE_URL` set. This runs lint, typecheck, all tests including the integration suite, and the production build.
2. Deploy with the three variables set. Confirm `/api/health` returns `{"ok":true}`; the container log prints `Database migrations are current` after applying `drizzle/0006_human_authority.sql` (the `drizzle.__drizzle_migrations` table stores hashes, not file names, so count seven rows).
3. `npm run test:webmcp -- --url https://<host>/` from a machine with Chrome installed. The script takes `--url` and optional `--chrome <path>`; it also reads `EEVEE_URL` and `CHROME_PATH`. It must report `all WebMCP checks passed` with 28 tools, four passing Meridian scenarios, and the passkey, publish, run, approval, lease, and rejection checks. Each run installs and publishes Meridian in a fresh workspace on the target with a virtual authenticator, so it also confirms the deployed hostname works as a WebAuthn relying party.
4. Open `https://<host>` in ChatGPT's in-app browser, or in Chrome 149 or later with `chrome://flags/#enable-webmcp-testing` enabled.
5. Click **Set up passkey** on that hostname. This is the passkey the judges' flow depends on; a local one does not transfer.
6. Paste the three Guide prompts in order. Confirm: Meridian Ops installs and evaluates; **Approve & publish** asks for the passkey; the run opens and `applet_*` tools appear; one read runs at once; one write shows a rehearsal and waits; approving it with the passkey returns the result to the agent; rejecting one with a reason returns that reason; a 3-write lease lets the next writes run and the chip counts down.
7. `curl -X POST https://<host>/api/applets/<appletId>/versions/<versionId>/publish -H 'origin: https://<host>' -H 'sec-fetch-site: same-origin' -H 'content-type: application/json' -d '{}'` must return 403 with `human_authority_required`.
8. Check the workbench at desktop width and at 390 px.
9. Record the demo against this deployed commit; the live and video links in `README.md` and the landing defaults must match what you ship.
