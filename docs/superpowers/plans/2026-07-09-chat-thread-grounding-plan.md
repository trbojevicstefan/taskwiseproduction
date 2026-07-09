# Chat Thread Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace chat and meeting follow-ups behave like a grounded thread across meetings, people, clients, and tasks.

**Architecture:** Add a deterministic thread-context helper that derives grounded entities from recent chat history, then integrate it into `/api/ai/chat` so vague follow-ups can be resolved before planner selection and retrieval. Keep the current meeting flow, retrieval flow, and anti-hallucination filtering intact while expanding regression coverage.

**Tech Stack:** Next.js App Router, TypeScript 5.5, Jest, MongoDB-backed route orchestration, Genkit/OpenAI-backed chat flows.

## Global Constraints

- Preserve current meeting-scoped transcript-grounded behavior.
- Do not add a new persistence schema for thread state in this pass.
- Never guess when a follow-up reference is ambiguous.
- Keep current anti-hallucination source and action filtering in `src/app/api/ai/chat/route.ts`.
- Use TDD: no production code without a failing test first.

---

## File Structure

- Create `src/lib/chat-thread-context.ts`
  - Single responsibility: derive recent grounded entities from chat history and resolve follow-up references.
- Create `src/lib/chat-thread-context.test.ts`
  - Single responsibility: unit coverage for extraction, enrichment, and ambiguity handling.
- Modify `src/app/api/ai/chat/route.ts`
  - Integrate thread-context resolution ahead of planner selection and retrieval.
- Modify `src/app/api/ai/chat/route.test.ts`
  - End-to-end multi-turn route regressions covering meetings, people, clients, tasks, and ambiguity cases.

### Task 1: Add Thread Context Unit Tests

**Files:**
- Create: `src/lib/chat-thread-context.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `buildThreadContext(history: ChatHistoryEntry[] | undefined): ChatThreadContext`
  - `resolveThreadFollowUp(question: string, context: ChatThreadContext): ThreadFollowUpResolution`

- [ ] **Step 1: Write the failing test**

```ts
import {
  buildThreadContext,
  resolveThreadFollowUp,
} from "@/lib/chat-thread-context";

describe("chat thread context", () => {
  it("resolves ordinal meeting follow-ups from grounded assistant sources", () => {
    const context = buildThreadContext([
      { role: "assistant", text: "You had 2 meetings this week.", sources: [
        { sourceType: "meeting", sourceId: "m1", title: "Kickoff", snippet: "Kickoff" },
        { sourceType: "meeting", sourceId: "m2", title: "Retro", snippet: "Retro" },
      ]},
    ] as any);

    expect(resolveThreadFollowUp("Who attended the first one?", context)).toEqual(
      expect.objectContaining({
        kind: "meeting",
        meetingId: "m1",
      })
    );
  });

  it("resolves person follow-ups into retrieval enrichment", () => {
    const context = buildThreadContext([
      { role: "assistant", text: "Stefan mentioned pricing.", sources: [
        { sourceType: "person", sourceId: "p1", title: "Stefan Ionescu", snippet: "Stefan Ionescu" },
      ]},
    ] as any);

    expect(resolveThreadFollowUp("What tasks does he own?", context)).toEqual(
      expect.objectContaining({
        kind: "retrieval_enrichment",
        entityId: "p1",
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/chat-thread-context.test.ts`
Expected: FAIL with module or export errors for `chat-thread-context`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ThreadFollowUpResolution =
  | { kind: "none" }
  | { kind: "meeting"; meetingId: string }
  | { kind: "retrieval_enrichment"; entityId: string; enrichedQuestion: string };

export type ChatThreadContext = {
  meetings: Array<{ meetingId: string; title: string }>;
  people: Array<{ entityId: string; name: string }>;
};

export function buildThreadContext(history: any[] | undefined): ChatThreadContext {
  return { meetings: [], people: [] };
}

export function resolveThreadFollowUp(
  _question: string,
  _context: ChatThreadContext
): ThreadFollowUpResolution {
  return { kind: "none" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/lib/chat-thread-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-thread-context.test.ts src/lib/chat-thread-context.ts
git commit -m "test: add chat thread context coverage"
```

### Task 2: Implement Thread Context Resolution

**Files:**
- Create: `src/lib/chat-thread-context.ts`
- Modify: `src/lib/chat-thread-context.test.ts`

**Interfaces:**
- Consumes:
  - `ChatHistoryEntry[] | undefined`
  - question string
- Produces:
  - `buildThreadContext(history)`
  - `resolveThreadFollowUp(question, context)`
  - `enrichQuestionWithResolvedEntity(question, resolution)`

- [ ] **Step 1: Write the failing test**

```ts
it("returns ambiguity instead of guessing when 'that meeting' could mean multiple meetings", () => {
  const context = buildThreadContext([
    { role: "assistant", text: "Two meetings matter here.", sources: [
      { sourceType: "meeting", sourceId: "m1", title: "Kickoff", snippet: "Kickoff" },
      { sourceType: "meeting", sourceId: "m2", title: "Retro", snippet: "Retro" },
    ]},
  ] as any);

  expect(resolveThreadFollowUp("What happened in that meeting?", context)).toEqual(
    expect.objectContaining({ kind: "ambiguous" })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/chat-thread-context.test.ts`
Expected: FAIL because ambiguity handling is not implemented.

- [ ] **Step 3: Write minimal implementation**

```ts
const ORDINAL_MAP = new Map([
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["last", -1],
]);

// Parse grounded assistant turns, keep ordered meeting/person/client/task entities,
// then resolve singular and ordinal references conservatively.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/lib/chat-thread-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-thread-context.ts src/lib/chat-thread-context.test.ts
git commit -m "feat: add chat follow-up reference resolution"
```

### Task 3: Route Meeting Follow-Ups Through Thread Resolution

**Files:**
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/app/api/ai/chat/route.test.ts`

**Interfaces:**
- Consumes:
  - `buildThreadContext(history)`
  - `resolveThreadFollowUp(question, context)`
- Produces:
  - resolved `effectiveMeetingId` for workspace follow-up questions when safe

- [ ] **Step 1: Write the failing test**

```ts
it("routes a workspace follow-up about 'the first one' into meeting mode", async () => {
  meetingsFindOne.mockResolvedValue(transcriptMeeting);

  const response = await POST(
    buildRequest({
      question: "Who attended the first one?",
      history: [
        { role: "assistant", text: "You had 2 meetings this week.", sources: [
          { sourceType: "meeting", sourceId: "m1", title: "Redesign kickoff", snippet: "Kickoff" },
          { sourceType: "meeting", sourceId: "m2", title: "Planning B", snippet: "Planning" },
        ]},
      ],
    })
  );

  expect(response.status).toBe(200);
  expect(mockedAnswerMeetingQuestion).toHaveBeenCalled();
  expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`
Expected: FAIL because the route still uses workspace retrieval for that follow-up.

- [ ] **Step 3: Write minimal implementation**

```ts
const threadContext = buildThreadContext(history);
const followUpResolution = resolveThreadFollowUp(question, threadContext);

if (!effectiveMeetingId && followUpResolution.kind === "meeting") {
  effectiveMeetingId = followUpResolution.meetingId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts
git commit -m "feat: route grounded meeting follow-ups through thread context"
```

### Task 4: Enrich Workspace Retrieval for Person, Client, and Task Follow-Ups

**Files:**
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/app/api/ai/chat/route.test.ts`

**Interfaces:**
- Consumes:
  - `ThreadFollowUpResolution`
- Produces:
  - enriched retrieval query string passed into `searchWorkspaceContext(...)`

- [ ] **Step 1: Write the failing test**

```ts
it("enriches retrieval for person follow-ups using the last grounded person", async () => {
  await POST(
    buildRequest({
      question: "What tasks does he own?",
      history: [
        { role: "assistant", text: "Stefan raised pricing concerns.", sources: [
          { sourceType: "person", sourceId: "p1", title: "Stefan Ionescu", snippet: "Stefan Ionescu" },
        ]},
      ],
    })
  );

  expect(mockedSearchWorkspaceContext.mock.calls[0][2]).toContain("Stefan Ionescu");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`
Expected: FAIL because the retrieval query does not yet include the resolved entity.

- [ ] **Step 3: Write minimal implementation**

```ts
const retrievalQuestion =
  followUpResolution.kind === "retrieval_enrichment"
    ? followUpResolution.enrichedQuestion
    : buildRetrievalQuestion(question, historyBlock);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts
git commit -m "feat: enrich workspace retrieval for chat follow-ups"
```

### Task 5: Add Ambiguity Guards and Full Chat Regression Coverage

**Files:**
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/app/api/ai/chat/route.test.ts`
- Modify: `src/lib/chat-thread-context.test.ts`

**Interfaces:**
- Consumes:
  - ambiguity result from `resolveThreadFollowUp(...)`
- Produces:
  - conservative no-guess answer path for ambiguous follow-ups

- [ ] **Step 1: Write the failing test**

```ts
it("refuses ambiguous meeting follow-ups instead of guessing", async () => {
  const response = await POST(
    buildRequest({
      question: "What happened in that meeting?",
      history: [
        { role: "assistant", text: "You had 2 meetings.", sources: [
          { sourceType: "meeting", sourceId: "m1", title: "Kickoff", snippet: "Kickoff" },
          { sourceType: "meeting", sourceId: "m2", title: "Retro", snippet: "Retro" },
        ]},
      ],
    })
  );

  const payload = await response.json();
  expect(payload.data.confidence).toBe("low");
  expect(payload.data.answer).toMatch(/which meeting/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts src/lib/chat-thread-context.test.ts`
Expected: FAIL because ambiguity currently falls through to generic retrieval.

- [ ] **Step 3: Write minimal implementation**

```ts
if (followUpResolution.kind === "ambiguous") {
  return apiSuccess({
    data: {
      answer: "I can help with that, but I need you to specify which meeting, person, client, or task you mean.",
      confidence: "low",
      sources: [],
      suggestedActions: [],
    },
  }, { correlationId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/app/api/ai/chat/route.test.ts src/lib/chat-thread-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts src/lib/chat-thread-context.test.ts
git commit -m "fix: avoid guessing in ambiguous chat follow-ups"
```

## Self-Review

- Spec coverage:
  - grounded follow-up resolution is covered by Tasks 1-4
  - ambiguity handling is covered by Task 5
  - meeting-mode preservation is covered by Task 3
  - regression coverage is covered by Tasks 1, 3, 4, and 5
- Placeholder scan:
  - no `TBD`, `TODO`, or deferred implementation markers remain
- Type consistency:
  - helper names and route integration points are consistent across tasks
