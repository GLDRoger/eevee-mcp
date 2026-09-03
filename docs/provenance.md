# Provenance

This repository was created under the GLDRoger GitHub account on 26 August 2026 as an empty public repository. It carries no Git history from EEVEE's private predecessor.

The WebMCP Challenge scores work done during the submission period (25 August 2026 11:00 PT to 3 September 2026 13:00 PT). This file separates that work from what was ported.

## Written during the submission period

Everything outside `src/office`: the applet model, API, database schema, the 28 WebMCP tools and the dynamic `applet_*` tools, the React compiler, the preview sandbox and bridge, the behavioral suite runner, passkey gates, decisions, rehearsal, leases, the Library and Studio host integration, Meridian Ops, the tests, and `scripts/webmcp-e2e.mjs`.

Measured on 3 September 2026 with `find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -not -path 'src/office/*' | xargs cat | wc -l`: 23,485 lines across 164 files, of which 4,117 lines in 37 files are tests. `scripts/webmcp-e2e.mjs` adds about 450 lines.

## Ported from the private predecessor

Commit `906dc23` on 31 August 2026 (`feat: complete governed applet and Office workbench`) ported the Office editors from private EEVEE commit `e32e1f7`. `git show --stat 906dc23 -- src/office` reports 374 files and 155,433 insertions. On 2 September 2026, `find src/office -name '*.ts' -o -name '*.tsx' -o -name '*.css' | xargs cat | wc -l` reports 155,594 lines.

The port maps:

- `apps/web-next/src/office/pdf/` to `src/office/pdf/`;
- `apps/web-next/src/office/docs/` to `src/office/docs/`;
- `packages/docx-engine/src/` to `src/office/engines/docx/`;
- `apps/web-next/src/office/sheets/` to `src/office/sheets/`;
- `apps/web-next/src/office/slides/` to `src/office/slides/`;
- `packages/pptx-engine/src/` to `src/office/engines/pptx/`;
- `packages/pptx-render/src/` to `src/office/engines/pptx-render/`; and
- the predecessor's metric-compatible Office fonts to `public/fonts/office/`.

The Office editors are pre-hackathon work. The owner released them here under Apache-2.0. The port excludes every AI panel, chat path, provider setting, model call, learning action, and related asset. `src/office/host` (Library storage, pickers, print, download, external URL checks) and `src/office/registry.ts` were written in this repository so the ported editors read and save through the same-origin API.

Before the port, temporary DOCX, XLSX, and PDF editor surfaces were written in this repository on 26 August 2026 and removed when the ported editors replaced them. PDF.js runtime assets under `public/pdfjs` come from the installed `pdfjs-dist@6.2.108` package.

## Removed reference applets

Sparkbench (commit `a90894e`) and FableCut (commit `fe073fb`) were added as reference applets on 31 August 2026 and removed in the working tree before submission. Meridian Ops is the only reference applet.

## Third-party study

On 26 August 2026 the owner read two public projects before choosing React source bundles over raw HTML. [upstream-notes.md](upstream-notes.md) records what was kept and left out. No code was copied from either.

The bundled Avara Variable font is third-party software. Its source and license are recorded in [NOTICE](../NOTICE) and [AVARA-OFL.txt](../public/fonts/AVARA-OFL.txt).
