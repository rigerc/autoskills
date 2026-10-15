# Discover skills from external registries

This is a **maintainer-only, read-only discovery tool**. It searches [Skills Directory](https://www.skillsdirectory.com/docs/registry-api) and [SkillsMD](https://skillsmd.dev/api.html) for new skills that match AutoSkills' existing technology detection map.

## Usage

From the repository root, with Node.js 22.6+:

```bash
# Discover skills. If attached to a terminal, open the interactive review UI.
pnpm --dir packages/autoskills discover:skills

# Require the interactive terminal review (fails clearly without a TTY).
pnpm --dir packages/autoskills discover:skills:interactive

# Generate JSON and Markdown only (safe for automation / pipes).
pnpm --dir packages/autoskills discover:skills:batch
```

The CLI can also be run directly with `node --experimental-strip-types packages/autoskills/scripts/discover-autoskills.mjs --repo-root .`.

Target selected technologies:

```bash
node --experimental-strip-types packages/autoskills/scripts/discover-autoskills.mjs \
  --repo-root . --source both --tech react,docker,playwright \
  --verify-limit 60 --min-score 40
```

Run `--help` to see all discovery, pagination, threshold, API URL, and output options. The default reports are `skills-discovery.json` and `skills-discovery.md` in your working directory.

## Interactive terminal review

When stdin and stdout are TTYs, `discover:skills` automatically presents an interactive, keyboard-controlled result browser **after** writing the normal reports. Force it with `--interactive`, or disable it with `--no-interactive`. In CI or piped commands, the default is non-interactive.

- **Up/Down** (or **j/k**) navigates matched skills; **Enter** shows upstream metadata and the score's matching evidence. Detail text can be scrolled.
- **/** searches across names, descriptions, category, tags, and scoring evidence. **t** cycles technology matches, **s** cycles registry sources, and **v** shows selected results.
- **Space** toggles a candidate, **a** selects all currently visible results, and **u** clears the selection.
- **e** exports the shortlist to `skills-discovery.selected.json` and `skills-discovery.selected.md` (overridable with `--selection-output` and `--selection-markdown`).
- **?** shows keyboard help; **q** exits without modifying the registry.

Selecting or exporting a skill is **not** approval, installation, or a change to `skills-map.ts`. Exports are intended solely for maintainer review. If terminal review is unavailable, run the batch command and inspect the generated Markdown report.

## Matching

The script reads `packages/autoskills/skills-map.ts`, combines skill names, descriptions, tags, categories, package/config-file detection signals, repository metadata, and verification/popularity metadata, then assigns a score and explains the evidence. It merges duplicate candidates from both APIs, excludes already-listed skills and basename conflicts, and checks upstream GitHub trees for an actual `SKILL.md` before suggesting a full `owner/repository/skill` reference.

API popularity or a matching tag **does not guarantee** that a skill is safe, high-quality, or applicable. Review results manually. Do not auto-add candidates to `skills-map.ts` or the curated registry. After approving a candidate, use the repository's existing `sync:skills` safety review and `validate:registry` workflow.

## Test

Offline integration coverage, using mocked registry and GitHub APIs:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --test packages/autoskills/tests/discover-autoskills.test.ts
```

No API credentials are required for public registry search. Set `GITHUB_TOKEN` or `GH_TOKEN` if GitHub API rate limits become restrictive.
