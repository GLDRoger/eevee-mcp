# Architecture

EEVEE separates agent intelligence from durable execution. A browser agent plans and authors work through WebMCP. The EEVEE service validates, stores, evaluates, and runs that work.

## Canonical lifecycle

```text
create applet
  -> create immutable version
  -> evaluate
  -> human review and publish
  -> validate generated-form inputs
  -> create durable run
  -> execute in the medium sandbox
  -> record output and evidence
  -> propose a correction
  -> create another immutable version
```

The applet library and the desk read the same API. There is no fixture store or client-only lifecycle.

## Trust boundaries

- The browser provides a signed anonymous workspace cookie. Every query and foreign key includes that workspace ID.
- API mutations reject cross-origin requests, oversized bodies, unknown fields, and invalid values before they reach the service.
- An applet version is immutable. Publishing changes a deployment pointer; it does not rewrite history.
- A draft review uses placeholder inputs and isolated in-memory state. The publish control stays disabled until that sandbox reports a working runtime.
- Web applets run in a sandboxed iframe. EEVEE injects a restrictive content security policy and a narrow `window.eevee` state bridge. The parent page blocks external frame navigation, and any navigation revokes the bridge. Applet state is capped at 128 keys and 64 KB per key.
- A web run stays `running` until its sandbox reports ready through the matching private channel. EEVEE records a revoked runtime as `failed`; only a `succeeded` run can receive corrections.
- Agents can request review. A person publishes a passing version in the interface after seeing the rendered draft.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/domain` | Schemas, input validation, evaluation, and web runtime compilation. |
| `src/server` | Tenant-scoped applet lifecycle and database access. |
| `src/app/api` | Same-origin HTTP boundary. |
| `src/client/webmcp.ts` | Page-owned WebMCP tool registration. |
| `src/components` | One API-backed library, desk, generated form, preview, and corrections. |
| `drizzle` | PostgreSQL schema history. |

## Adding a medium

A new medium becomes runnable after it supplies four first-class pieces:

1. A discriminated version definition and output type.
2. A deterministic executor with explicit resource limits.
3. A quality suite that produces stored evidence.
4. A rendered review surface and a human publish gate.

The shared applet, version, run, correction, and deployment records stay unchanged.
