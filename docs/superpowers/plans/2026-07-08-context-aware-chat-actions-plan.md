# Context-Aware Chat Actions Plan

## Goal

Make workspace chat answer follow-up questions using prior turns, and let chat create or edit tasks from explicit commands.

## Approach

1. Add failing route tests in `src/app/api/ai/chat/route.test.ts`.
   - Verify retrieval receives a history-expanded query for follow-ups.
   - Verify explicit task creation inserts a workspace-scoped active task.
   - Verify explicit task edits update one matched task and refuse ambiguous matches.
   - Expected red output: tests fail because retrieval uses only the raw question and no task command path exists.

2. Add `src/lib/chat-task-commands.ts`.
   - Export a pure command planner for create/edit task intents.
   - Export an executor that uses the existing task document shape, workspace scope, and string IDs.
   - Use conservative matching: exact match first, otherwise a single contains match; ambiguity returns a low-confidence clarification.

3. Update `src/app/api/ai/chat/route.ts`.
   - Build a capped retrieval query from the current question plus recent chat history.
   - Execute task commands before retrieval/LLM when the user asks chat to create or edit a task.
   - Keep anti-hallucination source/action filtering unchanged for ordinary answers.

4. Verify locally.
   - `npm test -- --runInBand src/app/api/ai/chat/route.test.ts`
   - `npm test -- --runInBand src/lib/chat-query-planner.test.ts src/lib/internal-chat-tools.test.ts src/lib/mcp-workspace-tools.test.ts src/app/api/ai/chat/route.test.ts`
   - If focused tests pass, run broader project verification before pushing.

5. Test against the live account.
   - Use the authenticated browser session or log in with the existing test account.
   - Ask a weekly meetings question, then a pronoun follow-up.
   - Create a clearly named disposable task from chat, edit it from chat, and confirm via `/api/tasks`.

## Design Notes

- Follow-up retrieval should never rely on the model to invent context. The search query includes recent user and assistant turns, while the flow still receives the original user question and the rendered history.
- Task mutation answers should cite the created or edited task and include an `open_task` action.
- Ambiguous edits must not mutate data; they return matching task titles so the user can clarify.
