# Broaden and improve technology coverage

Status: implemented for sections 1, 2, 4, and 5; section 3 (skill usefulness for technologies already detected) is intentionally deferred.

Result after implementation: the catalog holds 226 technologies and 33 combos. Detection corrections and the reconciled backlog live in `skills-map.ts`, `lib.ts`, `detection-files.ts`, and `detection-manifests.ts`; `tests/detection-accuracy.test.ts`, `tests/platform-detection.test.ts`, and `tests/catalog-coverage.test.ts` cover the corrected rules, the new entries, and catalog/documentation invariants. `scripts/catalog-report.mjs` derives the README totals and coverage from the map. The untracked discovery reports described above were produced by a separate workflow and were not regenerated here.

## Objective

Improve detection accuracy, complete the existing expansion backlog, and make more detected technologies produce relevant skill recommendations. Keep `packages/autoskills/skills-map.ts` as the public catalog entry point and preserve existing technology IDs.

## Current baseline

Measured from the exported map on 2026-10-19 after pulling `cb565c8`:

- 188 technologies: 87 have mapped skills; 101 are detection-only.
- 33 combinations: 10 have no mapped skills.
- Detection uses alternative signals: any matching package, file, extension, gem, or content pattern is sufficient. Content patterns use substring matching.
- Existing untracked `tests/platform-detection.test.ts` proposes 36 technology IDs plus stronger C++ detection. Upstream now includes Preact, Lit, and TanStack Table, leaving 33 missing IDs and additional detection aliases to reconcile. Preserve this work.
- Existing discovery reports mention 187 technologies, which does not match the active map. Treat reports as candidate evidence and regenerate them against the final catalog.

## Implementation sequence

### 1. Correct existing detection before expanding it

Files: `skills-map.ts`, `lib.ts`, `tests/detect.test.ts`, `tests/expanded-detection.test.ts`.

- Require SwiftUI-specific evidence instead of treating every `Package.swift` or `Podfile` as SwiftUI. Keep Swift language detection separate.
- Replace generic `appsettings.json` signals for ASP.NET Core and Minimal API with framework-appropriate evidence. An OpenAPI package alone must not imply Minimal API.
- Detect Spring Boot from Maven and recognized Gradle declarations; an `application.yml` filename alone is insufficient.
- Separate CMake build-system evidence from C++ language evidence; detect C++ source/header extensions without requiring CMake.
- Prevent F# project files from triggering C# through the shared .NET scanner.
- Migrate Python technologies from substring matching to normalized declared package names. Extend the reader for supported static `setup.cfg`/`setup.py` declarations before removing existing coverage; never execute project code. Document unsupported dynamic declarations.
- Add missing aliases/config variants only where official documentation supports them, including React Router's `react-router-dom` dependency.
- Add bounded source-content or structured manifest matching only where these corrections require it. Keep existing alternative-signal behavior compatible; do not introduce an unrestricted recursive scanner.

Acceptance: each corrected rule has a representative positive fixture and a realistic near-miss fixture. Update tests that currently encode the overbroad behavior.

### 2. Reconcile the existing backlog and add the 33 missing technologies

Files: `skills-map.ts`, `tests/platform-detection.test.ts`; `lib.ts` only when existing signal types are insufficient.

- UI and content: Preact, Lit, Ink, Radix UI, Recharts, D3, CodeMirror, Monaco Editor, TanStack Table, and the remark/rehype ecosystem.
- Services and data: WorkOS, SQLite, Google Gen AI, Firecrawl.
- Developer tools: AVA, XO, Rollup, Babel, nodemon, Knip, TypeDoc.
- Languages, platforms, and scripting: Nix, QML, Vala, Meson, SuperCollider, Lua, Haskell, PowerShell, Fish, Zsh, Windows batch, Jinja, Obsidian, userscripts, Home Assistant.

Review the draft tests as proposed requirements rather than assuming every heuristic is correct. In particular, a generic `repository.yaml` must not imply Home Assistant, a platform binary must not imply Rollup use, and a generic `manifest.json` must not identify a specific plugin platform. Verify current dependency identities and config formats against primary documentation during implementation.

Keep new entries at `skills: []` until separately reviewed and synced. Preserve existing IDs, including `remark`, while clarifying display names and descriptions where they cover a wider ecosystem. Preact, Lit, and TanStack Table already exist after the pull; extend their signals only where needed. If all 33 remaining IDs are retained, this batch brings the catalog to 221 technologies before any separately introduced build-system entries.

### 3. Improve skill usefulness for technologies already detected

Files: `skills-map.ts`, existing discovery reports, `skills-registry/`, generated catalog documentation.

Prioritize the existing gaps for Docker, GitHub Actions, Kubernetes/Helm, AWS, PostgreSQL, React Router, TanStack Query, GraphQL, and testing tools. This ordering is a proposal based on catalog gaps, not usage telemetry.

Use the existing discovery workflow. Evaluate candidates for technology relevance, upstream ownership, version applicability, licensing, and the repository's normal security checks. Review existing broad mappings too: migration-specific, repository-contributor, or unrelated task skills should not be automatically selected merely because a technology exists.

Populate a mapping only after the upstream skill path and bundled registry content are verified. Prefer a small useful default set. Keep detection-only entries when no suitable skill exists; do not fill every empty array to meet a quota. Run the existing sync and registry validator without bypassing review checks.

### 4. Broaden ecosystem coverage where detection remains shallow

Files: `skills-map.ts`, `lib.ts`, focused manifest/detection tests.

- Review the newly added `postgres` entry alongside `postgres-ruby`; verify consistent naming and deduplication while preserving both existing IDs. JS and Python driver detection now exists upstream.
- Expand existing AWS, Azure, Stripe, and other cross-language services using exact dependency identities where the detector already supports them.
- Deno and Fastify now exist upstream. Evaluate Phoenix, Symfony, and Go/Rust framework detection as a follow-up batch. Add declarative Composer, Go module, Cargo, or Mix readers only with a concrete accepted technology that needs them.
- Preserve local, offline detection and bounded filesystem reads. Do not install project dependencies, execute manifests, or infer a technology solely from lockfile transitive dependencies.

This phase follows the existing backlog and skill-coverage work; it is not a prerequisite for shipping them.

### 5. Make catalog quality repeatable

Files: `tests/detect.test.ts`, `tests/collect.test.ts`, `tests/workspace.test.ts`, registry validation, READMEs/catalog generation.

- Extend existing unique-ID checks with valid combo references, nonempty detection definitions, duplicate signal checks, and valid skill-path checks; retain registry hash validation.
- Cover root projects and workspaces, comments/unrelated text, malformed manifests, ignored/generated directories, and duplicate skill collection.
- Document that combinations currently use the union of technologies across workspaces. Add no integration-specific combo until its workspace semantics and specialist benefit are clear; address workspace-local combinations separately if needed.
- Use the current shared `tests/helpers.ts` utilities and named imports from `node:assert/strict`.
- Generate technology totals and coverage lists from the map where practical, including separate counts for detection-only and skill-backed entries. Keep discovery reports consistent with the catalog revision.
- Retain the public exports. Group entries consistently; split catalog data into internal modules only if maintenance justifies it.

## Delivery and validation

Ship accuracy fixes, backlog additions, skill curation, and further ecosystem support as independently reviewable changes, each with its relevant tests and documentation. No dependency addition is required for the initial catalog batches.

Run focused detection/collection/workspace tests while implementing, then the complete CLI test suite, package TypeScript build, root lint, and registry validation. Establish baseline failures first, especially those caused by the existing unimplemented platform tests. Check scan performance if traversal changes; require bounded traversal and no repeat full-tree scan per new technology. Do not report unsupported or unverified skills as installable coverage.

Planning verification: read the map, detection implementation, tests, documentation, and discovery/validation workflow; calculated catalog counts. No tests, builds, network skill verification, or implementation changes were performed.

## Repository evidence

- `packages/autoskills/skills-map.ts`: technology and combo definitions, frontend classification, skill references.
- `packages/autoskills/lib.ts:383`: normalized Python dependency reader.
- `packages/autoskills/lib.ts:487`: signal matching, per-directory caches, and workspace aggregation.
- `packages/autoskills/tests/platform-detection.test.ts`: existing untracked expansion backlog.
- `packages/autoskills/tests/detect.test.ts`: existing invariants and detection expectations.
- `packages/autoskills/tests/additional-ecosystems.test.ts`: upstream coverage for the 37 newly added technologies.
- `packages/autoskills/scripts/validate-registry.mjs`: declared skill paths, registry presence, and bundle hashes.
- `packages/autoskills/README.md`: documented coverage and detection-only policy.
- `packages/autoskills/skills-discovery.md`: prior discovery candidates and review/sync workflow.
