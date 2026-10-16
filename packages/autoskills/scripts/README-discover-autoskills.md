# Discover skills from external registries

This is a **maintainer-only, read-only discovery tool**. It searches [Skills Directory](https://www.skillsdirectory.com/docs/registry-api) and [SkillsMD](https://skillsmd.dev/api.html) for new skills that match AutoSkills' existing technology detection map.

## Usage

From the repository root, with Node.js 22.6+:

```bash
# Discover skills. In a terminal, configure discovery, then review results.
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

## Interactive discovery setup (TTY)

When run **without arguments** in a terminal, discovery prompts for the options rather than immediately launching a large search:

```bash
pnpm --dir packages/autoskills discover:skills
```

The wizard asks for a **source**, **technologies**, **search intensity**, **optional advanced settings**, and **whether to review matches interactively**. Press **Enter** to accept each default:

- **Source:** `both` (Skills Directory + SkillsMD) if no Vercel token is available; `all` (including Skills.sh) if `VERCEL_OIDC_TOKEN` is set. `skillssh` and `all` are unavailable without a token.
- **Technologies:** `all` by default. Choose `gaps` to search only technologies with no registered skills, enter comma-separated technology IDs (e.g. `react,playwright`), or `?` to list valid IDs.
- **Search intensity:** `balanced` by default (30 directory searches, 15 searches per other source, 30 unique GitHub repository checks). `quick` uses smaller budgets; `thorough` expands them.
- **Advanced options:** `no` by default. Choose `yes` to access grouped settings; the wizard returns to a menu after each group so you can configure multiple groups or choose `done`.
- **Review:** `yes` by default, opening the existing interactive result browser at the end. If you passed `--no-interactive`, it defaults to `no`.

### Advanced settings

Select **yes** at "Customize advanced options" to open the group menu:

| Group | Configurable fields |
| --- | --- |
| `quality` | Minimum relevance score, GitHub repository verification budget, detail-enrichment budget, maximum Markdown suggestions per technology, API page size |
| `providers` | Queries per technology, then only the selected providers: Skills Directory sort/search budget/page counts/category, SkillsMD filter/pages/searches, Skills.sh leaderboard view/pages/searches/curated toggle |
| `cache` | Enable/disable discovery cache, cache TTL, cache directory, clear existing discovery cache |
| `files` | JSON/Markdown report paths and shortlisted JSON/Markdown export paths |
| `done` | Return to the main wizard and start discovery after confirming review mode |

All prompts show the **current value**. Enter preserves that value; typing a new one overrides it. Search intensity presets remain convenient starting points, and explicit CLI search-budget flags take precedence over the preset until you edit those values in the advanced menu. Invalid numbers, choices and file names are rejected with an inline prompt to retry.

For example, to focus on well-matched Skills.sh results, select `skillssh` as the source, choose `balanced`, then customize `quality` (increase the minimum match score) and `providers` (choose leaderboard ordering and enable/disable curated results). The Skills.sh option requires a configured `VERCEL_OIDC_TOKEN`.

The wizard initializes the response cache **after** setup so caching changes are applied to the search. Report and selected-export paths must not conflict when interactive review is enabled.

You can force the setup even when passing CLI flags:

```bash
pnpm --dir packages/autoskills discover:skills --configure --tech react
```

Explicit search-budget flags take precedence over wizard intensity presets. Existing CLI flags continue to work without questions, and **non-TTY / CI runs never open the setup** (use `--no-interactive` for fully non-interactive review as well). `--configure` fails clearly when no terminal is attached.

## Interactive terminal review

When stdin and stdout are TTYs, `discover:skills` automatically presents an interactive, keyboard-controlled result browser **after** writing the normal reports. Force it with `--interactive`, or disable it with `--no-interactive`. In CI or piped commands, the default is non-interactive.

- **Up/Down** (or **j/k**) navigates matched skills; **Enter** shows upstream metadata and the score's matching evidence. Detail text can be scrolled.
- **/** searches across names, descriptions, category, tags, and scoring evidence. **t** cycles technology matches, **s** cycles registry sources, and **v** shows selected results.
- **Space** toggles a candidate, **a** selects all currently visible results, and **u** clears the selection.
- **e** exports the shortlist to `skills-discovery.selected.json` and `skills-discovery.selected.md` (overridable with `--selection-output` and `--selection-markdown`).
- **?** shows keyboard help; **q** exits without modifying the registry.

Selecting or exporting a skill is **not** approval, installation, or a change to `skills-map.ts`. Exports are intended solely for maintainer review. If terminal review is unavailable, run the batch command and inspect the generated Markdown report.

## Skills.sh API (authenticated)

[Skills.sh API documentation](https://www.skills.sh/docs/api) requires a **Vercel OIDC bearer token**, not a personal Skills.sh API key. Its base URL is `https://skills.sh/api/v1`. This provider is opt-in to preserve existing unauthenticated discovery runs.

### Get a Vercel token locally

1. Install the [Vercel CLI](https://vercel.com/docs/cli), then run `vercel login`. Create or select a Vercel project to associate with the token.
2. In the Vercel dashboard for that project, enable **OIDC Federation** in the project's **Settings → Security / OIDC Federation** area (label may vary). Refer to [Vercel OIDC documentation](https://vercel.com/docs/oidc).
3. From the AutoSkills checkout, link that directory to your Vercel project and pull its development environment:

```bash
vercel login
vercel link
vercel env pull .env.local
```

The pull command puts a short-lived `VERCEL_OIDC_TOKEN` in `.env.local`. A freshly pulled local token is normally valid for about **12 hours**. The discovery CLI does **not** load `.env.local` automatically, so export it in the shell before invoking the script:

```bash
# Bash / zsh. Node.js >=22.6 already required by AutoSkills.
export VERCEL_OIDC_TOKEN="$(node -e "process.loadEnvFile('.env.local'); process.stdout.write(process.env.VERCEL_OIDC_TOKEN || '')")"

# Search only Skills.sh for React, using authenticated requests.
pnpm --dir packages/autoskills discover:skills --source skillssh --tech react --no-interactive

# Search all three providers (Skills Directory + SkillsMD + Skills.sh).
pnpm --dir packages/autoskills discover:skills --source all --tech react,playwright --no-interactive
```

On PowerShell, replace the `export` line with:

```powershell
$env:VERCEL_OIDC_TOKEN = node -e "process.loadEnvFile('.env.local'); process.stdout.write(process.env.VERCEL_OIDC_TOKEN || '')"
```

If Skills.sh responds with **401**, rerun `vercel env pull .env.local` and re-export the token. For Vercel-hosted workloads, the [`@vercel/oidc` helper](https://www.skills.sh/docs/api) can refresh tokens automatically; this dependency-free maintainer script instead reads the current environment variable at request time.

**Credential hygiene:** Never commit `.env.local`, paste tokens into issues, or print them in logs. The root `.gitignore` excludes `.env.local`. Token values are not placed in reports and are only used as bearer authorization headers (the shared discovery cache keys authenticated responses by a one-way hash of the token).

### Provider selection and controls

- `--source skillssh`: Skills.sh only, requires `VERCEL_OIDC_TOKEN`.
- `--source all`: all three sources, requires `VERCEL_OIDC_TOKEN`.
- `--source both` (default): original Skills Directory and SkillsMD sources; no Vercel token necessary.
- `--skillssh-view trending|hot|all-time`: leaderboard ordering; `trending` by default.
- `--skillssh-pages N`: leaderboard pages (default 1, starting at page 0).
- `--skillssh-searches N`: bounded technology searches (default 25).
- `--no-skillssh-curated`: skip the first-party curated set.
- `--skillssh-api URL`: override the Skills.sh API endpoint for offline tests.

The provider reads the documented `/skills`, `/skills/search`, and `/skills/curated` endpoints. It accepts only GitHub-sourced entries and still verifies their `SKILL.md` against GitHub's immutable Git blob before suggesting them. Discovery does not perform a security audit, installation, or registry modification.

## Matching

The script reads `packages/autoskills/skills-map.ts`, combines skill names, descriptions, tags, categories, package/config-file detection signals, repository metadata, and verification/popularity metadata, then assigns a score and explains the evidence. It merges duplicate candidates from both APIs, excludes already-listed skills and basename conflicts, and checks upstream GitHub trees for an actual `SKILL.md` before suggesting a full `owner/repository/skill` reference.

API popularity or a matching tag **does not guarantee** that a skill is safe, high-quality, or applicable. Review results manually. Do not auto-add candidates to `skills-map.ts` or the curated registry. After approving a candidate, use the repository's existing `sync:skills` safety review and `validate:registry` workflow.

## Test

Offline integration coverage, using mocked registry and GitHub APIs:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --test packages/autoskills/tests/discover-autoskills.test.ts
```

Skills Directory and SkillsMD do not require API credentials. Skills.sh requires `VERCEL_OIDC_TOKEN` (see above). Set `GITHUB_TOKEN` or `GH_TOKEN` if GitHub API rate limits become restrictive.
