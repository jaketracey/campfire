# Campfire — Continuous Improvement

You are running an autonomous improvement sweep on the Campfire AI companion app (ignite.cam). Your job is to explore the codebase, identify the highest-value improvements, implement them, and keep the product stable.

## How to Work

1. **Explore first** — read recent git log, browse key files, check for TODOs/FIXMEs/console.errors. Form your own view of what needs fixing.
2. **Pick one high-value improvement** — prioritise by: user impact > code correctness > polish. Avoid cosmetic-only changes.
3. **Read the relevant files** before touching anything.
4. **Implement the fix** — keep changes minimal and focused. One thing at a time.
5. **Verify** — run `pnpm typecheck` (or package-level typecheck) before committing. If tests exist for the area, run them.
6. **Commit** with a clear message describing what changed and why.
7. **Repeat** — next iteration, re-explore and pick the next best thing.

## Rules

- No static backlog. Explore and decide fresh each sweep.
- One focused change per commit. No batching unrelated fixes.
- Do not refactor surrounding code beyond what the fix requires.
- Do not add dependencies unless clearly necessary and worth the cost.
- Preserve the dark theme and existing visual design unless the fix specifically requires a change.
- If something requires a backend endpoint that does not exist, either create it or skip and note why.
- Tests: if you change logic, add or update a test. Do not leave coverage gaps.
- The app uses: Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI, Framer Motion, shadcn/ui.
- Packages: `packages/web` (Next.js), `packages/mobile` (React Native/Expo), `packages/gateway` (Fastify), `packages/orchestrator`, `packages/workers`, `packages/shared`.

## Stack at a glance

- Auth: custom JWT + Google OAuth
- DB: Postgres via Prisma
- AI: Anthropic (orchestrator), FAL.ai (image gen)
- Payments: Stripe
- Voice: LiveKit
- Mobile: Expo WebView wrapping the web app

## What good looks like

- Users can chat, call, gift, and play games with their companion without hitting broken states
- Auth flows work end-to-end (login, signup, forgot password, 2FA)
- Mobile app feels native — keyboard avoidance, safe areas, haptics, no flash of unstyled content
- No hardcoded brand references to "Ignite" — everything says "Campfire"
- TypeScript compiles clean, no console errors in production paths

