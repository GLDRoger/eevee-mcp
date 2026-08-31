# EEVEE MCP

EEVEE is a model-free execution harness for people and browser agents. Codex or another WebMCP-capable agent authors the work; EEVEE owns typed inputs, immutable versions, compilation, evaluation, authority, execution, state, and corrections. There is no chat UI or model integration in this repository.

The working applet media are self-contained web applications and bounded video edit-decision projects. They share one lifecycle:

1. An agent creates an applet and an immutable version.
2. EEVEE validates and compiles the bounded React source once.
3. The agent defines reusable browser scenarios; EEVEE executes them against the candidate and current published version.
4. A person reviews and publishes a candidate with no required failures.
5. The applet runs in a sandbox with durable key-value state.
6. A published applet may expose typed actions. Durable changes become action requests that only a person can approve.
7. A person records a correction against a run without changing the live version.

The Library opens and edits durable DOCX, XLSX, PPTX, and PDF files with full ribbon surfaces and browser-backed controls. Every save creates an immutable version. Private review detects supported sensitive patterns without returning their original values to the agent; a person can remove selected DOCX text into a new immutable version. XLSX edits use the same full gateway from the Sheets UI and WebMCP, including values, formulas, styles, structure, page layout, filters, validations, charts, tables, pivots, drawings, and sparklines. Office applet executors and automated visual quality suites remain separate milestones; the [quality contract](docs/quality-bar.md) keeps that boundary explicit.

## WebMCP tools

EEVEE registers tools with `document.modelContext.registerTool`. They are available to a compatible browser agent while this page is open.

| Tool | Purpose |
| --- | --- |
| `list_files` | List durable DOCX, XLSX, PPTX, and PDF files. |
| `inspect_file` | Read one file and its immutable version register. |
| `scan_document_review` | Return masked sensitive findings from the current DOCX version. |
| `request_redaction_review` | Open selected masked findings for a person's decision. |
| `create_office_file` | Store complete native Office bytes as a new file. |
| `replace_office_file` | Store complete native Office bytes as a new immutable version. |
| `edit_spreadsheet` | Apply the complete validated XLSX edit contract. |
| `inspect_spreadsheet_contract` | Read the full field-level edit_spreadsheet schema on demand. |
| `edit_pdf` | Rotate or delete a PDF page into a new immutable version. |
| `list_applets` | List applets and lifecycle counts in the current workspace. |
| `install_reference_applet` | Install Sparkbench or FableCut as an audited draft and behavioral suite. |
| `inspect_applet` | Read versions, evaluations, runs, and corrections. |
| `inspect_applet_version` | Read the exact typed React source for one immutable version. |
| `create_applet` | Create a durable draft for a runnable applet medium. |
| `create_react_app_version` | Compile and store an immutable React web app version. |
| `create_video_editor_version` | Compile and store an immutable video EDL editor version. |
| `create_evaluation_suite` | Store bounded browser actions and assertions as an immutable suite. |
| `evaluate_applet_version` | Run the suite against the candidate and published baseline. |
| `inspect_evaluation_run` | Read stored case, step, and regression evidence. |
| `inspect_applet_action` | Read the decision, execution state, result, and evidence for an action request. |
| `request_version_review` | Open a passing version for a person's review. |
| `run_applet` | Run the published version with validated inputs. |
| `record_correction` | Attach a proposed improvement to a successful run; the next version can resolve it. |

Publishing, DOCX redaction, and durable applet actions stay under visible human control. When a published applet run is open, EEVEE registers its declared actions as additional `applet_*` WebMCP tools. A state-writing action returns a pending request rather than changing data.

## Run locally

Requirements: Node.js 24, npm 10 or newer, and Docker.

```bash
cp .env.example .env.local
docker compose up -d --wait
npm ci
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To expose the tools in Chrome 149 or later, enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome. A compatible agent can then discover the tools from the open page.

The React cutover intentionally stops migration when an older local database contains raw HTML versions. This public repository has no deployed user data, so start with a fresh database instead of retaining the removed HTML executor.

For a first run, ask the agent:

```text
Create an interactive React project task register in EEVEE. Give it a required project-name input, persistent tasks, keyboard-friendly controls, responsive layout, and no network dependencies. Create a required browser scenario that adds a task, restarts the applet, and proves the task remains. Evaluate it, show me the evidence and rendered version for approval, then run it with the project name "WebMCP launch".
```

Or install one of the two audited reference packages from the Applet ledger:

- **Sparkbench** proves applet-specific tools, shared circuit state, human approval, and restart evaluation.
- **FableCut** proves the `video` medium with a bounded EDL, shared timeline, governed cuts, and durable undo.

## Verify

```bash
npm run lint
npm run typecheck
DATABASE_URL=postgres://eevee:eevee@localhost:55433/eevee_mcp npm test
npm run build
```

The integration suite uses PostgreSQL. Unit tests still run when `DATABASE_URL` is absent; the database lifecycle suite skips in that case.

## Design

The canonical path is:

```text
Codex / browser agent -> WebMCP tools -> typed API -> PostgreSQL
                                               |       |
                                               |       +-> applets, artifacts, evidence, runs, state
                                               +-> Office files and immutable versions
```

An interactive version contains `src/App.tsx` plus optional `.ts`, `.tsx`, and `.css` files under `src/`. EEVEE accepts React and relative source imports, rejects package and URL imports, and gives the app `inputs`, bounded `store`, read-only Library `files`, and medium-specific `media`. A version may export an `actions` object whose handlers match its typed action declarations. EEVEE checks the declaration, authority, input, resource effects, result size, and durable request state before a handler can change applet storage.

The compiled HTML is only the isolated delivery artifact. State, events, forms, and normal React interaction continue to work inside it. Browser scenarios use declarative fill, click, key, restart, storage, and assertion steps, never arbitrary test JavaScript.

See [architecture.md](docs/architecture.md) for the trust boundaries, [CONTEXT.md](CONTEXT.md) for the product language, and [provenance.md](docs/provenance.md) for the clean-repository record.

## License

Apache-2.0. Avara Variable, used for display type, remains under the SIL Open Font License 1.1. See [NOTICE](NOTICE) and [the bundled font license](public/fonts/AVARA-OFL.txt).
