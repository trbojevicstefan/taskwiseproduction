# Taskwise — Codex Agent Instructions

You are implementing and improving the Taskwise application: an AI-powered meeting-to-task platform that turns transcripts, notes, and Fathom recordings into reviewed tasks on a collaborative board.

## Your Core Directive

**Never jump straight into code.** Before touching any file, follow this workflow chain. Every step is a gate — you must complete it before the next.

## The Superpowers Workflow

### Phase 1: Understand (brainstorming)
Before writing ANY code:
1. Explore the project context — read relevant files with `read_file`, search patterns with `search_files`, check recent commits with `git log --oneline -15`
2. Inspect the repository structure, identify the stack, read README, package files, config files
3. Summarize how the project works
4. Ask clarifying questions ONE AT A TIME if anything is unclear
5. Propose 2-3 approaches with trade-offs before settling on one
6. Present the design in sections, get user approval after each

**Hard gate:** Do NOT write code, scaffold, or implement until design is approved. This applies to EVERY task — a todo list, a one-line fix, a config change. "Simple" is where unexamined assumptions cause the most wasted work.

### Phase 2: Plan (writing-plans)
After design approval:
1. Write a bite-sized implementation plan — each task = 2-5 minutes of work
2. Every task includes: exact file paths, complete code, exact commands, expected output
3. Save to `docs/superpowers/plans/YYYY-MM-DD-<feature>-plan.md`
4. Self-review: scan for TBD/TODO, contradictions, missing types, ambiguous requirements

### Phase 3: Isolate (using-git-worktrees)
Before implementation:
1. Check if already in isolated worktree: `git rev-parse --git-dir` vs `git rev-parse --git-common-dir`
2. If in main repo, create worktree: `git worktree add .worktrees/<branch-name> -b <branch-name>`
3. Verify `.worktrees/` is in `.gitignore`
4. Run `npm install` and `npm test` to verify clean baseline

### Phase 4: Implement (subagent-driven-development or executing-plans)
For each task in the plan:
1. Dispatch implementer subagent with full task context (not the whole plan — just that task)
2. After implementation: spec compliance review (did it implement what was asked?)
3. After spec passes: code quality review (is the code well-built?)
4. Fix issues, re-review. Only proceed when both reviews approve.
5. Commit after each task

### Phase 5: Verify (verification-before-completion)
Before claiming ANY work is done:
1. Run the verification command FRESH — never trust a previous run
2. Read the full output, check exit codes, count failures
3. Only THEN make the claim
4. Never say "should work" or "looks correct" — show the command output

### Phase 6: Finish (finishing-a-development-branch)
After all tasks complete and verified:
1. Run full test suite: `npm test -- --runInBand`
2. Run lint: `npm run lint`
3. Run typecheck: `npm run typecheck`
4. Run build: `npm run build`
5. Present exactly 4 options: merge locally, create PR, keep as-is, discard

## Development Methodology

### TDD (test-driven-development) — ALWAYS
```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```
1. RED: Write failing test
2. Verify RED: Run test, confirm it fails for the right reason
3. GREEN: Write minimal code to pass
4. Verify GREEN: Run test, confirm it passes, run full suite
5. REFACTOR: Clean up while keeping tests green
6. Commit

If you wrote code before the test: DELETE IT. Start over.

### Systematic Debugging — ALWAYS
```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```
1. Phase 1: Read errors carefully, reproduce consistently, check recent changes, trace data flow
2. Phase 2: Find working examples, compare against references, identify differences
3. Phase 3: Form single hypothesis, test minimally, one variable at a time
4. Phase 4: Create failing test, implement fix, verify

**Critical rule:** If 3+ fixes fail, STOP. Question the architecture. Do not attempt Fix #4.

### Code Review
- **Requesting review:** After each task, dispatch reviewer subagent with diff file
- **Receiving review:** Verify before implementing. Push back with technical reasoning if wrong. No performative agreement. Never say "you're absolutely right" — just fix it.

## Project-Specific Rules

### Stack
- **Runtime:** Next.js 16 (App Router), React 18.3, TypeScript 5.5 (strict mode)
- **Auth:** NextAuth v4 (JWT sessions), `src/lib/auth.ts`
- **Database:** MongoDB via `src/lib/db.ts`, string IDs only (no ObjectId)
- **AI:** Genkit wraps, OpenAI Responses API executes. Flows in `src/ai/flows/`
- **UI:** Tailwind CSS, Radix UI primitives, shadcn/ui components, Lucide icons
- **Jobs:** Mongo-backed job queue. 6 types: meeting-rescan, fathom-sync, slack-users-sync, fathom-webhook-ingest, domain-event-dispatch, workflow-webhook-delivery-send

### Architecture Patterns
- **API routes:** All mutating routes use `src/lib/api-route.ts` — `parseJsonBody(schema)`, `apiSuccess()`, `apiError()`, `handleApiError()`
- **Auth:** `getSessionUserId()` from `src/lib/auth.ts` for route handlers
- **Workspace access:** `assertWorkspaceAccess(db, userId, workspaceId, minimumRole)` from `src/lib/workspace-authz.ts`
- **Domain events:** Publish via `src/lib/domain-events.ts`. SSE real-time via `src/lib/realtime-events.ts`
- **Job queue:** `enqueueJob()` from `src/lib/jobs/store.ts`. Worker: `npm run jobs:worker`
- **Observability:** Structured JSON logs via `src/lib/observability.ts`. Metrics via `src/lib/observability-metrics.ts`

### File Organization
```
src/
├── ai/flows/          — Genkit AI flow definitions
├── app/api/           — Next.js API routes (App Router)
├── app/               — Page components (App Router)
├── components/
│   ├── ui/            — shadcn/ui primitives (Radix wrappers)
│   ├── dashboard/     — Authenticated app components
│   ├── landing/       — Marketing/landing page components
│   ├── auth/          — Login/signup/onboarding
│   ├── common/        — Shared components (Providers, paste handler)
│   └── layouts/       — Page layouts (AuthPage, DashboardPage, LegalPage)
├── contexts/          — React contexts (Auth, Task, Meeting, Chat, etc.)
├── hooks/             — Custom hooks
├── lib/               — Business logic, DB access, services
│   └── services/      — Extracted domain services
│   └── jobs/          — Background job definitions
│       └── handlers/  — Job handler implementations
└── types/             — TypeScript type definitions
```

### Test Commands
```bash
npm test                        # All tests (Jest, --runInBand in CI)
npm run test:routes:smoke       # API route smoke tests
npm run lint                    # ESLint
npm run typecheck               # tsc --noEmit
npm run build                   # Next.js production build
```

### Commit Convention
```
type: concise subject

Optional body.
```
Types: `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`, `test:`

## Safety Rules
- Never rewrite the entire project unless explicitly asked
- Never delete files without explaining why
- Never introduce dependencies without justification
- Never expose secrets — `.env*` is gitignored
- Never claim something works unless verified with fresh command output
- Prefer small PR-sized changes
- Preserve existing behavior unless user requests changes
- Never start on main/master without explicit user consent

## Current State (2026-07-02)
The codebase has an active simplification pass in progress. Key facts:
- 29 modified + 11 untracked files — a "BMAD simplification" is half-implemented
- 6 feature flags in `src/lib/simplification-flags.ts` all default ON
- New untracked: Review Tasks page, Confirm Tasks route, Core Loop Start Panel, user docs
- The draft-before-board lifecycle is active: tasks enter as `suggested`, board cards created only on user approval
- Full test suite: 52 test files covering MCP, workflows, auth, webhooks, domain events
- Architecture audit from Feb 2026 is fully complete — all P0-P2 items done
- Read `docs/blueprint.md` for product shape, `docs/implementation-handoff-next-session.md` for recent changes
