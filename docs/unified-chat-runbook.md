# Unified Chat RAG Runbook

## Runtime contract

`POST /api/ai/chat` is the single server-authoritative path for workspace,
meeting, client, person, and planner chat. The route authenticates the user,
resolves the active workspace and durable session, validates the requested
scope, and then invokes the OpenAI Responses tool loop over the central MCP
registry. Internal chat executes registered handlers directly; it does not
call the public MCP HTTP endpoint.

The supported scopes are:

| Scope | Authority and evidence boundary |
| --- | --- |
| `workspace` | Visible meetings, tasks, people, clients, calendar, and board data in the active workspace. |
| `meeting` | One validated meeting plus its transcript, attendees, and meeting-linked tasks. |
| `client` | One validated client plus related people, meetings, tasks, and commitments. |
| `person` | One validated person plus that person's meetings, tasks, and commitments. |
| `planner` | Workspace planning evidence with calendar, board, task, meeting, and deadline bias. |

The durable chat session is authoritative. If a session has
`sourceMeetingId`, the server restores meeting scope on every request and a
broader scope in the request body cannot escape it. Client and person ids are
also validated inside the active workspace. Model history is bounded to the
latest 12 real user/assistant turns, with each entry truncated to 2,000
characters; older grounded turns are compacted into a capped rolling memory.
Typing indicators are never part of model history.

## Tool and write safety

The model receives only scope-appropriate registry tools classified as
`mcp:read`. The server overwrites model-supplied scope ids with the authorized
scope before execution. Write tools are never advertised to the automatic
Responses loop.

Task changes take a separate deterministic path before the LLM. Explicit
single-task commands resolve a canonical task inside the active workspace and
call typed registered handlers such as `update_task_status`,
`set_task_due_date`, `action_items.update_title`, `create_task`, or
`create_task_from_meeting`. Ambiguous matches, multiple selected tasks,
delete/archive/bulk language, and out-of-scope ids return clarification and
perform zero writes. Chat never accepts an LLM-generated replacement task
tree.

## OpenAI configuration

Required for the Responses agent and live contract probe:

- `OPENAI_API_KEY` (secret).
- `OPENAI_MODEL`, falling back to `OPENAI_FALLBACK_MODEL`, then
  `gpt-4.1-mini`.

Optional non-secret controls:

- `OPENAI_RESPONSES_URL` (default `https://api.openai.com/v1/responses`).
- `OPENAI_CHAT_PROVIDER_TIMEOUT_MS` (runtime default 25,000 ms; the live
  probe caps configuration at 60,000 ms).
- `OPENAI_CHAT_TOOL_TIMEOUT_MS` (runtime default 8,000 ms).
- `OPENAI_EMBEDDINGS_MODEL` for query and meeting-chunk embeddings.

Keep secrets in the deployment secret manager or ignored local env files.
Neither runtime nor release scripts should log API keys, prompts, transcripts,
raw provider payloads, or raw database errors.

## Atlas Vector Search

Semantic retrieval uses the `meetingSearchChunks` collection. For Atlas-first
search, create an Atlas Vector Search index with:

- the index name placed in `MONGODB_VECTOR_INDEX`;
- a cosine vector field at `embedding`;
- `numDimensions` matching the configured `OPENAI_EMBEDDINGS_MODEL` output;
- filter fields for `workspaceId`, `userId`, and `meetingId`, because the
  runtime applies workspace visibility and optional meeting confinement in
  the `$vectorSearch` prefilter.

Existing meetings can be assessed and backfilled with:

```powershell
npx tsx scripts/backfill-meeting-search-chunks.ts
npx tsx scripts/backfill-meeting-search-chunks.ts --apply
```

Run the first command as a dry-run, review counts, then run `--apply` with the
database and OpenAI credentials configured. Backfill ids are deterministic and
unchanged content is skipped.

If `MONGODB_VECTOR_INDEX` is absent, Atlas does not support `$vectorSearch`, or
the configured index is unavailable, retrieval falls back to local cosine
similarity over at most the 500 most recently updated authorized chunks. If
embeddings are unavailable, the system falls back again to bounded keyword
retrieval. These fallbacks preserve scope filters and do not scan an unbounded
collection.

## Failure and fallback behavior

- Missing OpenAI configuration, provider errors/timeouts, invalid provider
  output, repeated identical calls, the six-round/twelve-call bound, or tool
  timeout cause the scoped agent to return control to the existing
  deterministic/retrieval path.
- Meeting fallback remains confined to the meeting. Client/person provider
  failure abstains instead of broadening to the workspace.
- Empty evidence produces a low-confidence no-evidence answer; it does not ask
  the model to invent an answer.
- Invalid or cross-workspace entity scope returns the same not-found response
  without disclosing whether the entity exists elsewhere.
- Suggested actions and citations are filtered to ids observed in authorized
  tool evidence. Unverifiable citations are dropped and confidence is
  degraded when necessary.
- Each tool output is capped at 12,000 characters and aggregate tool evidence
  at 40,000 characters.

## Observability and triage

The chat route emits structured `api.request.succeeded` logs and API metrics
with safe metadata such as `outcome`, `scopeType`, `confidence`, source count,
and duration. Useful outcomes include `task_command_answered`,
`scoped_agent_answered`, `scoped_agent_unavailable`, `meeting_answered`,
`workspace_tool_answered`, `no_evidence`, and `answered`.

When triaging:

1. Use the request correlation id to find the route log.
2. Check the outcome and status before treating a fallback as a failure.
3. Verify model/endpoint/index configuration without printing secret values.
4. Run the offline eval. If it passes, run the live contract probe to isolate
   configured-model or network behavior.
5. For retrieval incidents, verify chunk counts and Atlas index status; leave
   the bounded fallback enabled while repairing the index.

## Release gates

The deterministic eval is stable and offline. It covers Serbian and English,
all-meeting comparison, meeting confinement, same-name entity collision,
person ownership, planner deadlines, contradictory meetings, abstention,
20-plus-turn memory, loop stopping, cross-workspace denial, and mutation
zero-write behavior.

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

`npm run test:openai-mcp-chat` uses only synthetic evidence and never connects
to MongoDB. It advertises one read-only function, requires English and Serbian
function calls, continues each response with the exact returned `call_id`, and
validates the final JSON against the production answer schema and the source
ids actually returned as synthetic evidence. Its output is intentionally
concise and redacted. Both eval commands exit nonzero on failure.

### Current webhook release concern

The controlled 2026-08-11 webhook burst accepted all 600 requests, but it did
not pass the unchanged latency gate: p95 was 1,936.52 ms against the 1,500 ms
limit, p50 was 1,070.36 ms, p99 was 2,861.42 ms, and 3 requests exceeded the
3,000 ms timeout threshold. Consequently `validate:core-first:remaining` is
not green and this webhook performance gate is not release-ready. The worker
recovery and SSE latency validators passed when run individually; that does
not override the failed composite webhook prerequisite.
