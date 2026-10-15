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
-a, --agent     Install for specific IDEs only (e.g. cursor claude-code pi)
-v, --verbose   Show install trace and error details
-h, --help      Show help message
```

Run `npx autoskills ui` to browse the skills installed in your project in a local web desk.

## Supported Technologies

Built to work across modern frontend, backend, mobile, cloud, and media stacks.

- **Frameworks & UI:** React, Next.js, Vue, Nuxt, Svelte, Angular, Astro, Tailwind CSS, shadcn/ui, GSAP, Three.js
- **Languages & Runtimes:** TypeScript, Node.js, Go, Bun, Dart
- **Backend & APIs:** Express, Hono, NestJS, Spring Boot
- **Mobile & Desktop:** Expo, React Native, Flutter, SwiftUI, Android, Kotlin Multiplatform, Tauri, Electron
- **Data & Storage:** Supabase, Neon, Prisma, Drizzle ORM, Zod, React Hook Form
- **Auth & Billing:** Better Auth, Clerk, Stripe
- **Testing:** Vitest, Playwright
- **Cloud & Infrastructure:** Vercel, Vercel AI SDK, Cloudflare, Durable Objects, Cloudflare Agents, Cloudflare AI, AWS, Azure, Terraform
- **Tooling:** Turborepo, Vite, oxlint
- **Media & AI:** Remotion, ElevenLabs

## Requirements

Node.js >= 22.6

## License

[CC BY-NC 4.0](./LICENSE) — [midudev](https://midu.dev)
