# Architecture

EEVEE separates the agent from the record. A browser agent plans and authors through WebMCP tools registered by the page. The EEVEE service validates, stores, compiles, evaluates, and runs what the agent sends. EEVEE contains no model, chat, or prompt code.

## Lifecycle

```text
create applet (web-app or video)
  -> submit source; compile once; store the version and its artifact
  -> create a behavioral suite
  -> evaluate: run every scenario against the candidate and the published version
  -> store step evidence, verdicts, and regressions
  -> agent requests review; person publishes with a passkey
  -> validate run inputs; create a run; render the preview
  -> register the version's actions as applet_* WebMCP tools
  -> reads execute at once; writes become decisions
  -> rehearse each decision; person approves, rejects with a reason, or grants a lease
  -> execute the approved action in the preview; record the result
  -> person records a correction; agent builds the next version
```

The Applet ledger, the Library, Studio, and the Guide read the same API the tools use. There is no fixture store and no client-only path.

## Trust boundaries

These describe the code as it stands on 2 September 2026.

**Workspace.** The browser holds a signed anonymous cookie (`src/server/session.ts`). Every query and foreign key includes the workspace id. Production refuses to start without `EEVEE_SESSION_SECRET` of at least 32 characters (`src/server/db/migrate.ts` runs first and checks it), and `/api/health` reports 503 if it is ever missing at runtime.

**API boundary.** Mutations reject cross-origin requests, oversized bodies, unknown fields, and invalid values before reaching the service (`src/server/http.ts`). The page validates tool input with the same Zod schemas first, so an agent sees field-level errors without a round trip.

**Versions.** A version stores the submitted source and the compiled artifact separately and never recompiles either. Compilation runs esbuild in memory with an allow-list: React and relative paths under `src/`. Package, URL, dynamic, and path-traversing imports fail compilation. Applet code never runs on the server.

**Preview sandbox.** Applets render in an iframe with `sandbox="allow-scripts allow-forms"` and an injected content security policy that blocks network, frames, and navigation (`src/domain/applet-runtime.ts`). The only way out is `window.eevee`: inputs, `store` (128 keys, 64 KB per value), read-only `files`, and `actions.register`. Navigation revokes the bridge and fails the run.

**Evaluation.** Scenarios are declarative steps, not JavaScript. A browser worker runs each scenario with isolated in-memory state, keeps that state across `restart` steps, and records every step. The candidate and the published version run the same suite; publishing requires a passing evaluation bound to the current published version, so evidence goes stale when the baseline changes. Evaluation runs hold a ten-minute lease and a per-applet concurrency cap.

**Publishing.** The publish control stays disabled until the draft preview reports a working runtime. The publish route refuses any request that did not come through a passkey challenge (`human_authority_required`).

**Actions.** A version declares up to 32 actions with effects (`state:read`, `state:write`, `files:list`, `files:read`) and authority. The schema rejects a `state:write` action without `human` authority. The preview registers only the open published run's actions, validates inputs at the server, serializes execution, caps results at 64 KB, and stores each request's state. `run_applet` fails the open requests of earlier runs of the same applet, because only the newest run is on screen.

**Write gate.** Two checks protect durable state, the PostgreSQL rows behind a run. First, every storage or file call an action makes carries its invocation tag, and the page verifies the tag against that action's declared effects before forwarding it; the rehearsal applies the same rule. Second, once an agent action has run in a frame, any untagged durable write is refused unless the browser's user-activation flag is set. A real click or keypress inside the applet iframe activates the parent document, and the applet cannot forge that flag, so the person's own use of the interface still works while a deferred write from an action handler does not.

**Passkeys.** Publishing, action approvals and rejections, DOCX redaction, and leases go through `src/server/human-authority.ts`. Each challenge lives five minutes, is workspace-bound, is scoped to one exact operation, requires user verification, and is deleted on use. A lease is a server row scoped to one run with a write count and expiry; spends decrement under an advisory lock and re-check revocation and expiry in the same statement.

**Library and Studio.** Office files share the workspace boundary and version register. Raw replacements re-run native-format validation. XLSX edits from Studio and from `edit_spreadsheet` pass through one server gateway that verifies every changed archive entry (`src/server/spreadsheet-edits.ts`). The sensitive-text scan returns masked findings and stable ids; redaction recomputes against the selected version, rejects stale ids, rewrites the Office XML, revalidates, and saves a new version after the passkey check. This is response minimization, not a claim that the agent cannot read content the person opens elsewhere.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/app` | Next.js app shell, global styles, and the same-origin API routes under `src/app/api`. `/` is the landing page; `/workbench` is the workbench. |
| `src/components/landing.tsx` | The marketing landing page: the loop, the three prompts, the bench, the tool list, and setup. Registers one WebMCP tool, `open_workbench`. |
| `src/app/api/human-gates.test.ts` | Proves publish, decision, and redaction routes refuse requests without a passkey challenge. |
| `src/client/webmcp.ts` | The 28 static WebMCP tools, Chrome 152 normalization, and the `navigator.modelContext` fallback. |
| `src/client/rehearsal.ts` | Shadow-iframe dry run of one waiting decision against current state. |
| `src/client/rehearsal-diff.ts` | Field-level before/after summary shown on a decision card. |
| `src/client/workbench-state.ts` | The state the workbench publishes and `get_workbench_state` reads. |
| `src/client/evaluation-worker.ts` | Runs behavioral suites in the browser and reports step evidence. |
| `src/client/human-authority.ts` | Browser side of passkey registration and authorization. |
| `src/client/mission-plan.ts` | The shared plan behind `share_plan` and `update_plan_step`. |
| `src/components/workbench.tsx` | Surfaces, header, Decisions chip, and which home or inspector the bench shows. |
| `src/components/workbench-home.tsx` | The Applets, Guide, Library, and Studio homes: how to navigate, plus paste-ready prompts. |
| `src/domain/starter-prompts.ts` | The six starter prompts and the Meridian acts, shared by the landing page and the homes. |
| `src/components/applet-preview.tsx` | Preview iframe, bridge, write gate, dynamic `applet_*` tools, decision cards, leases. |
| `src/components/applet-inspector.tsx` | Versions, evidence, review, and the publish control. |
| `src/components/applet-ledger.tsx` | The Applet ledger. |
| `src/components/decisions.tsx` | The queue of decisions waiting on the person. |
| `src/domain` | Zod schemas and limits: applets, actions, evaluation, inputs, state, leases, video projects. |
| `src/domain/applet-runtime.ts` | HTML wrapper, content security policy, and `window.eevee` bridge injected into every artifact. |
| `src/server/applets.ts` | Applet, version, publish, and correction lifecycle. |
| `src/server/applet-runs.ts` | Runs, run state, and superseding open requests. |
| `src/server/applet-actions.ts` | Action requests, decisions, lease spends, execution states. |
| `src/server/human-authority.ts` | Passkey registration, scoped challenges, and lease issuance. |
| `src/server/evaluations.ts` | Evaluation runs, leases, concurrency, and evidence storage. |
| `src/server/react-compiler.ts` | In-memory esbuild compilation with the import allow-list. |
| `src/server/session.ts` | Signed workspace cookie. |
| `src/server/office-files.ts` | Library files and versions. |
| `src/server/spreadsheet-edits.ts` | XLSX edit gateway and archive verification. |
| `src/server/document-review.ts` | Masked DOCX scan and native-text redaction. |
| `src/server/db` | Drizzle client, schema, and migration runner. |
| `src/office/registry.ts` | The editor contract Studio uses to mount a Documents, Sheets, Slides, or PDF editor. |
| `src/office/host` | Browser host services the ported editors call: Library storage, pickers, print, download, external URLs. |
| `src/office/docs`, `sheets`, `slides`, `pdf` | Ported editors. |
| `src/office/engines` | Ported DOCX and PPTX engines and renderers. |
| `src/reference-applets/meridian` | Meridian Ops source, actions, suite, and tests. |
| `src/types/webmcp.d.ts` | WebMCP and `window.eevee` type declarations. |
| `src/test` | Test-only shims. |
| `scripts/webmcp-e2e.mjs` | Headless Chrome check of the live WebMCP surface. |
| `drizzle` | PostgreSQL migrations. |
| `public` | Fonts, PDF.js runtime assets, icon. |
| `docs` | This documentation. |

## Adding a medium

`src/domain/applet.ts` lists every medium (`web-app`, `document`, `spreadsheet`, `presentation`, `pdf`, `workflow`, `image`, `video`) and a shorter list of media an agent can create today (`web-app`, `video`). A medium moves to the creatable list when it has:

1. a version definition and run output type in the discriminated unions;
2. a deterministic executor with explicit resource limits;
3. a behavioral suite path that stores evidence;
4. a preview and a passkey-verified publish gate.

Applets, versions, suites, evaluations, runs, decisions, and corrections stay shared across media.
