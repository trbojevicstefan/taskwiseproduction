# Chat Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace chat answer meeting, person, task, summary, transcript, and broad weekly meeting questions from grounded Taskwise data.

**Architecture:** Extend the existing planner/tool/retrieval route boundary. Deterministic agenda answers handle count/list calendar questions; retrieval context remains the source for synthesized meeting/person/task answers.

**Tech Stack:** Next.js App Router route handler, TypeScript, Jest, MongoDB-style collection mocks, existing MCP workspace tools.

## Global Constraints

- Work on `main` because the user explicitly requested main-branch development.
- No production code without a failing regression test first.
- Do not add dependencies.
- Preserve existing authenticated route and workspace authorization behavior.
- Keep anti-hallucination source/action filters in place.

---

### Task 1: Broaden Calendar Planning

**Files:**
- Modify: `src/lib/chat-query-planner.test.ts`
- Modify: `src/lib/chat-query-planner.ts`

**Interfaces:**
- Consumes: `planWorkspaceChatQuestion(question: string, now?: Date)`
- Produces: `rationale: "weekly_meetings_overview"` for broad weekly meeting list/count prompts.

- [ ] **Step 1: Write failing planner test**

Add this test:

```ts
it("routes weekly meeting overview questions to the calendar agenda tool", () => {
  const plan = planWorkspaceChatQuestion(
    "What meetings did we have this week?",
    new Date("2026-07-07T12:00:00.000Z")
  );

  expect(plan).toEqual({
    mode: "workspace_tool",
    toolName: "get_calendar_agenda",
    toolArgs: {
      from: "2026-07-06T00:00:00.000Z",
      to: "2026-07-12T23:59:59.999Z",
    },
    rationale: "weekly_meetings_overview",
  });
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- --runInBand src/lib/chat-query-planner.test.ts`

Expected: FAIL because the planner currently returns `workspace_retrieval`.

- [ ] **Step 3: Implement planner intent**

Add a weekly meeting overview regex and return `weekly_meetings_overview` for `what/list/show meetings this week` prompts while preserving `meeting_count_this_week` for explicit count prompts.

- [ ] **Step 4: Verify green**

Run: `npm test -- --runInBand src/lib/chat-query-planner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/chat-query-planner.ts src/lib/chat-query-planner.test.ts
git commit -m "test: cover weekly meeting overview planning"
```

### Task 2: Enrich Calendar Agenda Context

**Files:**
- Modify: `src/lib/mcp-workspace-tools.test.ts`
- Modify: `src/lib/mcp-workspace-tools.ts`
- Modify: `src/lib/internal-chat-tools.test.ts`
- Modify: `src/lib/internal-chat-tools.ts`

**Interfaces:**
- Produces agenda meeting data with `link` and `attendees: { name: string; email: string | null }[]`.
- Produces chat context rows containing `link=/meetings/<id>` and `attendees=<labels>`.

- [ ] **Step 1: Write failing MCP and internal tool tests**

Assert that `get_calendar_agenda` returns attendee details and `runInternalChatTool` renders `link=/meetings/m1` plus `attendees=Casey Client <casey@client.com>`.

- [ ] **Step 2: Verify red**

Run: `npm test -- --runInBand src/lib/mcp-workspace-tools.test.ts src/lib/internal-chat-tools.test.ts`

Expected: FAIL because attendee details and links are missing.

- [ ] **Step 3: Implement agenda enrichment**

Normalize meeting attendees in `src/lib/mcp-workspace-tools.ts`, include `link: /meetings/${id}`, and render attendee labels in `src/lib/internal-chat-tools.ts`.

- [ ] **Step 4: Verify green**

Run: `npm test -- --runInBand src/lib/mcp-workspace-tools.test.ts src/lib/internal-chat-tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/mcp-workspace-tools.ts src/lib/mcp-workspace-tools.test.ts src/lib/internal-chat-tools.ts src/lib/internal-chat-tools.test.ts
git commit -m "feat: enrich chat agenda context"
```

### Task 3: Deterministic Meeting Overview Answers

**Files:**
- Modify: `src/app/api/ai/chat/route.test.ts`
- Modify: `src/app/api/ai/chat/route.ts`

**Interfaces:**
- Consumes agenda context rows from `runInternalChatTool`.
- Produces deterministic `GeneralChatAnswer` with count, title, date, link, attendees, and `open_meeting` actions.

- [ ] **Step 1: Write failing route test**

Add a test for "What meetings did we have this week?" where the model gives a vague answer but the route response includes all meeting titles, `/meetings/<id>` links, and attendees.

- [ ] **Step 2: Verify red**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`

Expected: FAIL because deterministic answers only include the count.

- [ ] **Step 3: Implement deterministic overview builder**

Parse agenda `MEETING` rows into objects and build an answer:

```text
You had 3 meetings this week:
- Kickoff (2026-07-07) - /meetings/m1 - attendees: Casey Client <casey@client.com>
```

Return meeting sources and `open_meeting` actions for each listed meeting.

- [ ] **Step 4: Verify green**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts
git commit -m "fix: answer weekly meeting overviews deterministically"
```

### Task 4: Enrich Retrieval Context

**Files:**
- Modify: `src/app/api/ai/chat/route.test.ts`
- Modify: `src/app/api/ai/chat/route.ts`

**Interfaces:**
- Consumes `WorkspaceRetrievalResult`.
- Produces context blocks with meeting links, task source meeting links, and person open task counts.

- [ ] **Step 1: Write failing route context test**

Extend the existing context-rendering assertion to expect `link=/meetings/m1`, `sourceMeeting=/meetings/m1` for tasks with `sourceSessionId`, and `openTasks=`.

- [ ] **Step 2: Verify red**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`

Expected: FAIL because route context lacks links.

- [ ] **Step 3: Implement context rendering enrichment**

Update `renderContextBlocks` so meeting lines include `link=/meetings/<id>`, task lines include `sourceMeeting=/meetings/<sourceSessionId>` when available, and person lines preserve open task count.

- [ ] **Step 4: Verify green**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts
git commit -m "feat: enrich workspace chat retrieval context"
```

### Task 5: Final Verification and Push

**Files:**
- No code files unless verification reveals a regression.

- [ ] **Step 1: Run focused chat suite**

Run:

```bash
npm test -- --runInBand src/lib/chat-query-planner.test.ts src/lib/internal-chat-tools.test.ts src/lib/mcp-workspace-tools.test.ts src/app/api/ai/chat/route.test.ts
```

Expected: all listed suites pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test -- --runInBand
npm run lint
npm run typecheck
npm run build
```

Expected: tests, lint, typecheck, and build exit 0. Lint may report existing warnings.

- [ ] **Step 3: Push main**

Run:

```bash
git push origin main
```

Expected: push succeeds and `main` is updated on origin.
