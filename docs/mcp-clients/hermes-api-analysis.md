# Taskwise MCP — Hermes-style API-analysis agents

This guide is for agents whose job is to **analyze an API surface** (generate
client code, diff versions, audit coverage, write integration docs) rather
than to act on workspace data.

## What machine-readable contracts exist

Taskwise does not currently ship a standalone OpenAPI file. The authoritative,
machine-readable contract is the MCP server's own introspection — every tool
is described with a JSON Schema, and resources/prompts are enumerable:

| Source | What it gives you |
| --- | --- |
| `tools/list` (JSON-RPC) | Every tool: name, description, scope-implying name, full JSON Schema for arguments |
| `resources/list` | All `taskwise://` resource URIs, names, MIME types, descriptions |
| `prompts/list` | Prompt names, descriptions, and argument declarations (incl. required flags) |
| `/docs/mcp` (HTML) | Human-readable catalog of HTTP endpoints, JSON-RPC methods, scopes, rate limits, and error codes — generated from the same registry the server executes |

## Pulling the schemas

```bash
ENDPOINT="https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp"
AUTH="Authorization: Bearer $TASKWISE_MCP_KEY"

# Tool schemas (JSON Schema per tool)
curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools'

# Resources and prompts
curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/list"}' | jq '.result.resources'
curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list"}' | jq '.result.prompts'
```

A read-only key (`mcp:read`) is sufficient for all introspection.

## Deriving an OpenAPI description

If your analysis pipeline requires OpenAPI, generate it from `tools/list`:
model the single transport endpoint (`POST /api/workspaces/{workspaceId}/mcp`)
as a JSON-RPC envelope, and emit one `oneOf` request variant per tool where
`params.name` is the tool name and `params.arguments` is that tool's
`inputSchema` verbatim. Include these transport-level facts:

- Auth: `Authorization: Bearer` (or `X-Taskwise-Mcp-Key` / `X-Mcp-Api-Key` /
  `X-API-Key`); keys are workspace-scoped.
- Responses: JSON-RPC result with `content` (text summary) +
  `structuredContent` (typed data); errors `-32600/-32601/-32602/-32002/-32001`.
- HTTP errors: `401` bad key, `403` scope/workspace mismatch, `429` rate limit
  (with `Retry-After` and `X-Taskwise-Mcp-RateLimit-*` headers).
- Key-management endpoints (session-authed, not MCP-key-authed) are listed on
  `/docs/mcp`: `GET/POST /api/workspaces/{workspaceId}/mcp/keys`,
  `DELETE .../keys/{keyId}`, `GET .../audit-logs`.

## Semantics your analysis should capture

- **Scopes:** tool names map to scopes deterministically — the mutating tools
  (`update_task_status`, `assign_task`, `set_task_due_date`,
  `prioritize_tasks`, `create_task_from_meeting`, `schedule_slack_reminder`,
  `action_items.update_*`) require `mcp:write`; everything else, including all
  resources and prompts, requires `mcp:read`.
- **Aliases:** `attendees.list` / `attendees.get` are accepted on `tools/call`
  as aliases of `people.list` / `people.get` but are intentionally absent from
  `tools/list` — treat them as deprecated synonyms, not separate operations.
- **Data guarantees:** results never contain recording ids/hashes, API keys,
  or unbounded transcripts (transcript access is snippet-based or capped);
  list limits are clamped server-side.
- **Idempotency notes:** `prioritize_tasks` only persists changed documents;
  `schedule_slack_reminder` dedupes on `(taskId, kind, runAt)` and rejects
  duplicates.
