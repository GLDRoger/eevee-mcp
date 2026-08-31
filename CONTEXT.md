# EEVEE MCP language

## Applet

A durable, versioned program distilled from useful work. An applet declares its inputs, execution definition, evaluation evidence, and outputs. It can produce a web app, edit a bounded video project, transform an office file, or execute a workflow.

## Version

An immutable applet definition. A version becomes runnable only after its required evaluations pass and a person publishes it.

## Run

One execution of one immutable version with validated inputs. A run records its state, outputs, and evidence.

## Action

A typed capability declared by one immutable applet version and implemented inside its sandbox. Read actions may run automatically. Any action that writes durable state requires a human decision and produces a stored request and result.

## Authority

The effects a person has allowed one action request to perform. EEVEE checks authority against the declared and executed storage or file operation. Approval applies to one exact request, never to the applet generally.

## Correction

A proposed improvement derived from a person changing or rejecting a run output. A correction never changes a live applet until it produces a new evaluated version and a person publishes that version.

## Harness

The deterministic part of EEVEE: validation, persistence, execution, evaluation, sandboxing, and approval gates. The harness does not decide what the user wants.

## Agent

External intelligence, such as Codex or a browser agent, that discovers EEVEE tools through WebMCP and plans how to use the harness.

## System application

A trusted EEVEE workflow that operates on harness-owned data and cannot run as untrusted applet code. Private review is a system application because it controls native file rewriting and immutable version creation.

## Video project

A bounded edit-decision list with format, frame rate, duration, tracks, and clips. A video applet edits and evaluates this project in the sandbox. Encoded media rendering is a later executor, separate from the working EDL medium.
