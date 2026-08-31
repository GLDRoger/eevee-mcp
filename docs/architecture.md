# Architecture

EEVEE separates agent intelligence from durable execution. A browser agent plans and authors work through WebMCP. The EEVEE service validates, stores, evaluates, and runs that work.

EEVEE does not embed a model, chatbot, prompt router, or generation service. Codex and browser agents remain the intelligence layer.

## Canonical lifecycle

```text
create applet
  -> submit typed source
  -> compile and store one immutable version and artifact
  -> create an immutable behavioral suite
  -> execute candidate and published baseline in isolated browser runtimes
  -> store required, informational, and regression evidence
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
- A web version stores the submitted React source and the exact compiled artifact separately. Preview and run use that stored artifact; neither path recompiles it.
- React compilation uses an in-memory source map. Applet files never touch the server filesystem, and the compiler never executes applet code on the server. User source may import React and relative files under `src/`; package, URL, dynamic, metadata, and path-traversing imports fail compilation.
- A draft review uses placeholder inputs and isolated in-memory state. The publish control stays disabled until that sandbox reports a working runtime.
- Behavioral suites contain bounded declarative steps, not arbitrary JavaScript. The browser worker executes each case with isolated in-memory storage, preserves that storage across explicit restarts, and records every step result.
- A candidate and the currently published version run the same suite. Publication requires a passing candidate evaluation bound to the current deployment, so evidence becomes stale when the published baseline changes.
- Evaluation runs have ten-minute leases and per-applet concurrency limits. Expired browser work is failed before new work starts.
- Web applets run in a sandboxed iframe. EEVEE injects a restrictive content security policy and a narrow `window.eevee` state bridge. The parent page blocks external frame navigation, and any navigation revokes the bridge. Applet state is capped at 128 keys and 64 KB per key.
- A web run stays `running` until the mounted React tree reports ready through the matching private channel. EEVEE records a revoked runtime as `failed`; only a `succeeded` run can receive corrections.
- Agents can request review. A person publishes a passing version in the interface after seeing the rendered draft.
- Office files use the same workspace boundary and immutable version register. Raw replacement tools re-run native-format validation. XLSX cell, formula, style, structure, page-layout, chart, table, pivot, and drawing edits pass through one server-side gateway that declares and verifies every changed archive entry.
- The Documents, Sheets, Slides, and PDF editors contain no model or chat path. Their browser hosts read and save through the Library API.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/domain` | Schemas, input validation, evaluation, and isolated runtime injection. |
| `src/server` | Tenant-scoped lifecycle, React compilation, and database access. |
| `src/app/api` | Same-origin HTTP boundary. |
| `src/client/webmcp.ts` | Page-owned WebMCP tool registration. |
| `src/client/evaluation-worker.ts` | Isolated browser scenario execution and step evidence. |
| `src/components` | One API-backed library, desk, generated form, preview, evidence, and corrections. |
| `src/office` | Native Office engines, ported ribbon editors, and browser host contracts. |
| `src/server/spreadsheet-edits.ts` | Tenant-scoped full XLSX mutation planning and archive verification. |
| `drizzle` | PostgreSQL schema history. |

## Adding a medium

A new medium becomes runnable after it supplies four first-class pieces:

1. A discriminated version definition and output type.
2. A deterministic executor with explicit resource limits.
3. A quality suite that produces stored evidence.
4. A rendered review surface and a human publish gate.

The applet, version, evaluation suite, evaluation run, execution run, correction, and deployment records remain shared across media.
