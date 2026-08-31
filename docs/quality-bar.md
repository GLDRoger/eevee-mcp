# Quality contract

A successful tool call proves transport and validation. EEVEE calls a medium working after an independent agent can produce a useful artifact, the deterministic checks pass, and a person can inspect the rendered result.

## Evidence required for every medium

- The run uses the published immutable version and validated generated-form inputs.
- The output survives a new browser session and can be downloaded or opened again.
- A failed evaluation blocks publishing and explains what to correct.
- A correction creates a proposal tied to the exact run. The live version stays unchanged.
- The same task can run again with changed inputs without asking the user to reconstruct the prompt.
- Comparison uses the deterministic harness rather than the agent that authored the candidate.

## Benchmark suites

| Medium | Benchmark | Deterministic checks | Rendered review | Current state |
| --- | --- | --- | --- | --- |
| Web app | Build a persistent task register from a short brief, reload it, correct it, and create version 2. | Bounded React compilation, allowed imports, one self-contained artifact, landmarks, named controls, declarative browser actions, durable state across restart, and candidate-versus-published regression detection. | Desktop and 390 px interaction pass; visual screenshot comparison remains human-reviewed. | Browser-verified through native WebMCP: creation, source inspection, 12-step durable scenario, failed regression, corrected comparison, human publish, run handshake, and 390 px rendering. Automated screenshot comparison remains. |
| Document | Turn mixed notes into a branded executive brief with a table and source notes. | Valid DOCX, expected sections, styles, pagination bounds, table integrity, no overflow or missing glyphs. | Render every page to images; judge hierarchy, spacing, readability, and fidelity to the brief. | System editor and immutable save path are Browser-verified. Applet executor and automated quality worker are pending. |
| Presentation | Build a concise product review deck from structured inputs and evidence. | Valid PPTX, slide count, editable text and charts, image bounds, font availability, no overlap or clipping. | Render every slide; judge narrative, composition, contrast, and consistency. | System editor, undo/redo, save, and reopen are Browser-verified. Applet executor and automated quality worker are pending. |
| PDF | Produce a distributable report from an applet run. | Valid PDF, expected page count, searchable text, links, metadata, no clipped or blank pages. | Render every page; compare it with the source artifact and review print readability. | System editor and page-edit WebMCP tool are Browser-verified. Applet executor and automated quality worker are pending. |
| Spreadsheet | Reconcile two messy exports, preserve formulas, flag exceptions, and create a summary. | Valid XLSX, formula recalculation, typed cells, reconciliation totals, defined error policy, unchanged source sheets, large-sheet runtime bound. | Open the workbook; review number formats, frozen panes, filters, legibility, and exception workflow. | System editor and full XLSX gateway are Browser- and byte-verified for style, structure, formulas, page view, immutable save, reopen, WebMCP edit, and stale-version rejection. The held-out applet benchmark worker is pending. |
| Learned applet | Learn a repeatable workflow from examples, run it on held-out input, correct it, and rerun. | Version lineage, schema stability, held-out result diff, correction trace, rollback, and deterministic replay where possible. | A person compares the held-out result with the example and approves the changed behavior. | Compiler and evaluator pending. |
| Image recipe | Reproduce a supplied visual style with changed subject inputs. | Versioned recipe and runner settings, asset provenance, dimensions, safety result, and seed capture when supported. | Blind side-by-side review for style fidelity and text integrity. | External runner contract pending. |
| Video applet | Edit a supplied story timeline with changed content, preserve the EDL, and rerun the project. | Bounded format, frame rate, duration, clips, typed timeline actions, durable undo, browser scenarios, and candidate-versus-published regression detection. | Review the live frame specimen and complete timeline at desktop and 390 px. | The FableCut reference package compiles, installs, and carries a restart suite. Encoded media rendering, audio, captions, and codec checks remain a later executor. |

## Promotion rule

Each suite keeps at least one golden task and one held-out task. A candidate version can replace the published version when:

1. all required deterministic checks pass;
2. its behavioral comparison records no required regression against the published version; and
3. a person approves the rendered artifact.

Scores help diagnosis. They never override a required failure or human review. Informational failures remain visible without blocking publication.
