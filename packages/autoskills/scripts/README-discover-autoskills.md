# Discover skills from external registries

This is a **maintainer-only, read-only discovery tool**. It searches [Skills Directory](https://www.skillsdirectory.com/docs/registry-api) and [SkillsMD](https://skillsmd.dev/api.html) for new skills that match AutoSkills' existing technology detection map.

## Usage

From the repository root, with Node.js 22.6+:

```bash
node --experimental-strip-types packages/autoskills/scripts/discover-autoskills.mjs --repo-root .
```

Target selected technologies:

```bash
node --experimental-strip-types packages/autoskills/scripts/discover-autoskills.mjs \
  --repo-root . --source both --tech react,docker,playwright \
  --verify-limit 60 --min-score 40
```

Run `--help` to see all discovery, pagination, threshold, API URL, and output options. The default outputs are `skills-discovery.json` and `skills-discovery.md` in your working directory.

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
