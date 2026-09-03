# EEVEE MCP language

Use these terms as written. The UI, the tool descriptions, and the docs share them.

## Applet

A small program an agent builds for one repeatable job, stored with its inputs, source, evidence, and history. Today an applet is a `web-app` (a React app) or a `video` project (an edit-decision list with a React editor).

## Version

One immutable snapshot of an applet: its inputs, source files, declared actions, and compiled artifact. A new version is created; an existing one is never edited.

## Behavioral suite

A stored set of scenarios that EEVEE runs in the browser against a version. It contains fill, click, press, wait, restart, and assertion steps, not test code.

## Scenario

One case in a behavioral suite: an input, a sequence of steps, and at least one assertion. A scenario is required or informational; a required failure blocks publishing.

## Evaluation

One execution of a suite against a candidate version and, when one exists, the published version. It stores step-level evidence, verdicts, and regressions.

## Publish

The person's act of making one version the live one, verified with a passkey. Publishing moves a pointer; it does not change the version.

## Run

One execution of the published version with validated inputs, open in the preview. A run owns its durable state (the PostgreSQL rows that survive a reload) and its decisions.

## Action

A capability a version declares by name, inputs, effects, and authority (`automatic` or `human`). While a run is open, each action is a WebMCP tool named `applet_<action>`.

## Decision

An agent-triggered write waiting for the person. The person approves it with a passkey, rejects it with an optional reason, or lets a lease cover it.

## Rehearsal

A dry run of a decision that is still waiting, in a hidden sandbox seeded with the run's current state. It shows the fields that will change before the person decides.

## Lease

A short grant of autonomy to one run: a fixed number of writes over a fixed number of minutes, issued with a passkey. The server spends each write once and the person can revoke the lease at any time.

## Correction

A person's note on a successful run: what was wrong and what should happen instead. It changes nothing until an agent builds the next version and the person publishes it.

## Passkey

The workspace's WebAuthn credential. Publishing, decisions, DOCX redaction, and leases each start a single-use challenge tied to one exact operation and complete it with a fingerprint, face, device PIN, or security key.

## Applet ledger

The list of applets in the workspace, with their lifecycle counts. It is the first surface in the workbench.

## Library

The stored DOCX, XLSX, PPTX, and PDF files. Every save creates a new file version.

## Studio

The Documents, Sheets, Slides, and PDF editors. They open and save Library files and contain no model or chat path.

## Preview

The rendered applet in its sandboxed iframe. A draft preview uses placeholder inputs and in-memory state; a run preview uses the run's durable state.

## Agent

External intelligence that discovers EEVEE's tools through WebMCP and plans how to use them. EEVEE contains no model.

## Harness

The deterministic part of EEVEE: validation, storage, compilation, evaluation, sandboxing, and the passkey gates. The harness does not decide what the person wants.

## Design context

EEVEE keeps the model outside. Every tool call is validated at the page and again at the server, and every record carries the workspace id from the signed session cookie. Durable state means the PostgreSQL rows that survive a page reload: applet state, versions, runs, decisions, and file versions. Anything that changes durable state on the agent's behalf either runs as a declared action with `human` authority or does not run.

Sensitive-text review is a harness feature, not an applet: its scan returns masked findings, and the passkey-verified redaction writes a new file version. The scan minimizes what the agent receives; it does not claim that content opened in Studio or read by an applet is hidden from the agent.
