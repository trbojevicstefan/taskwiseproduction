# Taskwise MCP — Codex setup

Taskwise exposes a workspace-scoped MCP server over streamable HTTP:

```
POST https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp
Authorization: Bearer <YOUR_MCP_KEY>
```

## 1. Create an MCP key

In Taskwise: **Settings → Advanced → MCP API** → create a key. Prefer
`mcp:read` only; add `mcp:write` only if Codex should mutate tasks or schedule
Slack reminders. The secret is shown once.

## 2. Configure Codex

Codex reads MCP servers from `~/.codex/config.toml`. For a streamable-HTTP
server:

```toml
[mcp_servers.taskwise]
url = "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp"
bearer_token_env_var = "TASKWISE_MCP_KEY"
```

```bash
export TASKWISE_MCP_KEY=twmcp_...
```

If your Codex version only supports stdio MCP servers, bridge with
`mcp-remote`:

```toml
[mcp_servers.taskwise]
command = "npx"
args = [
  "-y", "mcp-remote",
  "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp",
  "--header", "Authorization: Bearer ${TASKWISE_MCP_KEY}"
]
env = { "TASKWISE_MCP_KEY" = "twmcp_..." }
```

## 3. Verify

Start Codex and run `/mcp` (or ask "list your taskwise tools"). You should see
14 domain tools (`search_meetings`, `list_tasks`, `get_client_commitments`,
...), 8 `taskwise://` resources, and 5 prompts, plus the legacy dotted tools
(`meetings.*`, `action_items.*`, `people.*`).

## Notes

- Write tools require the `mcp:write` scope and are audit-logged and
  rate-limited per key.
- Keys are workspace-scoped: one config entry per workspace.
- Full reference: the app's `/docs/mcp` page (generated from the server's own
  tool registry).
