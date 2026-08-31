# Provenance

This repository was created under the GLDRoger GitHub account on 26 August 2026 as an empty public repository.

The repository does not preserve or import Git history from EEVEE's private predecessor. The applet model, API, database schema, WebMCP tools, web runtime, evaluation gate, and workbench in the initial commit were built in this fresh repository.

The bundled Avara Variable font is third-party software. Its source and license are recorded in [NOTICE](../NOTICE) and [AVARA-OFL.txt](../public/fonts/AVARA-OFL.txt).

Any later port from a predecessor must identify the imported files and their creation date here. New work stays distinguishable from pre-existing work for the WebMCP Challenge.

## Upstream study on 26 August 2026

- [GrowthX Output](https://github.com/growthxai/output) at commit `b3beef161910df053f62710dc190d5a00c4ab3d2` informed EEVEE's required/informational evaluator contract and aggregate verdict. The narrow adapted concept is recorded in [NOTICE](../NOTICE); Output's Temporal runtime, model stack, CLI, credentials, and remote trace processors were not imported.
- [Firecrawl Open Lovable](https://github.com/firecrawl/open-lovable) at commit `69bd93bae7a9c97ef989eb70aabe6797fb3dac89` informed the source-bundle to isolated-build to preview lifecycle. No Open Lovable code was copied. Its chat/model routes, sandbox providers, arbitrary package installation, and process-global state were deliberately excluded.

EEVEE's implementation is a direct, local design: typed `src/` files, an in-memory esbuild compiler, a stored immutable artifact, an iframe runtime, and a PostgreSQL lifecycle. It contains no embedded AI or chatbot implementation.

## Office work on 26 August 2026

The durable Library, file/version schema, upload and save APIs, and first temporary PDF, DOCX, and XLSX editor surfaces were authored in this fresh repository. Those temporary editors were removed when the complete predecessor editors replaced them. PDF.js runtime assets came from the installed `pdfjs-dist@6.2.108` package.

The repository owner subsequently directed that the predecessor's complete office ribbons and working controls be brought into this public WebMCP build. Source copied from private EEVEE commit `e32e1f7` is released here under Apache-2.0 by that direction. The port maps are:

- `apps/web-next/src/office/pdf/` to `src/office/pdf/`;
- `apps/web-next/src/office/docs/` to `src/office/docs/`;
- `packages/docx-engine/src/` to `src/office/engines/docx/`;
- `apps/web-next/src/office/sheets/` to `src/office/sheets/`;
- `apps/web-next/src/office/slides/` to `src/office/slides/`;
- `packages/pptx-engine/src/` to `src/office/engines/pptx/`;
- `packages/pptx-render/src/` to `src/office/engines/pptx-render/`; and
- the predecessor's metric-compatible Office fonts to `public/fonts/office/`.

The port excludes every AI panel, chat path, provider setting, model call, learning action, and related asset. Browser-only host storage, same-origin APIs, immutable file versions, the full XLSX save gateway, WebMCP tools, responsive workbench integration, tests, and all model-removal work were authored in this public repository.
