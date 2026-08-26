# Quality contract

A successful tool call proves transport and validation. EEVEE calls a medium working after an independent agent can produce a useful artifact, the deterministic checks pass, and a person can inspect the rendered result.

## Evidence required for every medium

- The run uses the published immutable version and validated generated-form inputs.
- The output survives a new browser session and can be downloaded or opened again.
- A failed evaluation blocks publishing and explains what to correct.
- A correction creates a proposal tied to the exact run. The live version stays unchanged.
- The same task can run again with changed inputs without asking the user to reconstruct the prompt.
- Comparison uses an independent evaluator that did not author the candidate.

## Benchmark suites

| Medium | Benchmark | Deterministic checks | Rendered review | Current state |
| --- | --- | --- | --- | --- |
| Web app | Build a persistent task register from a short brief, reload it, correct it, and create version 2. | Complete self-contained HTML, no network or navigation dependencies, responsive viewport, landmarks, accessible controls, EEVEE runtime, durable state round trip. | Desktop and 390 px interaction pass; compare version 1 and 2 screenshots. | Lifecycle, draft review, structural gate, navigation revocation, runtime handshake, and responsive rendering implemented. Independent visual comparison remains. |
| Document | Turn mixed notes into a branded executive brief with a table and source notes. | Valid DOCX, expected sections, styles, pagination bounds, table integrity, no overflow or missing glyphs. | Render every page to images; judge hierarchy, spacing, readability, and fidelity to the brief. | Executor pending. |
| Presentation | Build a concise product review deck from structured inputs and evidence. | Valid PPTX, slide count, editable text and charts, image bounds, font availability, no overlap or clipping. | Render every slide; judge narrative, composition, contrast, and consistency. | Executor pending. |
| PDF | Produce a distributable report from an applet run. | Valid PDF, expected page count, searchable text, links, metadata, no clipped or blank pages. | Render every page; compare it with the source artifact and review print readability. | Executor pending. |
| Spreadsheet | Reconcile two messy exports, preserve formulas, flag exceptions, and create a summary. | Valid XLSX, formula recalculation, typed cells, reconciliation totals, defined error policy, unchanged source sheets, large-sheet runtime bound. | Open the workbook; review number formats, frozen panes, filters, legibility, and exception workflow. | Executor pending. |
| Learned applet | Learn a repeatable workflow from examples, run it on held-out input, correct it, and rerun. | Version lineage, schema stability, held-out result diff, correction trace, rollback, and deterministic replay where possible. | A person compares the held-out result with the example and approves the changed behavior. | Compiler and evaluator pending. |
| Image recipe | Reproduce a supplied visual style with changed subject inputs. | Versioned prompt and model settings, asset provenance, dimensions, safety result, and seed capture when supported. | Blind side-by-side review for style fidelity and text integrity. | Model integration pending. |
| Video recipe | Reproduce a supplied motion language with changed content. | Versioned timeline, prompt and model settings, duration, codec, audio levels, captions, asset provenance. | Review full playback for pacing, continuity, readable text, and audio sync. | Model integration pending. |

## Promotion rule

Each suite keeps at least one golden task and one held-out task. A candidate version can replace the published version when:

1. all blocking deterministic checks pass;
2. the independent evaluator prefers it or records no regression against the published version; and
3. a person approves the rendered artifact.

Scores help diagnosis. They never override a blocking failure or human review.
