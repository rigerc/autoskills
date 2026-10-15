<div align="center">

<a href="https://autoskills.sh">
<img src="https://autoskills.sh/og.jpg" alt="autoskills" />
</a>

# autoskills

**One command. Your entire AI skill stack. Installed.**

[autoskills.sh](https://autoskills.sh)

</div>

Scans your project, detects your tech stack, and installs curated AI agent skills automatically.

```bash
npx autoskills
```

## Multiple repositories

To process each Git repository directly inside a directory, use `--repos`:

```bash
npx autoskills --repos ~/projects --dry-run
npx autoskills --repos ~/projects -y
npx autoskills update --repos ~/projects -y
```

Repositories are processed separately, with their own installed skills and
`skills-lock.json`. Directories without a `.git` entry are skipped, including
non-repository folders. Linked Git worktrees are supported.

## How it works

1. Run `npx autoskills` in your project root
2. Your `package.json`, Gradle files, and config files are scanned to detect technologies
3. The best matching AI agent skills are selected from the curated technology map
4. Skills and supporting files are downloaded directly from their upstream GitHub repositories at a resolved commit, verified against that commit’s Git blobs, and installed locally

That's it. No config needed.

## Installation and updates

Skills install into `.agents/skills`, with links for dedicated agent drawers including Pi (`.pi/skills`) and Claude Code (`.claude/skills`). The local desk also discovers Pi's global skills in `~/.pi/agent/skills`. `autoskills` does not create or modify `CLAUDE.md`.

`skills-lock.json` records each skill's upstream repository, path, commit, content hash, and target agents. Installation always reads the current upstream source; locally synced registry copies and old review results are not used for installation.

```bash
npx autoskills update --dry-run  # Check for outdated installed skills
npx autoskills update           # Select and update outdated skills
npx autoskills update -y        # Update all outdated skills
npx autoskills -a pi            # Install for Pi
```

Updates compare the files within each skill, so unrelated repository commits do not trigger updates. Updating replaces the installed skill, removes files deleted upstream, and refreshes its existing agent links or fallback copies. Old `autoskills-registry` lock entries migrate to upstream tracking on their first update. Unsupported lockfile sources are skipped; unavailable sources are reported without preventing other skills from updating.

Downloads are pinned to a single commit and verified against its Git blob hashes. These checks verify the downloaded bytes; live upstream content has not been reviewed by the former synced-registry audit. `GITHUB_TOKEN` or `GH_TOKEN` can be set for private repositories or higher GitHub API limits.

## Options

```
-y, --yes       Skip confirmation prompt
--dry-run       Show what would be installed without installing
--clear-cache   Clear the downloaded skills cache
--repos <dir>  Process Git repositories directly inside a directory
-a, --agent     Install for specific IDEs only (e.g. cursor claude-code pi)
-v, --verbose   Show install trace and error details
-h, --help      Show help message
```

Run `npx autoskills ui` to browse the skills installed in your project in a local web desk.

## Supported Technologies

Detects **151 technologies** and **33 technology combos** across frontend, backend, cloud, mobile, data, and AI stacks. Some detection-only technologies do not have synced skill sources yet.

- **Frontend & UI:** React, Next.js, Vue, Nuxt, Pinia, Svelte, Angular, Astro, SolidJS, Tailwind CSS, shadcn/ui, TanStack Start, TanStack Query, Zustand, Redux, Storybook, GSAP, Three.js
- **Languages & runtimes:** TypeScript, Node.js, Go, Bun, Dart, Ruby, Python, Java, Rust, C#, .NET, PHP, Kotlin, Swift, Elixir, C++
- **Backend & APIs:** Express, Hono, NestJS, Spring Boot, Rails, Django, FastAPI, Flask, Laravel, ASP.NET Core, GraphQL, tRPC, FastMCP
- **Mobile & desktop:** Expo, React Native, Flutter, SwiftUI, Kotlin Multiplatform, Android, Tauri, Electron
- **Databases & data:** Supabase, Neon, InstantDB, MongoDB, Firebase, Convex, Redis, Prisma, Drizzle ORM, SQLAlchemy, Pydantic, PostgreSQL, Pandas, NumPy
- **Auth & payments:** Better Auth, Clerk, Stripe, Devise
- **Testing & quality:** pytest, RSpec, Vitest, Jest, Cypress, Playwright, ESLint, Biome, oxlint, RuboCop
- **Cloud & infrastructure:** Docker, GitHub Actions, Kubernetes, Helm, Terraform, AWS, Azure, Vercel, Cloudflare
- **AI & observability:** OpenAI SDK, Anthropic SDK, LangChain, MCP SDK, Hugging Face, Sentry, Vercel AI SDK, ElevenLabs
- **Developer tooling:** Vite+, Just, Task, Make, mise, direnv, pre-commit, Lefthook, Husky, lint-staged, Changesets, semantic-release, commitlint, Renovate, Dependabot, Nx, moonrepo, Prettier, tsup, tsdown, Rolldown, esbuild, webpack, Rspack, uv, Poetry, Ruff, Bazel
- **Other tooling:** Turborepo, Vite, Remotion, WordPress, Chrome extensions, and more

See the [package's complete technology and combo tables](./packages/autoskills/README.md#supported-technologies).

## Requirements

Node.js >= 22.6

## License

[CC BY-NC 4.0](./LICENSE) — [midudev](https://midu.dev)
