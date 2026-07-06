# Taskwise MCP — Claude Code setup

Taskwise exposes a workspace-scoped MCP server over streamable HTTP:

```
POST https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp
Authorization: Bearer <YOUR_MCP_KEY>
```

## 1. Create an MCP key

1. In Taskwise, open **Settings → Advanced → MCP API**.
2. Create a key. Grant `mcp:read` only, unless Claude Code should also edit
   tasks / schedule reminders — then add `mcp:write`.
3. Copy the secret — it is shown exactly once.

## 2. Add the server to Claude Code

Using the CLI:

```bash
claude mcp add taskwise \
  --transport http \
  https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp \
  --header "Authorization: Bearer <YOUR_MCP_KEY>"
```

Or in `.mcp.json` at your project root (project scope):

```json
{
  "mcpServers": {
    "taskwise": {
      "type": "http",
      "url": "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer ${TASKWISE_MCP_KEY}"
      }
    }
  }
}
```

Keep the key out of version control — export it instead:

```bash
export TASKWISE_MCP_KEY=twmcp_...
```

## 3. Verify

Inside Claude Code run `/mcp` — the `taskwise` server should list tools such
as `search_meetings`, `list_tasks`, `get_board_snapshot`, resources like
`taskwise://workspace/summary`, and prompts like `find_broken_promises`.

Quick smoke test prompt:

> Using the taskwise MCP server, read taskwise://workspace/summary and tell me
> how many open tasks are overdue.

## Notes

- Tool scopes: read tools need `mcp:read`; `update_task_status`,
  `assign_task`, `set_task_due_date`, `prioritize_tasks`,
  `create_task_from_meeting`, and `schedule_slack_reminder` need `mcp:write`.
- Write calls are audit-logged per key and rate-limited (default 30
  writes/minute; 120 requests/minute overall).
- The full tool/resource/prompt reference is served at `/docs/mcp` in the app
  (generated from the same registry the server uses).
