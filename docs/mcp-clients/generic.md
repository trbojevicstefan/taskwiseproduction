# Taskwise MCP — generic client configuration

Any MCP client that supports **streamable HTTP** transports can talk to
Taskwise. There is one server per workspace:

- **Endpoint:** `https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp`
- **Auth:** `Authorization: Bearer <YOUR_MCP_KEY>` (also accepted:
  `X-Taskwise-Mcp-Key`, `X-Mcp-Api-Key`, `X-API-Key`)
- **Protocol:** JSON-RPC 2.0, MCP protocol version `2025-03-26`
- **Methods:** `initialize`, `ping`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`, `prompts/list`, `prompts/get`
- **SSE:** send `Accept: text/event-stream` (or `?stream=1`) to receive the
  response as a single SSE `message` event.

## Generic JSON config

Most JSON-configured clients (Claude Desktop-style schema) accept:

```json
{
  "mcpServers": {
    "taskwise": {
      "type": "http",
      "url": "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_MCP_KEY>"
      }
    }
  }
}
```

For stdio-only clients, use the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "taskwise": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp",
        "--header",
        "Authorization: Bearer <YOUR_MCP_KEY>"
      ]
    }
  }
}
```

## Raw JSON-RPC smoke test

```bash
curl -X POST "https://www.taskwise.ai/api/workspaces/<WORKSPACE_ID>/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_MCP_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Scopes, limits, errors

| Concern | Behavior |
| --- | --- |
| Scopes | `mcp:read` for reads (tools, resources, prompts); `mcp:write` for mutating tools |
| Rate limits | 120 requests/min per key; 30 writes/min (headers: `X-Taskwise-Mcp-RateLimit-*`, `Retry-After`) |
| Audit | Every `mcp:write` tool call is logged with key id, tool, and resource |
| Errors | HTTP `401/403/429`; JSON-RPC `-32600/-32601/-32602/-32002/-32001` |

The authoritative tool/resource/prompt listing is served by `tools/list`,
`resources/list`, and `prompts/list` — and mirrored on the app's `/docs/mcp`
page, which is generated from the same registry.
