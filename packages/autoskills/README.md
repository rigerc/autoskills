# autoskills

Auto-detect and install the best AI agent skills for your project. One command, zero config.

```bash
npx autoskills
```

`autoskills` scans your project, detects the technologies you use, and installs curated [AI agent skills](https://skills.sh) that make Pi, Cursor, Claude Code, and other AI coding assistants actually understand your stack.

## Quick Start

Run it in your project root:

```bash
npx autoskills
```

That's it. It will:

1. **Scan** your `package.json`, config files, and project structure
2. **Detect** every technology in your stack
3. **Show** an interactive selector with the best skills for your project
4. **Install** them in parallel with live progress

### Skip the prompt

```bash
npx autoskills -y
```

### Preview without installing

```bash
npx autoskills --dry-run
```

### Browse installed skills

```bash
npx autoskills ui
```

Opens a local desk (bound to `127.0.0.1`) to browse the skills installed in the current project.

### Update installed skills

```bash
npx autoskills update --dry-run
npx autoskills update
npx autoskills update -y
```

The update command checks the upstream contents of skills recorded in `skills-lock.json`, lets you select outdated skills, and refreshes their existing agent drawers. Unrelated repository commits do not count as skill updates. The first update of an old registry installation migrates it to upstream tracking. Updates replace installed content and remove files deleted upstream.

### Pi agent

```bash
npx autoskills -a pi
```

Pi skills are linked into `.pi/skills`. The desk discovers both project skills and global skills under `~/.pi/agent/skills`. Claude Code still uses `.claude/skills`; `CLAUDE.md` is never created or modified.

## Options

| Flag              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `-y`, `--yes`     | Skip confirmation prompt, install all detected skills         |
| `--dry-run`       | Show detected skills without installing anything              |
| `--clear-cache`   | Clear the downloaded skills cache                             |
| `-a`, `--agent`   | Install for specific IDEs only (e.g. `cursor claude-code pi`) |
| `-v`, `--verbose` | Show install trace and error details                          |
| `-h`, `--help`    | Show help message                                             |

`autoskills ui` also accepts `--port <number>` and `--no-open`.

## Supported Technologies

`autoskills` detects **123 technologies** and **33 technology combos** from `package.json`, project manifests, Gradle files, and configuration files. The following table covers every technology in `SKILLS_MAP`, including Rails, Django, FastAPI, and pytest.

| Category | Technologies |
| --- | --- |
| Frontend frameworks | React, Next.js, Vue, Nuxt, Pinia, Svelte, Angular, Astro, React Router, TanStack Start, SolidJS |
| Styling, state & UI | Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query, Zustand, Redux, Storybook, GSAP, Three.js, React Three Fiber |
| Languages & runtimes | TypeScript, Node.js, Bun, Dart, Go, Bash, Java, Rust, Ruby, PHP, Python, .NET, C#, Kotlin, Swift, Elixir, C++ |
| Backend frameworks & APIs | Express, Hono, NestJS, Spring Boot, ASP.NET Core, Blazor, ASP.NET Minimal API, Ruby on Rails, Laravel, FastAPI, FastMCP, Django, Flask, Elysia, GraphQL, tRPC, WordPress |
| Mobile, desktop & extensions | Expo, React Native, Flutter, Kotlin Multiplatform, Android, SwiftUI, Tauri, Electron, Chrome Extension |
| Databases, data & ORM | Supabase, Neon Postgres, InstantDB, Prisma, Drizzle ORM, MongoDB, Firebase, Convex, Redis, Redis (Ruby), PostgreSQL, Pydantic, SQLAlchemy, Pandas, NumPy, Scikit-Learn |
| Ruby ecosystem | Sorbet, ActiveAdmin, Devise, Sidekiq, RSpec, RuboCop |
| Python ecosystem | Celery, Requests |
| Cloud, CI & infrastructure | Vercel, Cloudflare, Durable Objects, Cloudflare Agents, Cloudflare AI, Terraform, AWS, Azure, Docker, Kubernetes, Helm, GitHub Actions |
| Testing & quality | Playwright, Vitest, Jest, Cypress, ESLint, Biome, oxlint, Pytest |
| Authentication & payments | Clerk, Better Auth, Stripe |
| AI SDKs & observability | Vercel AI SDK, ElevenLabs, Anthropic SDK, OpenAI SDK, LangChain, Model Context Protocol SDK, Hugging Face, Sentry |
| Build tooling & media | Turborepo, Vite, Remotion |

### Expanded detection signals

| Technology | Detected from |
| --- | --- |
| Docker | `Dockerfile`, `Dockerfile.dev`, `Dockerfile.prod`, `docker-compose.yml`/`.yaml`, `compose.yml`/`.yaml` |
| GitHub Actions | `.github/workflows/` directory |
| Kubernetes | `kustomization.yaml`, `kustomization.yml`, `skaffold.yaml` |
| Helm | `Chart.yaml` |
| MongoDB | `mongodb`, `mongoose`; Python `pymongo`, `motor` |
| Firebase | `firebase`, `firebase-admin`, `firebase-functions`, `firebase.json` |
| Convex | `convex` package or `convex/` directory |
| Redis | `redis`, `ioredis`, `@upstash/redis`; Python `redis` |
| GraphQL | `graphql`, `graphql-request`, `graphql-yoga`, `@apollo/server` |
| tRPC | `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@trpc/next`, `@trpc/tanstack-react-query` |
| TanStack Query | `@tanstack/react-query`, `@tanstack/vue-query`, `@tanstack/solid-query`, `@tanstack/svelte-query`, `@tanstack/query-core` |
| Zustand | `zustand` |
| Redux | `@reduxjs/toolkit`, `redux`, `react-redux` |
| SolidJS | `solid-js` |
| Storybook | `@storybook/*` or `.storybook/` directory |
| Jest | `jest`, `@jest/core` or `jest.config.*` (supported extensions) |
| Cypress | `cypress`, `cypress.config.*`, `cypress.json` |
| ESLint | `eslint`, `eslint.config.*`, `.eslintrc*` |
| Biome | `@biomejs/biome`, `biome.json`, `biome.jsonc` |
| Anthropic SDK | `@anthropic-ai/sdk`; Python `anthropic` |
| OpenAI SDK | `openai` package in JS or Python |
| LangChain | `langchain`, `@langchain/*`; Python LangChain distributions |
| Model Context Protocol SDK | `@modelcontextprotocol/sdk`; Python `mcp` |
| Hugging Face | `@huggingface/inference`, `@huggingface/hub`; Python `huggingface-hub`, `transformers` |
| Sentry | `@sentry/*`; Python `sentry-sdk` |
| Kotlin | Kotlin Gradle plugin declaration (root or recognized module Gradle files) |
| Swift | `Package.swift` |
| Elixir | `mix.exs` |
| C++ | `CMakeLists.txt` |

Python SDK matching reads declared dependencies in `requirements.txt`, `pyproject.toml` (project, optional, dependency groups and Poetry), and `Pipfile`. Package names are matched as complete names, so `other-anthropic-sdk` will not be mistaken for the Anthropic SDK. Directory detection uses project-relative existence checks.

The map can detect a technology without installing a skill: **new entries without a verified, synced upstream skill have an empty `skills` list**. Redis and Swift reuse existing registered skills. New combo entries are currently detection-only until a suitable upstream skill is verified and synced.

### Web Frontend Detection

Even without a framework, `autoskills` scans your file tree for web frontend signals (`.html`, `.css`, `.scss`, `.vue`, `.svelte`, `.jsx`, `.tsx`, `.twig`, `.blade.php`, etc.) and installs skills for frontend design, accessibility, and SEO.

## Combo Detection

When multiple technologies are found together, the following **33 combinations** are detected. Combos select specialist skills when their `skills` lists are populated; the newly added combos do not yet introduce extra downloads.

| Combination | Required technologies |
| --- | --- |
| React Hook Form + Zod | React Hook Form + Zod |
| Next.js + Supabase | Next.js + Supabase |
| React Native + Expo | React Native + Expo |
| Next.js + Vercel AI SDK | Next.js + Vercel AI SDK |
| Next.js + Playwright | Next.js + Playwright |
| React + shadcn/ui | React + shadcn/ui |
| Tailwind CSS + shadcn/ui | Tailwind CSS + shadcn/ui |
| GSAP + React | GSAP + React |
| Cloudflare + Vite | Cloudflare + Vite |
| Node.js + Express | Node.js + Express |
| Next.js + Clerk | Next.js + Clerk |
| Nuxt + Clerk | Nuxt + Clerk |
| Vue + Clerk | Vue + Clerk |
| React + Clerk | React + Clerk |
| Astro + Clerk | Astro + Clerk |
| Expo + Clerk | Expo + Clerk |
| React + React Three Fiber | Three.js + React + React Three Fiber |
| React Router + Clerk | React Router + Clerk |
| TanStack Start + Clerk | TanStack Start + Clerk |
| Chrome Extension + Clerk | Chrome Extension + Clerk |
| SwiftUI + Clerk | SwiftUI + Clerk |
| Android + Clerk | Android + Clerk |
| Ruby on Rails + RSpec | Ruby on Rails + RSpec |
| Ruby on Rails + Sidekiq | Ruby on Rails + Sidekiq |
| React + TanStack Query | React + TanStack Query |
| React + Zustand | React + Zustand |
| Next.js + tRPC | Next.js + tRPC |
| Next.js + Prisma | Next.js + Prisma |
| Next.js + Drizzle | Next.js + Drizzle ORM |
| FastAPI + SQLAlchemy | FastAPI + SQLAlchemy |
| Django + Celery | Django + Celery |
| Docker + Node.js | Docker + Node.js |
| Docker + Python | Docker + Python |

## How It Works

Skills are markdown files that teach AI assistants how to work with specific technologies. `autoskills` uses its curated technology map to select skills, then downloads them and their supporting files directly from their upstream GitHub repositories. Each installation resolves the latest default-branch commit, verifies downloaded bytes against the commit's Git blob hashes, and records upstream provenance and content hashes in `skills-lock.json`.

Installation does not use the locally synced registry or download from an autoskills mirror. The former registry's reviews do not apply to live upstream content. Set `GITHUB_TOKEN` or `GH_TOKEN` for private repositories or higher API limits.

The detection runs entirely locally with zero network requests until installation begins.

## Requirements

- Node.js >= 22.6.0

## License

CC-BY-NC-4.0 — Created by [@midudev](https://github.com/midudev)
