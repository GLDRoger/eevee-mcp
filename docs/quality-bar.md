# Quality bar

A successful tool call proves transport and validation. EEVEE calls a medium working when an agent can produce a useful artifact through the tools, the deterministic checks pass, and a person can inspect the rendered result.

## Evidence required for every medium

- The run uses the published version and validated inputs.
- The output survives a new browser session and can be opened again.
- A failed evaluation blocks publishing and names what to correct.
- A correction attaches to the exact run. The published version stays unchanged.
- The same job runs again with changed inputs without rewriting the prompt.
- Comparison uses the harness, not the agent that authored the candidate.

## Media

| Medium | Benchmark | Deterministic checks | Rendered review | Current state |
| --- | --- | --- | --- | --- |
| `web-app` | Install Meridian Ops, evaluate it, publish it, work an order through allocate, ship, deliver, invoice, and payment under decisions and a lease. | React compilation, import allow-list, one self-contained artifact, landmarks and named controls, declarative scenarios, state across restart, candidate-versus-published regressions, action effect checks, single-use lease spends. | Desktop and 390 px interaction in the preview; screenshot comparison is a human step. | Automated: `src/server/applets.integration.test.ts` (create, evaluate, publish, run, state, correction, delta revision), `src/server/evaluations.integration.test.ts` (regression blocking, concurrency cap), `src/server/applet-actions.integration.test.ts` (automatic read, human write, lease spent once under concurrency, revoked lease refused, rejection reason, supersede on new run, workspace isolation), `src/server/human-authority-verification.integration.test.ts` (passkey verification and single-use challenge), `src/app/api/human-gates.test.ts` (routes refuse without a passkey), `src/client/webmcp.test.ts` (tool set, Chrome 152 call shape, fallback, validation messages, decision wait), `src/client/rehearsal-diff.test.ts`, `src/reference-applets/meridian/*.test.ts`. `npm run test:webmcp` checks the 28 tools in headless Chrome, installs Meridian, runs its four scenarios through the real evaluation worker, then drives the human flow with a CDP virtual authenticator: passkey enrolment, publish, run, the 32 `applet_*` tools, an automatic read, a rehearsed write approved with the passkey, a lease and a leased write, revocation, a rejection with a reason, and the ledger's own hand-raised request for a person without an agent. The three Guide prompts map onto that script; the owner also ran them by hand in Chrome with a real passkey during the submission period, and no dated log is in the repository. Screenshot comparison: not built. |
| `video` | Edit a supplied timeline with changed content, keep the edit-decision list valid, rerun. | Format, frame rate, duration, and clip bounds; canonical React entry; scenarios and regressions as for `web-app`. | The frame preview and the timeline at desktop and 390 px. | Automated: `src/domain/video-editor.test.ts` (clip bounds, unique ids, entry). Creation through `create_video_editor_version` shares the `web-app` compile and evaluate path. Media upload, decode, playback, encoding, audio, captions: not built. |
| `document` | Turn mixed notes into a branded brief with a table and source notes. | Valid DOCX, expected sections, styles, pagination bounds, table integrity. | Render every page; judge hierarchy, spacing, and fidelity. | Studio editor, save, and version register: checked by hand by the owner during the submission period. Automated: `src/server/document-review.test.ts` (masked scan and redaction), `src/server/office-files.integration.test.ts`, `src/server/office-file-validation.test.ts`. Applet executor and automated quality worker: not built. |
| `presentation` | Build a short product review deck from structured inputs. | Valid PPTX, slide count, editable text and charts, no overlap or clipping. | Render every slide; judge composition and consistency. | Studio editor, undo/redo, save, reopen: checked by hand by the owner during the submission period. Automated: file validation and version tests as for `document`. Applet executor and automated quality worker: not built. |
| `pdf` | Produce a distributable report from an applet run. | Valid PDF, page count, searchable text, no blank pages. | Render every page; compare with the source. | Studio editor and `edit_pdf` (rotate, delete): automated in `src/domain/pdf.test.ts` and `src/app/api/files/file-content-routes.test.ts`; checked by hand by the owner during the submission period. Applet executor and automated quality worker: not built. |
| `spreadsheet` | Reconcile two exports, keep formulas, flag exceptions, add a summary. | Valid XLSX, formula recalculation, typed cells, unchanged source sheets, stale-version rejection. | Open the workbook; review formats, panes, filters, and the exception flow. | Studio editor and the `edit_spreadsheet` gateway: automated in `src/server/spreadsheet-edits.test.ts` (styles, structure, formulas, page layout, stale version) and `src/server/office-files.integration.test.ts`; checked by hand by the owner during the submission period. Applet executor and held-out benchmark worker: not built. |
| `workflow` | Learn a repeatable procedure from examples, run it on held-out input, correct it, rerun. | Version lineage, schema stability, held-out diff, correction trace, replay. | The person compares the held-out result with the example. | Not built. The enum value exists in `src/domain/applet.ts`; no compiler, executor, or tests. |
| `image` | Reproduce a supplied visual style with changed subject inputs. | Versioned recipe, asset provenance, dimensions, safety result, seed capture. | Blind side-by-side review. | Not built. The enum value exists; no runner contract or tests. |

## Promotion rule

A candidate version can replace the published version when:

1. every required scenario passes;
2. the evaluation records no required regression against the published version; and
3. a person reviews the preview and publishes with a passkey.

Informational failures stay visible and do not block. Scores help diagnosis; they never override a required failure or the person.

The behavioral evaluator runs inside the applet's own sandboxed frame, so applet code shares its JavaScript realm. The runtime script mints its evaluation token at load time instead of writing it into the markup, and it captures `querySelector`, `querySelectorAll`, the `innerText`, `textContent`, and `value` getters, `click`, `focus`, `dispatchEvent`, and `requestSubmit` before any applet code runs. An applet that later patches those to show the evaluator a fiction is still measured against the real DOM (`src/domain/applet-runtime.tamper.test.ts`). An applet that rewrites `Array` or `Promise` built-ins is not caught here; the static gate and the person's review are the defense for that.
