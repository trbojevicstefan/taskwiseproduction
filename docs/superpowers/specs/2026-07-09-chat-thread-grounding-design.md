# Chat Thread Grounding Design

**Date:** 2026-07-09

## Goal

Make Taskwise chat behave like a grounded thread across workspace questions and meeting follow-ups so users can ask about multiple meetings, people, clients, and tasks without losing context on the second or third turn.

## Current State

- Meeting-scoped chat already stays pinned to a single meeting when a chat session has `sourceMeetingId`.
- Workspace chat passes raw history to the model and to retrieval, but does not deterministically resolve references like `the first one`, `that client`, `his tasks`, or `who said that`.
- The retrieval and planner layers are strong for isolated questions, but follow-up resolution still depends too much on the model rediscovering the same entities.

## Requirements

- Preserve the current meeting-scoped behavior for transcript-grounded chats.
- Improve workspace chat follow-up behavior for:
  - multiple meetings
  - people
  - clients
  - tasks
- Resolve vague follow-up references from recently grounded assistant answers before broad retrieval.
- Never guess when multiple candidates fit a follow-up reference.
- Keep the existing anti-hallucination source and action filtering in `/api/ai/chat`.
- Add regression tests for multi-turn thread behavior before production code changes.

## Non-Goals

- No new database schema for thread state in this pass.
- No full agentic planner or tool framework rewrite.
- No changes to unrelated chat task extraction flows.

## Architecture

Add a deterministic thread-context layer inside the `/api/ai/chat` orchestration path.

The new layer will:

1. Read recent `history` entries.
2. Extract grounded entities from assistant turns that already contain cited sources.
3. Preserve simple ordering information for recent meeting lists so phrases like `the first one` can resolve safely.
4. Resolve follow-up references before planner selection and retrieval.
5. Route to one of three outcomes:
   - meeting mode when a follow-up clearly points to one meeting
   - enriched workspace retrieval when a follow-up points to people, clients, or tasks
   - current fallback behavior when no safe resolution exists

## Proposed Files

- Modify `src/app/api/ai/chat/route.ts`
  - integrate thread-context resolution into request orchestration
- Create `src/lib/chat-thread-context.ts`
  - parse recent history
  - extract grounded entities
  - resolve follow-up references
  - build enriched retrieval hints
- Modify `src/app/api/ai/chat/route.test.ts`
  - add end-to-end multi-turn routing and ambiguity regressions
- Create `src/lib/chat-thread-context.test.ts`
  - add focused unit coverage for extraction and reference resolution

## Thread Context Model

The thread context is computed per request from recent history only. It is not persisted separately.

It will capture:

- recent grounded meetings:
  - `meetingId`
  - `title`
  - list position in the latest answer when available
- recent grounded people and clients:
  - `personId`
  - `name`
  - `personType`
- recent grounded tasks:
  - `taskId`
  - `title`
  - optional `sourceSessionId`
- latest assistant answer text for pronoun and noun-phrase enrichment

Only assistant turns with grounded sources are trusted for entity extraction.

## Resolution Rules

### Meeting references

Resolve follow-ups such as:

- `the first one`
- `the second meeting`
- `that meeting`
- `who attended it`
- `who said that`

Behavior:

- If a single meeting is clearly identified from recent grounded context, route to meeting mode.
- If more than one meeting is plausible and no ordinal narrows it, do not guess.

### Person and client references

Resolve follow-ups such as:

- `what did that client ask for`
- `what tasks does he own`
- `what else did Stefan mention`

Behavior:

- Use the most recent grounded person or client entity when the reference is singular and unambiguous.
- Build an enriched retrieval query using the resolved name and the current question.

### Task references

Resolve follow-ups such as:

- `open that task`
- `is that overdue`
- `who owns that one`

Behavior:

- Use the most recent grounded task when singular and unambiguous.
- Enrich retrieval rather than forcing a new route type.

## Error Handling

- If no grounded entity can be resolved, keep the current planner and retrieval behavior.
- If resolution is ambiguous, return a conservative answer instead of inventing context.
- If resolved entities no longer exist in retrieval results, degrade confidence and keep the current source-filtering safeguards.

## Testing Strategy

### Unit tests

`src/lib/chat-thread-context.test.ts`

- extracts grounded meetings from assistant turns with sources
- ignores assistant turns without grounded sources
- resolves ordinal references like `first` and `second`
- resolves singular `that client` and `that task`
- returns ambiguity when multiple candidates fit

### Route tests

`src/app/api/ai/chat/route.test.ts`

- workspace follow-up `Who attended the first one?` resolves to the first grounded meeting
- workspace follow-up `What tasks does he own?` enriches retrieval with the last grounded person
- workspace follow-up `What did that client ask for?` enriches retrieval with the last grounded client
- session-backed meeting follow-up remains meeting-scoped without explicit `meetingId`
- ambiguous follow-up refuses to guess

## Acceptance Criteria

- Multi-turn workspace chat resolves obvious follow-ups from recent grounded context.
- Multi-turn meeting chat remains transcript-grounded.
- Vague follow-ups no longer depend only on the model remembering prior entities.
- Ambiguous follow-ups do not silently attach to the wrong meeting, person, client, or task.
- New behavior is covered by failing-then-passing automated tests.
