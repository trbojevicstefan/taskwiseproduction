# Main-Native Unified Chat, RAG, MCP, and Planner Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute each task with TDD, a task-scoped spec/quality review, and a commit before continuing.

**Goal:** Make the active Taskwise chat on `main` reliably answer across all workspace meetings and within explicit meeting, client, person, and planner scopes; use real OpenAI Responses function calling over the existing central MCP registry; preserve long-thread context from MongoDB; and route task edits through typed MCP write handlers instead of LLM-generated task-tree replacement.

**Architecture:** Extend the systems already present on `main`: `workspace-retrieval`, `meetingSearchChunks`, companies, `chatSessions`, `/api/ai/chat`, `GeneralChatPanel`, and `mcp-registry`. The MCP registry remains the single tool definition/execution source. A server-only chat runtime exposes a scope-filtered read subset to OpenAI Responses, executes calls directly through `executeRegisteredMcpTool`, and falls back to the current deterministic/retrieval answer path if the provider/tool loop is unavailable. Explicit task commands remain deterministically parsed and execute typed registered write tools. MongoDB chat sessions own durable history and rolling memory.

**Baseline:** `origin/main` at `9335b48`. The fresh baseline has 188 passing suites and one relevant failing suite: `ChatPageContent.test.tsx` expects missing exported scope/id helpers (4 failing tests). This failure is Task 1 input, not an unrelated regression.

## Global Constraints

- Work from `codex/unified-chat-rag-agent-main`, based directly on `origin/main`.
- Strict TDD: observe a focused RED before production code for every behavior change.
- Preserve all existing workspace authorization and legacy workspace-member fallback rules.
- Internal chat executes the registered tool handler directly; it never calls the Taskwise MCP HTTP route.
- Only `mcp:read` tools may be selected automatically by the model.
- Writes are parsed deterministically. A single explicit/selected task update may execute; ambiguous, multi-selected, destructive, or bulk operations must not mutate.
- Meeting detail chat starts and remains meeting-scoped unless a future explicit broaden action is added; request payload alone cannot escape the session's `sourceMeetingId`.
- Scope identifiers are server-validated inside the active workspace.
- OpenAI loop defaults: maximum 6 rounds and 12 calls; reject repeated identical calls; cap each tool output at 12,000 characters and aggregate tool evidence at 40,000 characters.
- Preserve the latest 12 user/assistant turns verbatim; build/persist rolling memory from older grounded session messages.
- Never log transcript/prompt bodies, API keys, full provider payloads, or raw Mongo errors.
- No new dependency.
- MongoDB string IDs only.
- Existing deterministic agenda answers, anti-hallucination source/action filtering, and graceful embeddings fallback remain active.

---

### Task 1: Scope contracts, durable chat memory, and broken main baseline

**Files:**
- Create: `src/lib/chat-scope.ts`
- Create: `src/lib/chat-scope.test.ts`
- Create: `src/lib/chat-memory.ts`
- Create: `src/lib/chat-memory.test.ts`
- Modify: `src/types/general-chat.ts`
- Modify: `src/types/chat.ts`
- Modify: `src/components/dashboard/chat/ChatPageContent.tsx`
- Modify: `src/components/dashboard/chat/ChatPageContent.test.tsx`
- Modify: `src/app/api/chat-sessions/route.ts`
- Modify: `src/app/api/chat-sessions/[id]/route.ts`

**Interfaces:**

```ts
export type ChatScope =
  | { type: "workspace" }
  | { type: "meeting"; meetingId: string }
  | { type: "client"; clientId: string }
  | { type: "person"; personId: string }
  | { type: "planner" };

export function resolveChatPanelContext(
  session?: { sourceMeetingId?: string | null },
  linkedMeetingId?: string | null
): { mode: "workspace" } | { mode: "meeting"; meetingId: string };

export function createChatMessageId(prefix?: string): string;

export async function loadDurableChatMemory(params: {
  db: Db;
  userId: string;
  workspaceId: string;
  sessionId: string;
}): Promise<{ recentHistory: ChatHistoryEntry[]; summary: string | null }>;
```

**Required tests:** same-millisecond unique IDs; meeting context restored from `sourceMeetingId`; workspace default; invalid/cross-workspace entity scopes rejected; typing indicators ignored; latest 12 real turns retained; old grounded sources summarized; summary capped and persisted; session query requires active workspace/user visibility.

**RED command:**

```powershell
npm test -- --runInBand src/components/dashboard/chat/ChatPageContent.test.tsx src/lib/chat-scope.test.ts src/lib/chat-memory.test.ts
```

**GREEN gate:** focused command above plus `npm run typecheck` and full `npm test -- --runInBand`.

**Commit:** `feat: add scoped durable chat memory`

---

### Task 2: Scoped semantic knowledge MCP tool and Atlas-first retrieval

**Files:**
- Create: `src/lib/mcp-knowledge-tools.ts`
- Create: `src/lib/mcp-knowledge-tools.test.ts`
- Modify: `src/lib/mcp-register-all.ts`
- Modify: `src/lib/mcp-registry.ts`
- Modify: `src/lib/mcp-registry.test.ts`
- Modify: `src/lib/workspace-retrieval.ts`
- Modify: `src/lib/workspace-retrieval.test.ts`
- Modify: `src/lib/meeting-search-chunks.ts`

**Tool:**

```ts
search_workspace_knowledge({
  query: string,
  scopeType: "workspace" | "meeting" | "client" | "person" | "planner",
  scopeId?: string,
  from?: string,
  to?: string,
  limit?: number
})
```

The handler validates the scoped entity inside `workspaceId`, calls the existing hybrid retrieval, and returns structured meetings/tasks/people/clients plus normalized citations. Meeting scope cannot return another meeting. Client scope uses the existing companies/people relationship; person scope limits person/task/meeting evidence to the selected person.

Semantic chunk retrieval attempts Atlas `$vectorSearch` with a workspace prefilter when `MONGODB_VECTOR_INDEX` is configured. On unsupported/test deployments it falls back to the existing bounded (max 500 chunk) cosine path. It never scans an unbounded collection.

Registry hardening in this task: duplicate names/aliases reject registration; list results are immutable snapshots; all tool schemas stay closed (`additionalProperties: false`).

**RED command:**

```powershell
npm test -- --runInBand src/lib/mcp-knowledge-tools.test.ts src/lib/mcp-registry.test.ts src/lib/workspace-retrieval.test.ts
```

**GREEN gate:** focused command plus `npm run typecheck` and full suite.

**Commit:** `feat: expose scoped semantic knowledge tool`

---

### Task 3: OpenAI Responses tool loop over the MCP registry

**Files:**
- Create: `src/lib/chat-agent-runtime.ts`
- Create: `src/lib/chat-agent-runtime.test.ts`
- Create: `src/lib/openai-responses-tools.ts`
- Create: `src/lib/openai-responses-tools.test.ts`
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/app/api/ai/chat/route.test.ts`
- Modify: `src/ai/prompt-fallback.ts`

**Interfaces:**

```ts
export async function runScopedChatAgent(input: {
  db: Db;
  workspaceId: string;
  userId: string;
  scope: ChatScope;
  question: string;
  history: ChatHistoryEntry[];
  memorySummary?: string | null;
  today: string;
}): Promise<GeneralChatAnswer | null>;
```

The runtime imports `mcp-register-all`, selects only relevant `mcp:read` tools, serializes their JSON schemas for Responses function tools, executes `function_call` items with matching `call_id`, and appends `function_call_output`. Unknown/invalid calls become safe tool outputs. It terminates on a validated `GeneralChatAnswer`, repeated call, or configured bound. Provider/tool failure returns `null`, activating the existing deterministic/retrieval route path.

Scope tool allowlists:

- workspace: semantic knowledge, meeting, people, clients, tasks, calendar, board;
- meeting: semantic knowledge + meeting detail/transcript/task reads;
- client: semantic knowledge + client commitments/meeting/task reads;
- person: semantic knowledge + people/task/meeting reads;
- planner: semantic knowledge + calendar/board/task/meeting reads.

The route derives effective scope server-side. A session with `sourceMeetingId` overrides a broader client payload and remains meeting-scoped. Final sources/actions pass the existing anti-hallucination filters.

**RED command:**

```powershell
npm test -- --runInBand src/lib/openai-responses-tools.test.ts src/lib/chat-agent-runtime.test.ts src/app/api/ai/chat/route.test.ts
```

**GREEN gate:** focused command plus `npm run typecheck` and full suite.

**Commit:** `feat: run chat through scoped mcp tools`

---

### Task 4: Safe task edits through registered MCP write handlers

**Files:**
- Modify: `src/lib/chat-task-commands.ts`
- Create: `src/lib/chat-task-commands.test.ts`
- Modify: `src/lib/mcp-task-tools.ts`
- Modify: `src/lib/mcp-task-tools.test.ts`
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/app/api/ai/chat/route.test.ts`

**Behavior:**

- Deterministic parsing remains ahead of the LLM.
- Single selected task commands such as rename, mark done/in progress, and set/clear due date resolve by canonical `_id` or `sourceTaskId` inside the active workspace.
- Updates execute `executeRegisteredMcpTool` using `update_task_status`, `set_task_due_date`, or the existing legacy typed title tool.
- Meeting-created task uses `create_task_from_meeting`; workspace create remains a typed `create_task` MCP definition added to the task pack.
- More than one selected task, ambiguous title match, delete/archive/bulk language, or out-of-scope selected IDs returns clarification and performs zero writes.
- The model never receives write tools automatically and never returns a replacement task tree.

**RED command:**

```powershell
npm test -- --runInBand src/lib/chat-task-commands.test.ts src/lib/mcp-task-tools.test.ts src/app/api/ai/chat/route.test.ts
```

**GREEN gate:** focused command, MCP route regression, typecheck, full suite.

**Commit:** `fix: route chat task edits through typed tools`

---

### Task 5: Unify active workspace, meeting, client, person, and planner UI

**Files:**
- Modify: `src/components/dashboard/chat/GeneralChatPanel.tsx`
- Modify: `src/components/dashboard/chat/GeneralChatPanel.test.tsx`
- Modify: `src/components/dashboard/chat/GeneralChatPanel.interaction.test.tsx`
- Modify: `src/components/dashboard/chat/ChatPageContent.tsx`
- Modify: `src/contexts/ChatHistoryContext.tsx`
- Modify: `src/components/dashboard/meetings/MeetingDetailPageContent.tsx`
- Modify: `src/components/dashboard/clients/CompanyDetailPageContent.tsx`
- Create: `src/components/dashboard/clients/CompanyDetailPageContent.test.tsx`
- Modify: `src/components/dashboard/people/PersonDetailPageContent.tsx`
- Modify: `src/components/dashboard/planning/PlanningWorkspacePageContent.tsx`

**Behavior:**

- `GeneralChatPanel` accepts `scope: ChatScope` and sends it to `/api/ai/chat`.
- Active `ChatPageContent` uses `/api/ai/chat` for answers in both workspace and meeting sessions; it no longer calls `answerMeetingChat` or `extractTasksFromChat` for ordinary Q&A/task edits.
- Transcript paste/import remains available before a session exists.
- Persisted session messages remain authoritative across reload.
- Meeting detail opens the existing session with immutable initial meeting scope.
- Client and person detail pages render a compact scoped panel.
- Planning assistant sends planner scope and persists its chat through the existing session API.
- Visible scope copy/chip makes current confinement clear.

**RED command:**

```powershell
npm test -- --runInBand src/components/dashboard/chat/ChatPageContent.test.tsx src/components/dashboard/chat/GeneralChatPanel.test.tsx src/components/dashboard/chat/GeneralChatPanel.interaction.test.tsx src/components/dashboard/meetings/MeetingDetailPageContent.test.tsx src/components/dashboard/people/PersonDetailPageContent.test.tsx src/components/dashboard/clients/CompanyDetailPageContent.test.tsx src/components/dashboard/planning/PlanningWorkspacePageContent.test.tsx
```

**GREEN gate:** focused UI suites, `npm run lint`, `npm run typecheck`, full suite.

**Commit:** `feat: unify scoped chat entry points`

---

### Task 6: RAG eval, live OpenAI contract, documentation, and release gates

**Files:**
- Create: `scripts/test-openai-mcp-chat.ts`
- Create: `scripts/eval-chat-rag.ts`
- Create: `src/lib/chat-rag-eval.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/blueprint.md`
- Create: `docs/unified-chat-runbook.md`

**Evaluation corpus:** Serbian/English prompts; all-meeting comparison; meeting-only confinement; same-name clients/people; person task ownership; planner deadline questions; contradictory meetings; no-evidence abstention; 20+ turn reference resolution; repeated tool-call stop; cross-workspace denial; ambiguous and multi-task mutation denial.

**Commands:**

```powershell
npm run eval:chat-rag
npm run test:openai-mcp-chat
npm test -- --runInBand
npm run test:routes:smoke
npm run lint
npm run typecheck
npm run build
npm run validate:core-first:remaining
```

Live contract data is synthetic. It verifies the configured model returns `function_call`, accepts matching `function_call_output`, routes Serbian and English prompts, and never prints secrets.

**Commit:** `test: add unified chat release gates`

## Self-Review

- The plan extends `main` systems and does not import staging-only architecture.
- All user-required scopes map to the same `/api/ai/chat` runtime and MCP registry.
- All-meeting semantic retrieval is already present and becomes reachable from the active `/chat` UI.
- Meeting scope is enforced on the server, including session reloads.
- Planner reuses the same endpoint and tools instead of a separate AI mutation flow.
- LLM tool calling is real Responses function calling, while automatic write tools remain disabled.
- Task edits use typed commands and MCP handlers, not whole-list replacement.
- No placeholder, new dependency, or unbounded scan is required.
