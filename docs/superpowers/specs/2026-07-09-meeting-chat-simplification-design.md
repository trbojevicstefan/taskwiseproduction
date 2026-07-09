# Meeting Chat Simplification Design

## Goal

Simplify meeting chat so it behaves like a single, reliable meeting assistant:

- answer questions about the current meeting transcript
- edit only the tasks selected in that same meeting
- never touch unrelated tasks outside the active meeting
- preserve the existing planning-page chat behavior

## Problem

The current chat experience is over-engineered for the meeting use case.

It combines multiple AI flows, routing heuristics, transcript grounding rules, and task-sync layers that fight each other:

- a router decides whether the user wants knowledge or task edits
- a transcript QA flow trims and re-grounds the transcript before answering
- task edits go through separate matching, refinement, and persistence paths
- meeting-linked chat sessions and meeting task lists can drift apart

That structure causes the failures the user is seeing:

- answers often come back as low-confidence or not fully grounded
- the assistant sometimes refuses to answer even when the transcript has the information
- meeting chats do not reliably edit the meeting tasks they are attached to
- the current meeting chat path is too easy to route into behavior meant for planning chats or general task editing

## Proposed Shape

Meeting chat will use a dedicated, simpler contract.

### Inputs

The meeting chat runtime receives:

- the active meeting id
- the full transcript for that meeting
- the meeting’s current task list
- the ids of tasks currently selected by checkbox
- the user message

### Allowed Outputs

The assistant may return one of three outcomes:

- `answer`: respond to a transcript question
- `task_update`: modify only selected tasks from the current meeting
- `needs_selection`: explain that the user must select one or more meeting tasks before editing

### Hard Rules

- Meeting chat can only edit tasks that belong to the active meeting.
- Meeting chat can only mutate tasks that are currently selected.
- If no tasks are selected, the assistant must not invent a target task.
- Meeting chat must not create unrelated tasks.
- Meeting chat must not edit planning-page state.

## Runtime Flow

### Meeting Chat

1. User types a message in a meeting-backed chat session.
2. The client sends the message, transcript, meeting task list, meeting id, and selected task ids.
3. The server calls a single meeting-chat prompt or structured OpenAI call.
4. The response is interpreted as either an answer or a selected-task mutation.
5. If the response is a mutation, the server validates that every target id belongs to the active meeting and is currently selected.
6. The meeting record is updated first.
7. Canonical task sync follows from the updated meeting state.
8. The chat message history is updated with the assistant response.

### Planning Chat

Planning chat keeps the current behavior and its existing task-editing flexibility.

The meeting simplification must not change:

- how the planning page opens sessions
- how planning tasks are refined
- how planning chat stores and syncs task edits

## Persistence Model

Meeting chat should treat the meeting as the source of truth for editable tasks.

- Chat session stores conversation history and a pointer to the meeting.
- Meeting stores the task list that can be edited from meeting chat.
- Canonical task sync runs from the meeting task list after edits are applied.

This removes the current ambiguity where chat session state, meeting state, and canonical task state can compete with each other.

## Error Handling

The assistant should fail safely instead of guessing.

- If the user asks to edit tasks but nothing is selected, return a short `needs_selection` response.
- If selected ids do not belong to the active meeting, reject the mutation.
- If the model returns malformed output, fall back to a plain answer or a safe no-op response.
- If the message mixes a transcript question with an edit request, prefer the edit only when the selected-task set makes the target explicit; otherwise answer the question without mutating tasks.

## Non-Goals

This change does not aim to:

- redesign planning-page chat
- remove all AI routing from the product
- replace canonical task sync across the whole app
- change board behavior beyond what meeting-task edits already require
- add cross-meeting task editing from chat

## Implementation Boundary

The work should stay focused on the meeting chat surface and the shared backend helpers that support it.

Likely touch points:

- meeting chat UI
- chat session update path for meeting-backed sessions
- meeting task mutation helpers
- a meeting-chat-specific AI prompt or structured OpenAI call
- validation logic for selected task ids

The planning page should continue to call its existing chat/task flow.

## Test Strategy

We should add tests that prove the new boundary, not just the happy path.

- meeting chat answers transcript questions without mutating tasks
- meeting chat refuses task edits when nothing is selected
- meeting chat mutates only selected tasks from the active meeting
- meeting chat rejects ids that do not belong to the active meeting
- planning chat behavior remains unchanged

## Acceptance Criteria

The change is complete when:

- meeting chat answers transcript questions more reliably
- meeting chat can edit selected tasks from the active meeting
- meeting chat cannot affect unrelated tasks
- planning-page chat still works as before
- the user can see the meeting chat as a simpler, more dependable assistant

