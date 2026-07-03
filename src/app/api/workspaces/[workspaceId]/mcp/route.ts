import { z } from "zod";
import { apiError, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import {
  findActiveMcpApiKeyByToken,
  touchMcpApiKeyUsage,
  type McpApiKeyDoc,
} from "@/lib/mcp-api-keys";
import {
  executeMcpTool,
  listMcpTools,
  resolveMcpToolScopeRequirement,
} from "@/lib/mcp-tools";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { registerAllMcpDefinitions } from "@/lib/mcp-register-all";
import {
  getMcpPromptDefinition,
  listRegisteredMcpPrompts,
  listRegisteredMcpResources,
  readRegisteredMcpResource,
} from "@/lib/mcp-registry";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";
import { enforceMcpApiKeyRateLimit, type McpRateLimitResult } from "@/lib/mcp-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Populate the MCP registry (tools/resources/prompts) exactly once per process.
registerAllMcpDefinitions();

type JsonRpcRequestId = string | number | null | undefined;

const JSON_RPC_VERSION = "2.0" as const;
const MCP_PROTOCOL_VERSION = "2025-03-26";

const mcpJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().trim().min(1),
  params: z.unknown().optional(),
});

const mcpToolCallParamsSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.record(z.unknown()).optional(),
});

const mcpResourceReadParamsSchema = z.object({
  uri: z.string().trim().min(1).max(2000),
});

const mcpPromptGetParamsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  arguments: z.record(z.string().max(4000)).optional(),
});

const METHOD_SCOPE_REQUIREMENTS: Record<string, string | null> = {
  "tools/list": "mcp:read",
  "resources/list": "mcp:read",
  "resources/read": "mcp:read",
  "prompts/list": "mcp:read",
  "prompts/get": "mcp:read",
};

const toJsonRpcResult = (id: JsonRpcRequestId, result: unknown) => ({
  jsonrpc: JSON_RPC_VERSION,
  id: id ?? null,
  result,
});

const toJsonRpcError = (
  id: JsonRpcRequestId,
  code: number,
  message: string,
  data?: unknown
) => ({
  jsonrpc: JSON_RPC_VERSION,
  id: id ?? null,
  error: {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  },
});

const extractMcpApiKeyFromRequest = (request: Request) => {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token?.trim()) {
      return token.trim();
    }
  }

  const headerCandidates = ["x-taskwise-mcp-key", "x-mcp-api-key", "x-api-key"];
  for (const headerName of headerCandidates) {
    const headerValue = request.headers.get(headerName);
    if (headerValue?.trim()) {
      return headerValue.trim();
    }
  }

  return null;
};

const shouldStreamResponse = (request: Request) => {
  const accept = request.headers.get("accept") || "";
  if (accept.toLowerCase().includes("text/event-stream")) {
    return true;
  }

  const url = new URL(request.url);
  return url.searchParams.get("stream") === "1";
};

const hasScope = (keyDoc: McpApiKeyDoc, requiredScope: string | null) => {
  if (!requiredScope) return true;

  const scopes = Array.isArray(keyDoc.scopes)
    ? keyDoc.scopes.map((scope: any) => String(scope || "").trim()).filter(Boolean)
    : [];

  // Compatibility mode: historically unscoped keys existed before method-level MCP scopes.
  if (!scopes.length) return true;

  if (scopes.includes("*") || scopes.includes(requiredScope)) {
    return true;
  }

  const namespace = requiredScope.split(":")[0]?.trim();
  if (namespace && scopes.includes(`${namespace}:*`)) {
    return true;
  }

  return false;
};

const buildBaseHeaders = (workspaceId: string, keyDoc: McpApiKeyDoc) => ({
  "Cache-Control": "no-store",
  "X-Taskwise-Workspace-Id": workspaceId,
  "X-Taskwise-Mcp-Key-Id": keyDoc._id,
});

const toEpochSeconds = (date: Date) => Math.max(0, Math.floor(date.getTime() / 1000));

const buildRateLimitHeaders = (rateLimitResult: McpRateLimitResult) => {
  const headers: Record<string, string> = {
    "X-Taskwise-Mcp-RateLimit-Limit": String(rateLimitResult.request.limit),
    "X-Taskwise-Mcp-RateLimit-Remaining": String(rateLimitResult.request.remaining),
    "X-Taskwise-Mcp-RateLimit-Reset": String(toEpochSeconds(rateLimitResult.request.resetAt)),
  };
  if (rateLimitResult.write) {
    headers["X-Taskwise-Mcp-RateLimit-Write-Limit"] = String(rateLimitResult.write.limit);
    headers["X-Taskwise-Mcp-RateLimit-Write-Remaining"] = String(
      rateLimitResult.write.remaining
    );
    headers["X-Taskwise-Mcp-RateLimit-Write-Reset"] = String(
      toEpochSeconds(rateLimitResult.write.resetAt)
    );
  }
  return headers;
};

const formatSseMessage = (payload: unknown) =>
  `event: message\ndata: ${JSON.stringify(payload)}\n\n`;

const toSseJsonRpcResponse = (
  payload: unknown,
  headers: Record<string, string>
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(formatSseMessage(payload)));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};

// Generalized audit-resource extraction so every write-scope tool (not just task
// writes) gets a meaningful resourceType/resourceId in mcpAuditLogs.
const AUDIT_RESOURCE_CANDIDATES: Array<{ dataKey: string; resourceType: string }> = [
  { dataKey: "task", resourceType: "task" },
  { dataKey: "reminder", resourceType: "reminder" },
  { dataKey: "meeting", resourceType: "meeting" },
  { dataKey: "person", resourceType: "person" },
  { dataKey: "board", resourceType: "board" },
];

const resolveAuditResource = (
  resultData: Record<string, unknown> | undefined,
  toolArguments: Record<string, unknown>
) => {
  for (const candidate of AUDIT_RESOURCE_CANDIDATES) {
    const value = (resultData as any)?.[candidate.dataKey];
    const id = value && typeof value === "object" ? (value as any).id : null;
    if (id) {
      return { resourceType: candidate.resourceType, resourceId: String(id) };
    }
  }
  const argTaskId = (toolArguments as any)?.taskId;
  if (argTaskId) {
    return { resourceType: "task", resourceId: String(argTaskId) };
  }
  return { resourceType: "workspace", resourceId: "" };
};

const createMethodResponse = async (
  db: any,
  requestBody: z.infer<typeof mcpJsonRpcRequestSchema>,
  workspaceId: string,
  keyDoc: McpApiKeyDoc,
  toolCallParams: z.infer<typeof mcpToolCallParamsSchema> | null
) => {
  switch (requestBody.method) {
    case "initialize":
      return toJsonRpcResult(requestBody.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: "taskwise-mcp",
          version: "0.1.0",
        },
        instructions:
          "Workspace-authenticated MCP endpoint. Use scoped API keys for read and write MCP tools.",
        context: {
          workspaceId,
          keyId: keyDoc._id,
          keyName: keyDoc.name,
        },
      });
    case "ping":
      return toJsonRpcResult(requestBody.id, {});
    case "tools/list":
      return toJsonRpcResult(requestBody.id, {
        tools: listMcpTools(),
      });
    case "tools/call": {
      if (!toolCallParams) {
        return toJsonRpcError(requestBody.id, -32602, "Invalid params for tools/call.");
      }
      const requiredScope = resolveMcpToolScopeRequirement(toolCallParams.name);
      const isWriteTool = requiredScope === "mcp:write";
      const toolArguments = toolCallParams.arguments || {};

      try {
        const toolResult = await executeMcpTool(
          db,
          workspaceId,
          toolCallParams.name,
          toolArguments
        );
        if (isWriteTool) {
          const auditResource = resolveAuditResource(
            (toolResult as any)?.data,
            toolArguments
          );
          await logMcpAuditEvent(db as any, {
            workspaceId,
            actorType: "api_key",
            apiKeyId: keyDoc._id,
            apiKeyName: keyDoc.name,
            action: "mcp.tool.call",
            resourceType: auditResource.resourceType,
            resourceId: auditResource.resourceId,
            status: "success",
            message: `Executed ${toolCallParams.name}`,
            metadata: {
              toolName: toolCallParams.name,
              keyPrefix: keyDoc.keyPrefix,
              taskId: (toolArguments as any)?.taskId || null,
            },
          });
        }

        return toJsonRpcResult(requestBody.id, {
          content: [{ type: "text", text: toolResult.summary }],
          structuredContent: toolResult.data,
        });
      } catch (error) {
        if (isWriteTool) {
          const auditResource = resolveAuditResource(undefined, toolArguments);
          await logMcpAuditEvent(db as any, {
            workspaceId,
            actorType: "api_key",
            apiKeyId: keyDoc._id,
            apiKeyName: keyDoc.name,
            action: "mcp.tool.call",
            resourceType: auditResource.resourceType,
            resourceId: auditResource.resourceId,
            status: "error",
            message:
              error instanceof Error
                ? `Failed ${toolCallParams.name}: ${error.message}`
                : `Failed ${toolCallParams.name}`,
            metadata: {
              toolName: toolCallParams.name,
              keyPrefix: keyDoc.keyPrefix,
              taskId: (toolArguments as any)?.taskId || null,
            },
          });
        }
        if (error instanceof McpToolCallError) {
          if (error.code === "tool_not_found") {
            return toJsonRpcError(requestBody.id, -32601, error.message);
          }
          return toJsonRpcError(
            requestBody.id,
            -32602,
            error.message,
            error.details
          );
        }
        throw error;
      }
    }
    case "resources/list":
      return toJsonRpcResult(requestBody.id, {
        resources: listRegisteredMcpResources().map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        })),
      });
    case "resources/read": {
      const parsedParams = mcpResourceReadParamsSchema.safeParse(
        requestBody.params || {}
      );
      if (!parsedParams.success) {
        return toJsonRpcError(
          requestBody.id,
          -32602,
          "Invalid params for resources/read.",
          parsedParams.error.flatten()
        );
      }

      try {
        const contents = await readRegisteredMcpResource(
          { db, workspaceId },
          parsedParams.data.uri
        );
        if (!contents) {
          return toJsonRpcError(
            requestBody.id,
            -32002,
            `Resource not found: ${parsedParams.data.uri}`,
            { uri: parsedParams.data.uri }
          );
        }
        return toJsonRpcResult(requestBody.id, {
          contents: [contents],
        });
      } catch (error) {
        if (error instanceof McpToolCallError) {
          return toJsonRpcError(requestBody.id, -32602, error.message, error.details);
        }
        throw error;
      }
    }
    case "prompts/list":
      return toJsonRpcResult(requestBody.id, {
        prompts: listRegisteredMcpPrompts().map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: (prompt.arguments || []).map((argument) => ({
            name: argument.name,
            ...(argument.description ? { description: argument.description } : {}),
            required: Boolean(argument.required),
          })),
        })),
      });
    case "prompts/get": {
      const parsedParams = mcpPromptGetParamsSchema.safeParse(requestBody.params || {});
      if (!parsedParams.success) {
        return toJsonRpcError(
          requestBody.id,
          -32602,
          "Invalid params for prompts/get.",
          parsedParams.error.flatten()
        );
      }

      const promptDefinition = getMcpPromptDefinition(parsedParams.data.name);
      if (!promptDefinition) {
        return toJsonRpcError(
          requestBody.id,
          -32602,
          `Prompt not found: ${parsedParams.data.name}`
        );
      }

      const promptArguments = parsedParams.data.arguments || {};
      const missingArguments = (promptDefinition.arguments || [])
        .filter(
          (argument) =>
            argument.required && !String(promptArguments[argument.name] || "").trim()
        )
        .map((argument) => argument.name);
      if (missingArguments.length) {
        return toJsonRpcError(
          requestBody.id,
          -32602,
          `Missing required prompt arguments: ${missingArguments.join(", ")}`,
          { missing: missingArguments }
        );
      }

      try {
        const prompt = await promptDefinition.handler(
          { db, workspaceId },
          promptArguments
        );
        return toJsonRpcResult(requestBody.id, {
          description: prompt.description,
          messages: prompt.messages,
        });
      } catch (error) {
        if (error instanceof McpToolCallError) {
          return toJsonRpcError(requestBody.id, -32602, error.message, error.details);
        }
        throw error;
      }
    }
    default:
      return toJsonRpcError(
        requestBody.id,
        -32601,
        `Method not found: ${requestBody.method}`
      );
  }
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-Taskwise-Mcp-Key, X-Mcp-Api-Key, X-API-Key",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const apiKey = extractMcpApiKeyFromRequest(request);
    if (!apiKey) {
      return apiError(
        401,
        "request_error",
        "Missing MCP API key. Use Authorization: Bearer <key>."
      );
    }

    const db = await getDb();
    const keyDoc = await findActiveMcpApiKeyByToken(db as any, apiKey);
    if (!keyDoc) {
      return apiError(401, "request_error", "Invalid or expired MCP API key.");
    }
    if (keyDoc.workspaceId !== workspaceId) {
      return apiError(403, "forbidden", "MCP API key does not belong to this workspace.");
    }

    const rawBody = await request.json().catch(() => null);
    const parsedBody = mcpJsonRpcRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return Response.json(
        toJsonRpcError(null, -32600, "Invalid Request", parsedBody.error.flatten()),
        {
          status: 400,
          headers: buildBaseHeaders(workspaceId, keyDoc),
        }
      );
    }

    const requestBody = parsedBody.data;
    let toolCallParams: z.infer<typeof mcpToolCallParamsSchema> | null = null;
    if (requestBody.method === "tools/call") {
      const parsedToolCall = mcpToolCallParamsSchema.safeParse(requestBody.params || {});
      if (!parsedToolCall.success) {
        return Response.json(
          toJsonRpcError(
            requestBody.id,
            -32602,
            "Invalid params for tools/call.",
            parsedToolCall.error.flatten()
          ),
          {
            status: 400,
            headers: buildBaseHeaders(workspaceId, keyDoc),
          }
        );
      }
      toolCallParams = parsedToolCall.data;
    }

    const requiredScope =
      requestBody.method === "tools/call"
        ? resolveMcpToolScopeRequirement(toolCallParams?.name || "")
        : METHOD_SCOPE_REQUIREMENTS[requestBody.method] || null;
    if (!hasScope(keyDoc, requiredScope)) {
      return apiError(
        403,
        "forbidden",
        "MCP API key is missing required scope.",
        requiredScope ? { requiredScope, method: requestBody.method } : undefined
      );
    }

    const isWriteRequest =
      requestBody.method === "tools/call" && requiredScope === "mcp:write";
    let rateLimitResult: McpRateLimitResult | null = null;
    try {
      rateLimitResult = await enforceMcpApiKeyRateLimit(db as any, {
        workspaceId,
        apiKeyId: keyDoc._id,
        isWriteRequest,
      });
    } catch (error) {
      // Keep MCP available if rate-limit persistence/index setup is unavailable.
      console.error("MCP rate-limit enforcement failed; proceeding without limit checks.", error);
    }

    const responseHeaders = {
      ...buildBaseHeaders(workspaceId, keyDoc),
      ...(rateLimitResult ? buildRateLimitHeaders(rateLimitResult) : {}),
    };

    if (rateLimitResult && !rateLimitResult.allowed) {
      const blockedLimit = rateLimitResult.blocked || rateLimitResult.request;
      const blockedHeaders = {
        ...responseHeaders,
        "Retry-After": String(blockedLimit.retryAfterSeconds),
      };

      // Notification payloads (without `id`) should not return JSON-RPC bodies.
      if (requestBody.id === undefined) {
        return new Response(null, {
          status: 429,
          headers: blockedHeaders,
        });
      }

      return Response.json(
        toJsonRpcError(requestBody.id, -32001, "MCP rate limit exceeded.", {
          category: blockedLimit.category,
          limit: blockedLimit.limit,
          retryAfterSeconds: blockedLimit.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: blockedHeaders,
        }
      );
    }

    await touchMcpApiKeyUsage(db as any, keyDoc._id);

    // JSON-RPC notification (no id) intentionally has no response payload.
    if (requestBody.id === undefined) {
      return new Response(null, {
        status: 202,
        headers: responseHeaders,
      });
    }

    const methodResponse = await createMethodResponse(
      db,
      requestBody,
      workspaceId,
      keyDoc,
      toolCallParams
    );

    if (shouldStreamResponse(request)) {
      return toSseJsonRpcResponse(methodResponse, responseHeaders);
    }

    return Response.json(methodResponse, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    return mapApiError(error, "Failed to process MCP request.");
  }
}
