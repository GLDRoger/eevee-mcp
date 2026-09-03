# EEVEE MCP

<!-- Fill in the two placeholders below before submitting: <LIVE_URL> is the deployed HTTPS workbench, <DEMO_VIDEO_URL> is the public demo recording. -->

Live workbench: `<LIVE_URL>`. Demo video: `<DEMO_VIDEO_URL>`.

## The problem

You run the same office work every week: reconcile an export, chase overdue invoices, move an order from allocated to shipped, redact a contract before it goes out. An agent could build you a small tool for each of these. The trouble is trust. You do not want to read every line the agent wrote, and you do not want it changing your records while you are not looking. You want the agent to build the tool, prove it works, hand you one key that ships it, and then ask before every change that matters.

## What EEVEE does

EEVEE gives a browser agent real authority over small business apps in graded steps, and keeps the last step in your hands. The agent builds a small React app (an applet), proves it against a behavioral suite in the browser, and asks you to publish it; your passkey is the only thing that publishes. Once published, the applet's own actions register as WebMCP tools. Reads run at once. Every write the applet performs is rehearsed against current data first, so the decision card shows the exact fields that will change, and it waits for your passkey, or runs under a short lease you granted with it. The workbench has no model or chat of its own; any WebMCP-capable agent discovers the 28 tools on the page and the applet tools that appear when a run opens.

## Try it with an agent in 60 seconds

Open the workbench in a WebMCP-capable browser (ChatGPT's in-app browser, or Chrome 149 or later with `chrome://flags/#enable-webmcp-testing` enabled). Click **Set up passkey** in the header. Then paste these three prompts, in order, from the Guide tab.

In ChatGPT, site tools need GPT-5.6 Sol or Terra (Luna has WebMCP off). Without any agent, the same loop works by hand: **Install as draft** in the Applet ledger, **Evaluate**, **Review & publish**, **Run**, then **Send a request the way an agent would** in the Actions ledger to see a rehearsed decision wait for your passkey.

**1. Prove**

```text
Install the Meridian Ops reference applet in EEVEE, evaluate it against its behavioral suite, and bring the passing version to me for review.
```

You should see: a plan appear on the workbench, Meridian Ops appear in the Applet ledger as a draft, four scenarios run in the browser with step-by-step evidence, and the review panel open on version 1 with its source, verdicts, and a preview.

**2. Approve**

Click **Approve & publish**. Your browser asks for your fingerprint, face, device PIN, or security key. Then paste:

```text
After I publish Meridian Ops, run it with company_name set to "Meridian Ops". Share a three-step plan, inspect the company snapshot, and report the low-stock shortfall before proposing any write.
```

You should see: a run open with the ERP rendered in the preview, the agent's plan update step by step, and 32 new `applet_*` tools appear in the agent's tool list. The agent reads `applet_company_snapshot` and `applet_low_stock_report` without asking you.

**3. Govern**

```text
Run the published Meridian Ops applet for "Meridian Ops". Share your plan first. Then work the ERP through its applet tools: check the company snapshot and low-stock report, receive stock where there are shortfalls, take sales order SO-1000 through allocate, ship, deliver, issue its invoice, and record full payment. Every write pauses for my approval. Tell me each time and wait, or ask me for an autonomy lease.
```

You should see: each write appear as a decision card under the preview with a rehearsal showing the exact fields that will change. Approve one with your passkey and the agent's tool call returns with the result. Reject one with a reason and the agent receives your reason. Grant a lease (3 writes over 5 minutes, or 10 over 15) and the next writes run without asking, with the count visible in the header chip.

## Hackathon

EEVEE is an entry in [The WebMCP Challenge](https://webmcp.devpost.com) (submission period 25 August 2026 11:00 PT to 3 September 2026 13:00 PT).

**Why WebMCP fits.** The person and the agent share one page. The agent's tool calls, the rehearsal cards, the passkey prompt, and the rendered applet all happen in the same tab, so the person watches every step instead of trusting a log.

**How it improves the experience.** The agent no longer needs a screenshot loop or a scraped DOM. It gets 28 tools with JSON schemas and field-level validation errors, and `get_workbench_state` tells it what the person is looking at. The person gets a decision, not a diff.

**What people and agents do together.** An agent builds an ERP, runs its behavioral suite, and hands over a passing version. The person publishes it with a passkey. The agent then works the ERP through the applet's own actions while the person approves, rejects with a reason, or grants a short lease. Before WebMCP the same loop needed a bespoke integration for every app.

**How WebMCP was implemented.** `src/client/webmcp.ts` registers 28 tools with `document.modelContext.registerTool` (falling back to `navigator.modelContext` for pre-Chromium-150 builds) and normalizes Chrome 152's `execute(input)` call, which passes no options argument. Each tool carries `readOnlyHint` and `untrustedContentHint` annotations. When a published run is open, `src/components/applet-preview.tsx` registers one `applet_<action>` tool per declared action and unregisters them when the run closes; the browser fires `toolchange` so the agent refreshes its list. A write tool waits up to 45 seconds inline for the person's decision. `scripts/webmcp-e2e.mjs` checks the surface in a real headless Chrome.

## WebMCP tools

Plan and state:

| Tool | Purpose |
| --- | --- |
| `share_plan` | Post the agent's working plan onto the workbench for the person to watch. |
| `update_plan_step` | Mark a plan step pending, active, done, or failed. |
| `get_workbench_state` | Read what the person sees: open surface, applet, run, review, file, decisions waiting, active lease, passkey enrollment, live tool count. |

Library:

| Tool | Purpose |
| --- | --- |
| `list_files` | List stored DOCX, XLSX, PPTX, and PDF files with version, size, and checksum. |
| `inspect_file` | Read one file's metadata and version register, without raw bytes. |
| `scan_document_review` | Scan the current DOCX version for sensitive patterns; returns masked findings with stable ids. |
| `request_redaction_review` | Open selected masked findings for the person; redaction itself needs the passkey. |
| `create_office_file` | Store complete native Office bytes as a new file. |
| `replace_office_file` | Store complete native Office bytes as a new version of an existing file. |
| `edit_spreadsheet` | Apply cell, formula, style, structure, filter, validation, chart, table, pivot, drawing, and sparkline edits to an XLSX. |
| `inspect_tool_contract` | Return the full JSON schema for `edit_spreadsheet` or `create_video_editor_version` on demand. |
| `edit_pdf` | Rotate or delete one PDF page into a new version. |

Applets:

| Tool | Purpose |
| --- | --- |
| `list_applets` | List applets with version, evaluation, run, and correction counts. |
| `install_reference_applet` | Install Meridian Ops as a draft with its behavioral suite. |
| `inspect_applet` | Read inputs, version summaries, suites, recent evaluations, runs, and open corrections. |
| `inspect_applet_version` | Read one version's declared actions, evidence, and source files (40 KB per call, then by path). |
| `create_applet` | Create a draft applet with medium `web-app` or `video`. |
| `create_react_app_version` | Compile a React source bundle into a new version. |
| `revise_react_app_version` | Create the next version from a delta: changed files and deleted paths against a base version. |
| `create_video_editor_version` | Compile a video edit-decision project and its React editor into a new version. |
| `create_evaluation_suite` | Store a behavioral suite of fill, click, press, wait, restart, and assertion steps. |
| `evaluate_applet_version` | Run the suite against the candidate and the published version; record regressions. |
| `inspect_evaluation_run` | Read stored scenario and step evidence for one evaluation. |
| `request_version_review` | Open a passing version for the person; never publishes. |
| `run_applet` | Start a run of the published version; registers its actions as `applet_*` tools. |
| `record_correction` | Attach a person-observed problem to a successful run as the brief for the next version. |

Decisions:

| Tool | Purpose |
| --- | --- |
| `inspect_applet_action` | Read the decision, execution state, result, and error for one action request. |
| `await_action_decision` | Wait up to 120 seconds for the person to decide on a request. |

Plus one `applet_<action>` tool per declared action of the open published run (Meridian Ops declares 32).

## Run locally

Requirements: Node.js 24 (see `.nvmrc`), npm 10 or newer, and Docker for PostgreSQL.

```bash
cp .env.example .env.local        # set EEVEE_SESSION_SECRET to 32+ random characters
docker compose up -d --wait       # PostgreSQL 17 on port 55433
npm ci
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page and [http://localhost:3000/workbench](http://localhost:3000/workbench) for the workbench; **Open the demo** links the two. The **Workspace** menu in the workbench header goes back to the site or leaves the workspace (the only sign-out; a workspace is this browser's cookie, so leaving is one way). WebAuthn accepts `http://localhost`, so passkeys work locally. On a deployed hostname they need HTTPS.

## Verify

```bash
npm run lint
npm run typecheck
npm test            # unit tests; integration tests run when DATABASE_URL is set
npm run build
npm run test:webmcp # needs a Chrome binary and a running dev server
```

`npm run verify` runs the first four in sequence; CI runs the same set against PostgreSQL 17 (`.github/workflows/ci.yml`). `test:webmcp` launches headless Chrome with WebMCP enabled, enumerates the tools through `document.modelContext.getTools()`, and executes them through `executeTool()` the way an agent does: `list_applets`, `list_files`, `get_workbench_state`, `share_plan`, an invalid `inspect_applet` call, then `install_reference_applet`, `inspect_applet`, and `evaluate_applet_version`, which runs all four Meridian scenarios through the browser evaluation worker and checks the verdict. It then plays the person with a CDP virtual authenticator standing in for the fingerprint and real pointer input for everything else: passkey enrolment, review, publish, `run_applet`, the 32 `applet_*` tools appearing through `toolchange`, an automatic read, a rehearsed write approved with the passkey, a 3-write lease and a leased write, revocation, and a rejection whose reason reaches the agent. `--shots <dir>` saves PNG screenshots of those moments at desktop and 390 px.

## Design and trust boundaries

The passkey gates publishing, every applet write, document redaction, and lease grants. It does not gate Library uploads or spreadsheet and PDF edits: those always create a new immutable version and leave the previous one in place, so nothing is lost and every change is attributable.

```text
agent -> WebMCP tools (page) -> same-origin API -> PostgreSQL
                                                   applets, versions, suites, evidence, runs, state, decisions, files
```

- A version is immutable. Publishing moves a pointer; it never rewrites a version.
- Applet source is React plus relative imports under `src/`. Limits: 48 files, 200 KB per file, 1.5 MB of source, 3 MB compiled, 32 actions, 128 state keys, 64 KB per value.
- A behavioral suite holds up to 10 scenarios of 40 steps each, 100 steps in total, as declarative steps rather than test JavaScript.
- Applets run in a sandboxed iframe with a strict content security policy and a narrow `window.eevee` bridge.
- Publishing, action decisions, DOCX redaction, and leases require a passkey. Each challenge is single-use and scoped to one exact operation.
- The server checks every action's declared effects, and the page rejects untagged writes to stored state after an agent action has run unless the person is interacting.

Details: [architecture](docs/architecture.md), [product language](CONTEXT.md), [quality bar](docs/quality-bar.md), [deployment](docs/deployment.md), [provenance](docs/provenance.md).

## Built during the hackathon vs ported

The repository was created on 26 August 2026. Everything outside `src/office` was written during the submission period: about 23,500 lines across 164 files in `src/` (4,100 of them tests) plus `scripts/`, measured on 3 September 2026. Commit `906dc23` on 31 August 2026 ported 155,594 lines of Office editors (Documents, Sheets, Slides, PDF, and their engines) under `src/office` from the owner's private predecessor. That code predates the hackathon and is released here under Apache-2.0. See [provenance](docs/provenance.md) for the exact paths.

## License

Apache-2.0. Avara Variable, used for display type, remains under the SIL Open Font License 1.1. See [NOTICE](NOTICE) and [the bundled font license](public/fonts/AVARA-OFL.txt).
