# EEVEE MCP

EEVEE is a durable workbench for people and browser agents. An agent uses the page's WebMCP tools to create and inspect applets. EEVEE owns the parts that must remain predictable: typed inputs, immutable versions, evaluation, approval, execution, state, and corrections.

The first working vertical slice is a self-contained web applet. It covers the complete lifecycle:

1. An agent creates an applet and an immutable version.
2. EEVEE validates the input form and evaluates the HTML.
3. A person reviews and publishes a passing version.
4. The applet runs in a sandbox with durable key-value state.
5. A person records a correction against a run without changing the live version.

Documents, spreadsheets, presentations, PDFs, workflows, and media recipes already exist in the persistent applet model. Their executors and quality suites are the next implementation milestones. The [quality contract](docs/quality-bar.md) records the proof each medium must supply before EEVEE calls it working.

## WebMCP tools

EEVEE registers tools with `document.modelContext.registerTool`. They are available to a compatible browser agent while this page is open.

| Tool | Purpose |
| --- | --- |
| `list_applets` | List applets and lifecycle counts in the current workspace. |
| `inspect_applet` | Read versions, evaluations, runs, and corrections. |
| `create_applet` | Create a durable draft for any applet medium. |
| `create_web_app_version` | Add an immutable, typed, self-contained web app version. |
| `request_version_review` | Open a passing version for a person's review. |
| `run_applet` | Run the published version with validated inputs. |
| `record_correction` | Attach a proposed improvement to a successful run. |

Publishing stays in the EEVEE interface. No WebMCP tool can approve its own output.

## Run locally

Requirements: Node.js 24, npm 10 or newer, and Docker.

```bash
cp .env.example .env.local
docker compose up -d
npm ci
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To expose the tools in Chrome 149 or later, enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome. A compatible agent can then discover the tools from the open page.

For a first run, ask the agent:

```text
Create a self-contained project task register in EEVEE. Give it a required project-name input, persistent tasks, keyboard-friendly controls, responsive layout, and no network dependencies. Show me the evaluated version for approval, then run it with the project name "WebMCP launch".
```

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
browser agent -> WebMCP tools -> typed API -> applet service -> PostgreSQL
                                      |              |
                                      |              +-> immutable versions, runs, state, corrections
                                      +-> generated form and human approval
```

See [architecture.md](docs/architecture.md) for the trust boundaries, [CONTEXT.md](CONTEXT.md) for the product language, and [provenance.md](docs/provenance.md) for the clean-repository record.

## License

Apache-2.0. Avara Variable, used for display type, remains under the SIL Open Font License 1.1. See [NOTICE](NOTICE) and [the bundled font license](public/fonts/AVARA-OFL.txt).
