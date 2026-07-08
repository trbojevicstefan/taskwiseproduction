import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { registerAllMcpDefinitions } from "@/lib/mcp-register-all";
import {
  listRegisteredMcpPrompts,
  listRegisteredMcpResources,
  listRegisteredMcpTools,
} from "@/lib/mcp-registry";

export const metadata: Metadata = {
  title: "MCP API Docs | TaskWiseAI",
  description:
    "TaskWiseAI MCP access docs: authentication, endpoints, JSON-RPC methods, tools, resources, prompts, scopes, and rate limits.",
};

// The tool/resource/prompt listings below are DERIVED from the MCP registry
// (src/lib/mcp-registry.ts via src/lib/mcp-register-all.ts) — the same source
// of truth the transport route serves. Registering a new tool in a pack makes
// it appear here automatically.
registerAllMcpDefinitions();

type ApiEndpoint = {
  method: "GET" | "POST" | "DELETE" | "OPTIONS";
  path: string;
  auth: string;
  purpose: string;
};

type RpcMethod = {
  method: string;
  scope: string;
  notes: string;
};

const API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "POST",
    path: "/api/workspaces/{workspaceId}/mcp",
    auth: "MCP API key",
    purpose: "JSON-RPC MCP transport (initialize, tools/list, tools/call, etc).",
  },
  {
    method: "OPTIONS",
    path: "/api/workspaces/{workspaceId}/mcp",
    auth: "None",
    purpose: "CORS preflight for MCP clients.",
  },
  {
    method: "GET",
    path: "/api/workspaces/{workspaceId}/mcp/keys",
    auth: "Signed-in workspace session (member+)",
    purpose: "List MCP keys for the workspace.",
  },
  {
    method: "POST",
    path: "/api/workspaces/{workspaceId}/mcp/keys",
    auth: "Signed-in workspace session (owner/admin)",
    purpose: "Create a scoped MCP key. Secret is returned once.",
  },
  {
    method: "DELETE",
    path: "/api/workspaces/{workspaceId}/mcp/keys/{keyId}",
    auth: "Signed-in workspace session (owner/admin)",
    purpose: "Revoke an MCP key.",
  },
  {
    method: "GET",
    path: "/api/workspaces/{workspaceId}/mcp/audit-logs?limit=30",
    auth: "Signed-in workspace session (member+)",
    purpose: "Read recent MCP audit activity.",
  },
];

const RPC_METHODS: RpcMethod[] = [
  {
    method: "initialize",
    scope: "none",
    notes: "Returns server info, capabilities, protocol version, and key/workspace context.",
  },
  {
    method: "ping",
    scope: "none",
    notes: "Health-check method.",
  },
  {
    method: "tools/list",
    scope: "mcp:read",
    notes: "Lists all read and write tools available on this server.",
  },
  {
    method: "tools/call",
    scope: "mcp:read or mcp:write",
    notes:
      "Tool scope depends on tool name. Read tools require mcp:read, write tools require mcp:write.",
  },
  {
    method: "resources/list",
    scope: "mcp:read",
    notes: "Lists the taskwise:// resources documented below.",
  },
  {
    method: "resources/read",
    scope: "mcp:read",
    notes: "Reads one resource by URI ({ uri: string }).",
  },
  {
    method: "prompts/list",
    scope: "mcp:read",
    notes: "Lists the prompt templates documented below.",
  },
  {
    method: "prompts/get",
    scope: "mcp:read",
    notes:
      "Returns a prompt's messages ({ name, arguments? }). Required arguments are validated.",
  },
];

const formatJsonSchemaType = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(" | ");
  if (typeof value === "string") return value;
  return "any";
};

/** Compact "{ a: string, b?: number (1-100) }" rendering of a tool's JSON Schema. */
const formatArgsFromJsonSchema = (schema: Record<string, unknown>): string => {
  const properties =
    (schema?.properties as Record<string, any> | undefined) || {};
  const required = new Set(
    Array.isArray(schema?.required) ? (schema.required as string[]) : []
  );
  const entries = Object.entries(properties);
  if (!entries.length) return "{}";
  const parts = entries.map(([name, property]) => {
    let type = formatJsonSchemaType(property?.type);
    if (Array.isArray(property?.enum)) {
      type = property.enum.map((option: unknown) => `'${option}'`).join(" | ");
    }
    const bounds: string[] = [];
    if (typeof property?.minimum === "number") bounds.push(`min ${property.minimum}`);
    if (typeof property?.maximum === "number") bounds.push(`max ${property.maximum}`);
    const suffix = bounds.length ? ` (${bounds.join(", ")})` : "";
    return `${name}${required.has(name) ? "" : "?"}: ${type}${suffix}`;
  });
  return `{ ${parts.join(", ")} }`;
};

const Table = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) => (
  <div className="overflow-x-auto rounded-lg border">
    <table className="w-full text-sm">
      <thead className="bg-muted/50">
        <tr>
          {headers.map((header) => (
            <th key={header} className="px-3 py-2 text-left font-semibold text-foreground">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`${row[0]}-${rowIndex}`} className="border-t align-top">
            {row.map((cell, cellIndex) => (
              <td
                key={`${cell}-${cellIndex}`}
                className={`px-3 py-2 ${cellIndex <= 1 ? "font-mono text-xs" : ""}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function McpDocsPage() {
  const tools = listRegisteredMcpTools();
  const readTools = tools.filter((tool) => tool.scope === "mcp:read");
  const writeTools = tools.filter((tool) => tool.scope === "mcp:write");
  const resources = listRegisteredMcpResources();
  const prompts = listRegisteredMcpPrompts();
  const aliasNotes = tools
    .filter((tool) => tool.aliases?.length)
    .map((tool) => `${tool.aliases!.join(", ")} → ${tool.name}`);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/">
            <Logo size="md" />
          </Link>
          <Link href="/settings?section=advanced" className="text-sm text-muted-foreground hover:text-foreground">
            Back to Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            API Documentation
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">MCP Access</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Use TaskWiseAI as an MCP server with scoped workspace keys. This page covers setup,
            authentication, all MCP endpoints, JSON-RPC methods, available tools, resources,
            prompts, rate limits, and error handling. Client-specific install guides live in{" "}
            <code>docs/mcp-clients/</code> in the repository.
          </p>
        </section>

        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <h2 className="text-lg font-semibold">Quick Start</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Open <code>Settings {'->'} Advanced {'->'} MCP API</code> and generate a key.
            </li>
            <li>Copy your workspace endpoint and one-time secret key.</li>
            <li>
              In your MCP client, call <code>initialize</code>, then <code>tools/list</code>, then{" "}
              <code>tools/call</code>.
            </li>
            <li>
              Grant <code>mcp:write</code> only if the client must edit tasks or schedule
              reminders.
            </li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Authentication</h2>
          <p className="text-sm text-muted-foreground">
            For MCP JSON-RPC calls, send your key in one of the supported headers:
          </p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`Authorization: Bearer <YOUR_MCP_KEY>
# or:
X-Taskwise-Mcp-Key: <YOUR_MCP_KEY>
X-Mcp-Api-Key: <YOUR_MCP_KEY>
X-API-Key: <YOUR_MCP_KEY>`}
          </pre>
          <p className="text-sm text-muted-foreground">
            Endpoint format:
            <span className="ml-1 font-mono text-xs">
              /api/workspaces/{"{workspaceId}"}/mcp
            </span>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">HTTP Endpoints</h2>
          <Table
            headers={["Method", "Path", "Auth", "Purpose"]}
            rows={API_ENDPOINTS.map((endpoint) => [
              endpoint.method,
              endpoint.path,
              endpoint.auth,
              endpoint.purpose,
            ])}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">JSON-RPC Methods</h2>
          <Table
            headers={["Method", "Scope", "Behavior"]}
            rows={RPC_METHODS.map((method) => [method.method, method.scope, method.notes])}
          />
          <p className="text-xs text-muted-foreground">
            JSON-RPC notifications (requests with no <code>id</code>) return <code>202</code>{" "}
            with an empty response body.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Read Tools ({`mcp:read`}) — {readTools.length}
          </h2>
          <Table
            headers={["Tool", "Scope", "Arguments", "Description"]}
            rows={readTools.map((tool) => [
              tool.name,
              tool.scope,
              formatArgsFromJsonSchema(tool.jsonSchema),
              tool.description,
            ])}
          />
          {aliasNotes.length ? (
            <p className="text-xs text-muted-foreground">
              Compatibility aliases accepted on <code>tools/call</code> (never listed
              separately): {aliasNotes.join("; ")}.
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Write Tools ({`mcp:write`}) — {writeTools.length}
          </h2>
          <Table
            headers={["Tool", "Scope", "Arguments", "Description"]}
            rows={writeTools.map((tool) => [
              tool.name,
              tool.scope,
              formatArgsFromJsonSchema(tool.jsonSchema),
              tool.description,
            ])}
          />
          <p className="text-xs text-muted-foreground">
            Write calls are audit-logged and subject to write-specific rate limits.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Resources — {resources.length}</h2>
          <Table
            headers={["URI", "MIME type", "Description"]}
            rows={resources.map((resource) => [
              resource.uri,
              resource.mimeType,
              resource.description,
            ])}
          />
          <p className="text-xs text-muted-foreground">
            Read a resource with <code>resources/read</code> and{" "}
            <code>{`{ "uri": "taskwise://..." }`}</code>. Parameterized URIs (e.g. the meeting
            transcript) substitute the placeholder with a real id.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Prompts — {prompts.length}</h2>
          <Table
            headers={["Prompt", "Arguments", "Description"]}
            rows={prompts.map((prompt) => [
              prompt.name,
              (prompt.arguments || [])
                .map((argument) => `${argument.name}${argument.required ? "" : "?"}`)
                .join(", ") || "—",
              prompt.description,
            ])}
          />
          <p className="text-xs text-muted-foreground">
            Prompts are message templates served via <code>prompts/get</code>; they instruct
            YOUR model which tools/resources to call — the server never runs a model for them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Rate Limits</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Default request limit: <code>120</code> requests/minute per MCP key.
            </li>
            <li>
              Default write limit: <code>30</code> write tool calls/minute per MCP key.
            </li>
            <li>
              Configure via <code>MCP_RATE_LIMIT_REQUESTS_PER_MINUTE</code> and{" "}
              <code>MCP_RATE_LIMIT_WRITES_PER_MINUTE</code>.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">Response headers include:</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`X-Taskwise-Mcp-RateLimit-Limit
X-Taskwise-Mcp-RateLimit-Remaining
X-Taskwise-Mcp-RateLimit-Reset
X-Taskwise-Mcp-RateLimit-Write-Limit
X-Taskwise-Mcp-RateLimit-Write-Remaining
X-Taskwise-Mcp-RateLimit-Write-Reset
Retry-After   # when rate limited`}
          </pre>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Error Handling</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <code>401</code>: missing/invalid MCP key.
            </li>
            <li>
              <code>403</code>: workspace mismatch or missing required scope.
            </li>
            <li>
              <code>429</code>: rate limit exceeded.
            </li>
            <li>
              JSON-RPC errors:
              <code className="ml-1">-32600</code> invalid request,
              <code className="ml-1">-32601</code> method/tool not found,
              <code className="ml-1">-32602</code> invalid params,
              <code className="ml-1">-32002</code> resource not found,
              <code className="ml-1">-32001</code> rate limit exceeded.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Example Calls</h2>
          <p className="text-sm text-muted-foreground">Initialize session:</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`curl -X POST "https://www.taskwise.ai/api/workspaces/<workspaceId>/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_MCP_KEY>" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'`}
          </pre>

          <p className="text-sm text-muted-foreground">Search meetings:</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`curl -X POST "https://www.taskwise.ai/api/workspaces/<workspaceId>/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_MCP_KEY>" \\
  -d '{
    "jsonrpc": "2.0",
    "id": "search-1",
    "method": "tools/call",
    "params": {
      "name": "search_meetings",
      "arguments": { "query": "roadmap review", "limit": 5 }
    }
  }'`}
          </pre>

          <p className="text-sm text-muted-foreground">Read a resource:</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`curl -X POST "https://www.taskwise.ai/api/workspaces/<workspaceId>/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_MCP_KEY>" \\
  -d '{
    "jsonrpc": "2.0",
    "id": "res-1",
    "method": "resources/read",
    "params": { "uri": "taskwise://workspace/summary" }
  }'`}
          </pre>

          <p className="text-sm text-muted-foreground">
            Call a write tool (<code>mcp:write</code> required):
          </p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
{`curl -X POST "https://www.taskwise.ai/api/workspaces/<workspaceId>/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_MCP_KEY>" \\
  -d '{
    "jsonrpc": "2.0",
    "id": "write-1",
    "method": "tools/call",
    "params": {
      "name": "update_task_status",
      "arguments": {
        "taskId": "task_123",
        "status": "done"
      }
    }
  }'`}
          </pre>
        </section>
      </main>
    </div>
  );
}
