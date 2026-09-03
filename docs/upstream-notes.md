# Upstream notes

On 26 August 2026 the owner studied two public projects before replacing raw HTML authoring with React source bundles. The goal was to reuse product ideas without importing their model stacks or operational services. No source code was copied from either.

## GrowthX Output

Source: [growthxai/output](https://github.com/growthxai/output), commit `b3beef161910df053f62710dc190d5a00c4ab3d2`, Apache-2.0.

Kept:

- explicit evaluator verdicts;
- required versus informational checks;
- a report verdict derived from its required results;
- repeatable scenarios with comparison evidence.

Left out:

- model and prompt infrastructure;
- Temporal, Redis, S3, and trace-processing services;
- credentials and provider abstractions;
- its CLI and workflow execution stack.

The adapted verdict aggregation is recorded in [NOTICE](../NOTICE).

## Firecrawl Open Lovable

Source: [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable), commit `69bd93bae7a9c97ef989eb70aabe6797fb3dac89`, MIT.

Kept as a product convention:

- a version is a bundle of named source files with one entry point;
- source compiles into an isolated preview artifact;
- build failures return useful diagnostics instead of creating a runnable version.

Left out:

- chat and model-generation routes;
- arbitrary package installation;
- remote sandbox and deployment providers;
- global mutable sandbox state and stubbed validation.

EEVEE compiles a small allow-listed React surface in memory with esbuild, stores the exact artifact with its version, and never executes applet code on the server.
