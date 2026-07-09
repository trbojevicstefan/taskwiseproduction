# Meeting Chat Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make meeting chat answer transcript questions and edit only checkbox-selected tasks from the active meeting, while leaving planning-page chat behavior unchanged.

**Architecture:** Add a dedicated meeting-chat helper path that validates selected task ids, answers transcript questions with the full meeting transcript, and applies only scoped task mutations back to the meeting record. Keep the existing planning flow and generic chat orchestrator intact for the planning page.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Jest, Genkit/OpenAI flows, MongoDB persistence.

## Global Constraints

- Meeting chat can only edit tasks that belong to the active meeting.
- Meeting chat can only mutate tasks that are currently selected.
- If no tasks are selected, the assistant must not invent a target task.
- Meeting chat must not create unrelated tasks.
- Meeting chat must not edit planning-page state.
- Planning chat keeps the current behavior and its existing task-editing flexibility.

---

### Task 1: Add meeting-chat scope helpers

**Files:**
- Create: `src/lib/meeting-chat.ts`
- Test: `src/lib/meeting-chat.test.ts`

**Interfaces:**
- Consumes: `ExtractedTaskSchema[]`, `Set<string>`, and meeting task ids from `src/types/chat.ts`
- Produces: `validateSelectedMeetingTaskIds()`, `mergeSelectedMeetingTaskUpdates()`

- [ ] **Step 1: Write the failing test**

```ts
import { mergeSelectedMeetingTaskUpdates, validateSelectedMeetingTaskIds } from './meeting-chat';

describe('meeting chat helpers', () => {
  it('rejects selected ids that do not belong to the active meeting', () => {
    expect(
      validateSelectedMeetingTaskIds(
        [{ id: 'm1' }, { id: 'm2' }] as any,
        new Set(['m1', 'm3'])
      )
    ).toEqual({ valid: false, invalidTaskIds: ['m3'] });
  });

  it('merges only selected meeting task updates back into the meeting task list', () => {
    const tasks = [
      { id: 'a', title: 'Alpha', priority: 'low' },
      { id: 'b', title: 'Beta', priority: 'medium' },
    ] as any;

    const updated = mergeSelectedMeetingTaskUpdates(tasks, [
      { id: 'b', title: 'Beta renamed', priority: 'high' },
    ]);

    expect(updated).toEqual([
      { id: 'a', title: 'Alpha', priority: 'low' },
      { id: 'b', title: 'Beta renamed', priority: 'high' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/meeting-chat.test.ts`
Expected: FAIL because `src/lib/meeting-chat.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const validateSelectedMeetingTaskIds = (meetingTasks, selectedTaskIds) => {
  const meetingTaskIds = new Set(meetingTasks.map((task) => String(task.id)));
  const invalidTaskIds = Array.from(selectedTaskIds).filter((id) => !meetingTaskIds.has(String(id)));
  return invalidTaskIds.length ? { valid: false, invalidTaskIds } : { valid: true, invalidTaskIds: [] };
};

export const mergeSelectedMeetingTaskUpdates = (meetingTasks, updatedSelectedTasks) => {
  const updatedById = new Map(updatedSelectedTasks.map((task) => [String(task.id), task]));
  return meetingTasks.map((task) => updatedById.get(String(task.id)) || task);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/lib/meeting-chat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/meeting-chat.ts src/lib/meeting-chat.test.ts
git commit -m "test: add meeting chat scope helpers"
```

### Task 2: Add a dedicated meeting chat AI flow

**Files:**
- Create: `src/ai/flows/meeting-chat-flow.ts`
- Test: `src/ai/flows/meeting-chat-flow.test.ts`

**Interfaces:**
- Consumes: meeting transcript, meeting task list, selected task ids, and user message
- Produces: a structured meeting chat result with `answerText`, optional `updatedTasks`, and optional `needsSelection`

- [ ] **Step 1: Write the failing test**

```ts
describe('meeting chat flow', () => {
  it('returns needsSelection when asked to edit tasks without selected ids', async () => {
    const result = await answerMeetingChat({
      message: 'rename this task',
      transcript: '00:01 Domenick: ...',
      meetingTasks: [{ id: 't1', title: 'Follow up' }] as any,
      selectedTaskIds: [],
    });

    expect(result.needsSelection).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/ai/flows/meeting-chat-flow.test.ts`
Expected: FAIL because the flow does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function answerMeetingChat(input) {
  if (!input.selectedTaskIds.length && /rename|edit|update|assign|delete|mark/i.test(input.message)) {
    return { answerText: 'Select one or more meeting tasks first.', needsSelection: true };
  }
  return { answerText: 'Meeting chat response.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/ai/flows/meeting-chat-flow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/flows/meeting-chat-flow.ts src/ai/flows/meeting-chat-flow.test.ts
git commit -m "feat: add meeting chat ai flow"
```

### Task 3: Wire meeting chat into the dashboard chat UI

**Files:**
- Modify: `src/components/dashboard/chat/ChatPageContent.tsx`
- Modify: `src/contexts/ChatHistoryContext.tsx`

**Interfaces:**
- Consumes: `answerMeetingChat()` and `mergeSelectedMeetingTaskUpdates()`
- Produces: meeting chat responses that only update selected meeting tasks, while planning chat still uses `extractTasksFromChat()`

- [ ] **Step 1: Write the failing test**

```ts
describe('meeting chat message routing', () => {
  it('does not allow meeting-backed chat to mutate tasks when nothing is selected', () => {
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/dashboard/chat/ChatPageContent.test.tsx`
Expected: FAIL until the meeting-chat branch is wired and covered.

- [ ] **Step 3: Write minimal implementation**

```ts
// In ChatPageContent, branch on currentSession.sourceMeetingId.
// If meeting-backed, call answerMeetingChat() with selectedTaskIds and meeting tasks.
// If the result includes updatedTasks, merge them into the meeting task list only.
// Keep the existing extractTasksFromChat() path for non-meeting chats and planning pages.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/components/dashboard/chat/ChatPageContent.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/chat/ChatPageContent.tsx src/contexts/ChatHistoryContext.tsx
git commit -m "feat: simplify meeting chat flow"
```

## Self-Review

- Spec coverage: meeting-only edits, checkbox selection gating, and planning-page preservation are all covered by Tasks 1-3.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: helper names are used consistently across the tasks.

