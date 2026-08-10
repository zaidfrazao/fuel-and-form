# Fuel & Form

A personal fitness & nutrition tracker: meal planning with swaps, workout scheduling, and weekly check-in exports.

Built for one user — the owner — with read-only demo sessions so the app can be shown to strangers without exposing real data.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React Server Components, server actions) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | Neon Postgres + Drizzle ORM |
| Testing | Vitest (unit), Playwright (E2E, a11y, visual) |
| Hosting | Vercel |

The PRD names Next.js 15 and a `tailwind.config.ts`; both predate the current majors. See the comment on FUEL-1 for the reasoning behind Next 16 and Tailwind v4's CSS-first tokens.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest |

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/BRAND_GUIDE.md`](docs/BRAND_GUIDE.md) — brand and UX guidelines
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) — testing approach

## Configuration

Secrets are never committed. The owner password, session secret, and database URL live in `.env.local` locally and in Vercel's environment variables in production.
