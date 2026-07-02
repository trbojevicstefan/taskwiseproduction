# Taskwise Improvement Plan — Full Audit

> **For Codex 5.4:** Read `AGENTS.md` first for project context and workflow rules. This plan is structured for subagent-driven development — each phase is a self-contained workstream with bite-sized tasks. Follow TDD, commit after each task, and verify every claim with fresh command output.

**Goal:** Stabilize the active simplification pass, eliminate accumulated technical debt, harden the codebase for production release, and establish quality gates enforced by CI.

**Architecture:** Three-phase approach. Phase A (STABILIZE) commits the half-done simplification work with tests and line-ending fixes. Phase B (DEBT) splits large files, upgrades dependencies, removes build artifacts, and adds missing test coverage. Phase C (HARDEN) adds guardrails, CI expansions, and production readiness checks. Each phase is independently shippable.

**Tech Stack:** Next.js 16, React 18.3, TypeScript 5.5, MongoDB, NextAuth v4, Tailwind CSS, Radix UI, Genkit, Jest

**Audit Date:** 2026-07-02
**Source:** Full codebase inspection (228 source files, 52 test files, 29 modified + 11 untracked files)

---

## Audit Findings

### Finding 1: Simplification pass is half-done and invisible to CI
The BMAD simplification feature has 11 untracked files and 29 modified files. None of the new code is tested. The feature flags in `simplification-flags.ts` all default ON, but the code they gate is untracked — meaning the flags affect nothing in the committed state but will activate instantly when files are added.
**Risk:** Merge conflicts, broken CI on commit, feature regressions without test coverage.

### Finding 2: LF→CRLF line ending pollution
Git warns `LF will be replaced by CRLF` on 28 of 29 modified files. This is a Windows line-ending issue causing noise in diffs and potential CI failures.
**Risk:** Spurious diffs, broken patches, time wasted on formatting noise.

### Finding 3: 4 files over 800 lines with unclear boundaries
- `src/lib/fathom.ts` — 1595 lines (OAuth, tokens, webhooks, connections, installations, sync helpers)
- `src/lib/fathom-ingest.ts` — 1591 lines (webhook parsing, duplicate detection, meeting creation, task extraction, session linking)
- `src/lib/task-completion.ts` — 1312 lines (completion detection, status computation, rollover, board sync)
- `src/lib/meeting-workflow-automation.ts` — 876 lines (workflow matching, payload building, delivery queuing)
**Risk:** Hard to test, hard to review, coupling between unrelated concerns, merge conflicts.

### Finding 4: Build artifacts tracked by git
`tsconfig.tsbuildinfo` (1.1MB) is in git and modified in the working tree. It's an incremental compilation cache that changes on every build.
**Risk:** Merge conflicts on every branch, bloated git history, CI cache invalidation.

### Finding 5: Untested new code
These untracked files have zero test coverage:
- `src/components/dashboard/home/CoreLoopStartPanel.tsx`
- `src/components/dashboard/review/ReviewTasksPageContent.tsx`
- `src/app/review/page.tsx`
- `src/app/api/meetings/[id]/confirm-tasks/route.ts`
- `src/lib/meeting-task-references.ts`
- `src/lib/simplification-flags.ts`
**Risk:** Untested feature surface that gates the entire simplification release.

### Finding 6: Dependency staleness signals
- React 18.3.1 → React 19 is stable (concurrent features, server components improvements)
- Next.js 16.1.1 → bleeding edge, verify no known regressions
- NextAuth v4.24.13 → Auth.js v5 is the successor; migration is significant but v4 is in maintenance

### Finding 7: Client components lack error boundaries
No React Error Boundary components found. Several complex client components (`BoardPageContent`, `MeetingsPageContent`, `SettingsPageContent`) could crash the entire dashboard surface on a single data error.
**Risk:** Full-page white screens on API errors in production.

### Finding 8: API routes lack timeout/abort handling
Long-running routes (rescan, sync) are now job-backed, but intermediate routes (meeting create with AI extraction, task list with hydration) still run synchronous work that could exceed Vercel/Edge function timeouts.
**Risk:** 504 errors on slow MongoDB queries or OpenAI API latency.

---

## Phase A: Stabilize the Simplification Pass (SHIP BLOCKER)

### Task A.1: Fix line endings across all modified files

**Objective:** Eliminate CRLF noise from the working tree so diffs are clean.

**Files:**
- All 29 modified files from `git diff --name-only`
- `src/app/api/meetings/[id]/confirm-tasks/route.ts` (untracked)

**Step 1: Create a `.gitattributes` file at repo root**

Create: `.gitattributes`
```
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.mjs text eol=lf
*.json text eol=lf
*.md text eol=lf
*.css text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
```

**Step 2: Normalize all files**

Run:
```bash
git add --renormalize .
```
Expected: Files re-staged with LF line endings, no CRLF warnings.

**Step 3: Verify**

Run:
```bash
git diff --cached --stat
```
Expected: Only content changes shown, no "LF will be replaced by CRLF" warnings.

**Step 4: Commit**

```bash
git add .gitattributes
git commit -m "chore: enforce LF line endings via .gitattributes"
```

### Task A.2: Add tests for simplification-flags.ts

**Objective:** Unit-test every feature flag function so the flag layer is verified before wiring to UI.

**Files:**
- Create: `src/lib/simplification-flags.test.ts`

**Step 1: Write the test file**

```typescript
import {
  isSimpleNavEnabled,
  isReviewTasksHomeEnabled,
  isAdvancedSettingsEnabled,
  isManualMeetingIngestEnabled,
  isFathomMultiConnectionUiEnabled,
  isMcpUiAdvancedOnlyEnabled,
  getSimplificationFlagSnapshot,
} from "./simplification-flags";

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe("simplification-flags", () => {
  describe("isSimpleNavEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: undefined }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });

    it("returns true for '1'", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "1" }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });

    it("returns false for '0'", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "0" }, () => {
        expect(isSimpleNavEnabled()).toBe(false);
      });
    });

    it("returns false for 'false' (case insensitive)", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "FALSE" }, () => {
        expect(isSimpleNavEnabled()).toBe(false);
      });
    });

    it("defaults to true for unrecognized values", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "maybe" }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });
  });

  // Repeat pattern for all 6 flag functions...
  describe("isReviewTasksHomeEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME: undefined }, () => {
        expect(isReviewTasksHomeEnabled()).toBe(true);
      });
    });
  });

  describe("isAdvancedSettingsEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS: undefined }, () => {
        expect(isAdvancedSettingsEnabled()).toBe(true);
      });
    });
  });

  describe("isManualMeetingIngestEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST: undefined }, () => {
        expect(isManualMeetingIngestEnabled()).toBe(true);
      });
    });
  });

  describe("isFathomMultiConnectionUiEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI: undefined }, () => {
        expect(isFathomMultiConnectionUiEnabled()).toBe(true);
      });
    });
  });

  describe("isMcpUiAdvancedOnlyEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY: undefined }, () => {
        expect(isMcpUiAdvancedOnlyEnabled()).toBe(true);
      });
    });
  });

  describe("getSimplificationFlagSnapshot", () => {
    it("returns an object with all flag values", () => {
      const snapshot = getSimplificationFlagSnapshot();
      expect(snapshot).toEqual({
        simpleNav: true,
        reviewTasksHome: true,
        advancedSettings: true,
        manualMeetingIngest: true,
        fathomMultiConnectionUi: true,
        mcpUiAdvancedOnly: true,
      });
    });
  });
});
```

**Step 2: Run test to verify failure**

Run:
```bash
npx jest src/lib/simplification-flags.test.ts --no-coverage
```
Expected: FAIL — file not found (test file is new, not yet tracked).

Actually the test file will pass on first run since the implementation already exists. Verify:
- All tests pass
- Environment isolation works (no env leaks between tests)

**Step 3: Commit**

```bash
git add src/lib/simplification-flags.test.ts
git commit -m "test: add unit tests for simplification feature flags"
```

### Task A.3: Add tests for meeting-task-references.ts

**Objective:** Test the new draft-before-board lifecycle logic.

**Files:**
- Read: `src/lib/meeting-task-references.ts`
- Create: `src/lib/meeting-task-references.test.ts`

**Step 1: Read the implementation**

Run: `read_file src/lib/meeting-task-references.ts`

**Step 2: Write tests covering the exported functions**

Focus on:
- Extracting task references from meeting documents
- Handling missing/incomplete meeting records
- Status transitions (suggested → active)
- Edge cases: empty tasks, null attendees, missing workspace IDs

**Step 3: Run and verify**

Run:
```bash
npx jest src/lib/meeting-task-references.test.ts --no-coverage
```
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/lib/meeting-task-references.test.ts
git commit -m "test: add unit tests for meeting-task-references"
```

### Task A.4: Add smoke test for confirm-tasks route

**Objective:** Verify the new `POST /api/meetings/[id]/confirm-tasks` endpoint works.

**Files:**
- Read: `src/app/api/meetings/[id]/confirm-tasks/route.ts`
- Create: `src/app/api/meetings/[id]/confirm-tasks/route.test.ts`

**Step 1: Study the route implementation**

Read the route file fully. Identify:
- Auth requirements
- Request body schema
- Response shape
- Side effects (task status changes, board projections)

**Step 2: Write API-level integration tests**

Cover:
- 200: Successful task confirmation
- 401: No auth token
- 403: User not in meeting's workspace
- 400: Invalid task IDs in body
- 404: Meeting not found
- Verify board items are created after confirmation
- Verify task status changes from `suggested` to active

Use the existing test patterns from `src/app/api/meetings/route.ingestion.test.ts` as reference for DB setup/teardown.

**Step 3: Run and verify**

Run:
```bash
npx jest src/app/api/meetings/[id]/confirm-tasks/route.test.ts --no-coverage --runInBand
```
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/app/api/meetings/[id]/confirm-tasks/route.test.ts
git commit -m "test: add integration tests for confirm-tasks endpoint"
```

### Task A.5: Add component smoke tests for new pages

**Objective:** Verify the new Review Tasks page and Core Loop Start Panel render without crashing.

**Files:**
- Read: `src/app/review/page.tsx`, `src/components/dashboard/review/ReviewTasksPageContent.tsx`, `src/components/dashboard/home/CoreLoopStartPanel.tsx`
- Create: `src/app/review/page.test.tsx`, `src/components/dashboard/home/CoreLoopStartPanel.test.tsx`

**Step 1: Write Review Tasks page smoke test**

Since this is a client component that requires contexts (Auth, etc.), test the minimal contract:
- The page exports a default React component
- It renders without throwing

If the component tree is too deeply connected to test shallowly, add a simple existence check:

```typescript
describe("ReviewTasksPageContent", () => {
  it("exports a component that can be imported", async () => {
    const mod = await import("@/components/dashboard/review/ReviewTasksPageContent");
    expect(mod.default).toBeDefined();
  });
});
```

**Step 2: Write CoreLoopStartPanel smoke test**

Same approach — verify the component exists and can be imported.

**Step 3: Run and verify**

Run:
```bash
npx jest src/app/review/page.test.tsx src/components/dashboard/home/CoreLoopStartPanel.test.tsx --no-coverage
```
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/app/review/page.test.tsx src/components/dashboard/home/CoreLoopStartPanel.test.tsx
git commit -m "test: add component smoke tests for Review Tasks and Home panels"
```

### Task A.6: Commit all untracked simplification files and run full CI

**Objective:** Get the simplification pass into version control and verify CI passes.

**Step 1: Review untracked files for secrets**

Run:
```bash
git ls-files --others --exclude-standard | xargs grep -l -E '(api_key|token|secret|password)' 2>/dev/null || echo "No secrets found"
```
Expected: No secrets found. If any are found, review and exclude before committing.

**Step 2: Stage all untracked files**

Run:
```bash
git add docs/advanced-operator-guide.md
git add docs/user-connect-fathom.md
git add docs/user-create-tasks-from-meeting.md
git add docs/user-review-and-approve-tasks.md
git add docs/user-use-board.md
git add src/app/api/meetings/[id]/confirm-tasks/route.ts
git add src/app/review/page.tsx
git add src/components/dashboard/home/CoreLoopStartPanel.tsx
git add src/components/dashboard/review/ReviewTasksPageContent.tsx
git add src/lib/meeting-task-references.ts
git add src/lib/simplification-flags.ts
```

**Step 3: Stage all modified files**

Run:
```bash
git add -u
```

**Step 4: Run full CI pipeline locally**

Run:
```bash
npm run lint && echo "LINT: PASS" || echo "LINT: FAIL"
```
If lint fails, fix ALL errors before proceeding.

Run:
```bash
npm run typecheck && echo "TYPECHECK: PASS" || echo "TYPECHECK: FAIL"
```
If typecheck fails, fix ALL errors before proceeding.

Run:
```bash
npm test -- --runInBand && echo "TEST: PASS" || echo "TEST: FAIL"
```
If tests fail, fix ALL failures before proceeding.

Run:
```bash
npm run build && echo "BUILD: PASS" || echo "BUILD: FAIL"
```
If build fails, fix ALL errors before proceeding.

**Step 5: Commit**

Only after ALL FOUR gates pass:

```bash
git commit -m "feat: complete BMAD simplification pass

- Add Review Tasks queue with draft-before-board lifecycle
- Add Core Loop Start Panel (paste notes, connect Fathom, try sample)
- Simplify navigation to Home, Review, Board, People
- Split Settings into sections (Profile, Workspace, Integrations, Preferences, Advanced)
- Add meeting task confirmation flow (POST /api/meetings/[id]/confirm-tasks)
- Add simplification feature flags
- Add user documentation for core workflows"
```

### Task A.7: Verify Phase A completion

**Step 1: Clean working tree**

Run:
```bash
git status --short
```
Expected: Empty output (no modified or untracked files).

**Step 2: Run full suite one final time**

Run:
```bash
npm run lint && npm run typecheck && npm test -- --runInBand && npm run build && npm run test:routes:smoke
```
Expected: All pass with zero errors.

---

## Phase B: Technical Debt Cleanup

### Task B.1: Remove tsconfig.tsbuildinfo from git tracking

**Objective:** Stop tracking the build artifact and prevent future re-adds.

**Files:**
- Modify: `.gitignore`

**Step 1: Add to .gitignore**

Append to `.gitignore`:
```
# TypeScript build cache
tsconfig.tsbuildinfo
*.tsbuildinfo
```

**Step 2: Remove from git tracking (keep file on disk)**

Run:
```bash
git rm --cached tsconfig.tsbuildinfo
```

**Step 3: Verify**

Run:
```bash
git status --short
```
Expected: `.gitignore` modified, `tsconfig.tsbuildinfo` deleted (staged), and the file still exists on disk but no longer tracked.

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: stop tracking tsconfig.tsbuildinfo build artifact"
```

### Task B.2: Split src/lib/fathom.ts (1595 lines)

**Objective:** Break the monolithic Fathom module into focused submodules.

**Current structure of `src/lib/fathom.ts`:**
- OAuth token management (get, refresh, revoke)
- Webhook token/secret management
- Connection record helpers
- Fathom API client (list calls, get recording, get transcript)
- Installation compatibility layer
- Webhook unregistration

**Target structure:**
```
src/lib/fathom/
├── index.ts           — Re-exports from submodules (backward compat)
├── oauth.ts           — OAuth token management (~200 lines)
├── api-client.ts      — Fathom REST API calls (~300 lines)
├── webhooks.ts        — Webhook token/secret management (~200 lines)
├── connections.ts     — Connection record helpers (~150 lines)
└── types.ts           — Shared types (~100 lines)
```

**Step 1: Write failing tests for each submodule boundary**

Before extracting, write tests that import from the current `fathom.ts` and verify the functions work. These tests become the contract that the refactored code must maintain.

Create: `src/lib/fathom/oauth.test.ts`, `src/lib/fathom/api-client.test.ts`

Run:
```bash
npx jest src/lib/fathom/ --no-coverage
```
Expected: FAIL — files don't exist yet.

**Step 2: Extract types to `src/lib/fathom/types.ts`**

Move all type definitions (interfaces, type aliases) from `fathom.ts` to `types.ts`.
Update `fathom.ts` to re-export from `types.ts`.

Run:
```bash
npx jest src/lib/fathom/ --no-coverage
```
Expected: Existing tests still PASS (backward compat maintained).

**Step 3: Extract OAuth logic to `src/lib/fathom/oauth.ts`**

Move: token refresh, token revoke, getValidAccessToken, creds helpers.
Update `fathom.ts` to re-export from `oauth.ts`.

Run:
```bash
npx jest src/lib/fathom/ --no-coverage
```
Expected: All tests PASS.

**Step 4: Extract API client to `src/lib/fathom/api-client.ts`**

Move: listCalls, getRecording, getTranscript, getAccount.
Update `fathom.ts` to re-export from `api-client.ts`.

**Step 5: Extract webhook logic to `src/lib/fathom/webhooks.ts`**

Move: webhook token generation, secret management, unregistration.
Update `fathom.ts` to re-export from `webhooks.ts`.

**Step 6: Create barrel export at `src/lib/fathom/index.ts`**

Content: re-export everything from submodules. Check all existing consumers still compile.

Run:
```bash
npm run typecheck
```
Expected: PASS.

**Step 7: Update all existing imports (if needed)**

If any file imports from `@/lib/fathom`, the barrel index ensures backward compat. If any file imports specific submodules, verify they resolve.

Run:
```bash
npm run lint && npm run typecheck && npm test -- --runInBand
```
Expected: All PASS.

**Step 8: Commit after each submodule extraction**

Each submodule gets its own commit:
```bash
git add src/lib/fathom/
git commit -m "refactor: extract Fathom OAuth logic to submodule"

git add src/lib/fathom/
git commit -m "refactor: extract Fathom API client to submodule"

git add src/lib/fathom/
git commit -m "refactor: extract Fathom webhook logic to submodule"
```

### Task B.3: Split src/lib/fathom-ingest.ts (1591 lines)

**Objective:** Separate webhook parsing, duplicate detection, meeting creation, and task extraction.

**Target structure:**
```
src/lib/fathom-ingest/
├── index.ts                — Barrel export
├── webhook-parser.ts       — Raw webhook → typed payload (~200 lines)
├── deduplication.ts        — Recording hash matching (~150 lines)
├── meeting-builder.ts      — Payload → meeting document (~300 lines)
├── task-extraction.ts      — Meeting → extracted tasks (~250 lines)
├── session-linking.ts      — Meeting → chat session linking (~150 lines)
└── types.ts                — Shared types
```

Follow the same TDD extraction pattern as Task B.2:
1. Write tests against current monolithic module
2. Extract types to `types.ts`
3. Extract one submodule at a time
4. Verify tests pass after each extraction
5. Update barrel index for backward compat
6. Commit after each submodule

### Task B.4: Split src/lib/task-completion.ts (1312 lines)

**Objective:** Separate completion detection, status computation, rollover, and board sync.

**Target structure:**
```
src/lib/task-completion/
├── index.ts              — Barrel export
├── detection.ts          — Completion detection logic (~300 lines)
├── status.ts             — Status computation and transitions (~250 lines)
├── rollover.ts           — Task rollover logic (~200 lines)
├── board-sync.ts         — Board status synchronization (~200 lines)
└── types.ts              — Shared types
```

Follow the same TDD extraction pattern.

### Task B.5: Split src/lib/meeting-workflow-automation.ts (876 lines)

**Objective:** Separate workflow matching, payload building, and delivery queuing.

**Target structure:**
```
src/lib/workflow-automation/
├── index.ts              — Barrel export
├── matcher.ts            — Workflow filter evaluation (~200 lines)
├── payload-builder.ts    — Canonical meeting payload construction (~200 lines)
├── delivery.ts           — Delivery record creation and queuing (~200 lines)
└── types.ts              — Shared types
```

Follow the same TDD extraction pattern.

### Task B.6: Add React Error Boundaries

**Objective:** Prevent full-page crashes on component errors.

**Files:**
- Create: `src/components/common/ErrorBoundary.tsx`
- Modify: `src/components/layouts/DashboardPageLayout.tsx` (or `Providers.tsx`)

**Step 1: Create ErrorBoundary component**

```tsx
"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            Something went wrong. Please refresh the page.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
```

**Step 2: Write test**

Create: `src/components/common/ErrorBoundary.test.tsx`

Test:
- Renders children normally
- Catches thrown errors
- Shows fallback when error occurs
- Logs error to console

**Step 3: Wrap dashboard sections**

In the main dashboard layout, wrap each major content section:

```tsx
<ErrorBoundary>
  <BoardPageContent />
</ErrorBoundary>
```

Apply to: BoardPageContent, MeetingsPageContent, SettingsPageContent, PeoplePageContent, ReviewTasksPageContent, CoreLoopStartPanel.

**Step 4: Commit**

```bash
git add src/components/common/ErrorBoundary.tsx src/components/common/ErrorBoundary.test.tsx
git commit -m "feat: add React Error Boundary component"
```

### Task B.7: Add API route timeout handling

**Objective:** Add timeout guards to synchronous API routes that could hang.

**Files to audit and possibly modify:**
- `src/app/api/meetings/route.ts` (AI extraction during meeting creation)
- `src/app/api/tasks/route.ts` (list hydration)
- `src/app/api/tasks/sync/route.ts`
- `src/app/api/people/[id]/tasks/route.ts`

**Step 1: Add timeout wrapper utility**

Create: `src/lib/api-timeout.ts`

```typescript
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
};
```

**Step 2: Apply to meeting creation route**

In `src/app/api/meetings/route.ts`, wrap the AI extraction call:

```typescript
const tasks = await withTimeout(
  extractTasks(transcript),
  25_000,
  "meeting-task-extraction"
);
```

**Step 3: Write tests**

Create: `src/lib/api-timeout.test.ts`

Test:
- Resolves when promise completes within timeout
- Rejects when timeout exceeded
- Cleans up timer on resolution

**Step 4: Commit**

```bash
git add src/lib/api-timeout.ts src/lib/api-timeout.test.ts
git commit -m "feat: add API route timeout wrapper"
```

---

## Phase C: Hardening and Production Readiness

### Task C.1: Add pre-commit hook for lint-staged

**Objective:** Catch lint errors before they reach CI.

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json` (add `lint-staged` config and `prepare` script)

**Step 1: Install lint-staged and husky**

Run:
```bash
npm install --save-dev lint-staged husky
npx husky init
```

**Step 2: Configure lint-staged in package.json**

Add to `package.json`:
```json
{
  "lint-staged": {
    "*.{ts,tsx,js,mjs}": ["eslint --fix --no-warn-ignored", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

Add `"prepare": "husky"` to scripts.

**Step 3: Create pre-commit hook**

Write `.husky/pre-commit`:
```bash
npx lint-staged
```

**Step 4: Commit**

```bash
git add .husky/pre-commit package.json package-lock.json
git commit -m "chore: add pre-commit lint-staged hook"
```

### Task C.2: Add gitignore for worktree directories

**Objective:** Prevent worktree content from being accidentally committed.

**Files:**
- Modify: `.gitignore`

**Step 1: Append to .gitignore**

```
# Git worktrees
.worktrees/
worktrees/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore worktree directories"
```

### Task C.3: Add devcontainer configuration

**Objective:** Standardize development environment for all contributors.

**Files:**
- Create: `.devcontainer/devcontainer.json`

```json
{
  "name": "Taskwise",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:20",
  "postCreateCommand": "npm install",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "bradlc.vscode-tailwindcss"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "files.eol": "\n"
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add .devcontainer/
git commit -m "chore: add devcontainer configuration"
```

### Task C.4: Audit and harden .env.example

**Objective:** Ensure `.env.example` documents all required variables and excludes secrets.

**Files:**
- Read: `.env.example`, `.env.local` (check pattern, don't print secrets)
- Modify: `.env.example` (if gaps found)

**Step 1: Compare .env.example with .env.local variable names**

Run:
```bash
grep -o '^[A-Z_]*=' .env.local | sed 's/=//' | sort > /tmp/env-local-vars.txt
grep -o '^[A-Z_]*=' .env.example | sed 's/=//' | sort > /tmp/env-example-vars.txt
diff /tmp/env-local-vars.txt /tmp/env-example-vars.txt
```

Expected: All variables in `.env.local` should appear (with placeholder values, never real secrets) in `.env.example`.

**Step 2: Fill gaps**

If any variable in `.env.local` is missing from `.env.example`, add it with `<your-value-here>` placeholder.

**Step 3: Verify no secrets leaked**

Run:
```bash
grep -E '(sk-|ghp_|xox[bpras]-|ya29\.|eyJ)' .env.example
```
Expected: No output (no real tokens/keys in example file).

**Step 4: Commit (if changes made)**

```bash
git add .env.example
git commit -m "docs: update .env.example with all required variables"
```

### Task C.5: Run full audit verification

**Objective:** Confirm all phases are complete and the codebase is clean.

**Step 1: Check for remaining issues**

Run:
```bash
# No CRLF warnings
git diff --check

# No untracked files
git ls-files --others --exclude-standard

# No files over 800 lines (after Phase B)
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | awk '$1 > 800 {print}'

# No tracked build artifacts
git ls-files | grep tsbuildinfo

# All tests pass
npm test -- --runInBand
```

**Step 2: Run full CI pipeline**

```bash
npm run lint && npm run typecheck && npm run build && npm test -- --runInBand && npm run test:routes:smoke
```
Expected: ALL PASS.

---

## Summary

| Phase | Tasks | Est. Time | Gates |
|-------|-------|-----------|-------|
| A: Stabilize | 7 | 2-3 hours | All untracked code committed + tested + CI green |
| B: Debt | 7 | 4-6 hours | All files under 500 lines + error boundaries + timeouts |
| C: Harden | 5 | 1-2 hours | Pre-commit hooks + devcontainer + .env audit |

**Total:** 19 tasks across 3 phases. Each phase is independently shippable.

**Before starting Phase B or C:** Verify Phase A is complete and CI is green.

**Key principle:** Never proceed with failing CI. Each commit must pass lint + typecheck + test + build.
