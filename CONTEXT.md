# EEVEE MCP language

## Applet

A durable, versioned program distilled from useful work. An applet declares its inputs, execution definition, evaluation evidence, and outputs. It can produce a web app, transform an office file, execute a workflow, or eventually generate media.

## Version

An immutable applet definition. A version becomes runnable only after its required evaluations pass and a person publishes it.

## Run

One execution of one immutable version with validated inputs. A run records its state, outputs, and evidence.

## Correction

A proposed improvement derived from a person changing or rejecting a run output. A correction never changes a live applet until it produces a new evaluated version and a person publishes that version.

## Harness

The deterministic part of EEVEE: validation, persistence, execution, evaluation, sandboxing, and approval gates. The harness does not decide what the user wants.

## Agent

External intelligence, such as Codex or a browser agent, that discovers EEVEE tools through WebMCP and plans how to use the harness.
