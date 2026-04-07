# Continuous Improvement Pipeline

## How it works

Improvement sweeps run in dedicated branches, not directly on main.

### Branch naming
- `improve/campfire-YYYY-MM-DD` or `improve/portal-YYYY-MM-DD`
- One branch per sweep session. Squash-merge when done.

### Workflow
1. Agent explores codebase, picks highest-value improvement
2. Makes change on improvement branch
3. Runs `pnpm typecheck && pnpm test` locally to verify
4. Opens PR — CI runs automatically
5. If CI green: auto-merge eligible (with label `improvement`)
6. If CI red: agent fixes before merge

### Merge gates (required to merge)
- [ ] TypeScript compiles clean (`pnpm typecheck`)
- [ ] Tests pass (`pnpm test`)
- [ ] No new `console.error` / `console.warn` introduced in production paths
- [ ] PR description explains what changed and why

### What agents should NOT do
- Push directly to main
- Batch multiple unrelated changes in one PR
- Add dependencies without justification in PR description
- Change visual design without a specific reason
