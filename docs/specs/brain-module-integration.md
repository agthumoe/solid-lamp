# Brain module integration

Task [#107](https://github.com/agthumoe/solid-lamp/issues/107), integrating #89/#90 and the scoring slice of #98. This is package and quality-gate wiring only.

The private `@aetherion/brain` workspace exposes parsing, link resolution, chunking and evaluation through a single public entry. It declares existing exact dependencies `yaml@2.8.4` and `zod@4.6.7`; there are no new dependency versions. No runtime consumer or service is enabled. Internal modules remain separated by responsibility.

Root `test:brain`, its Makefile mirror and the root test chain discover every brain test recursively. This matches the script proposed by source-reader PR #102, allowing that suite to join the same gate when its containment fix is ready. CI already runs `pnpm check`, which now runs brain tests too.

Acceptance: all pure suites run through `pnpm check`; package self-import verifies the public export map; parser output composes with chunking without losing frontmatter/CRLF source locators; links remain source-scoped. Real model calibration, source materialization, worker/schema/search integration and #98's final gate remain separate. No real vault, DB, GPU or shared services are touched.
