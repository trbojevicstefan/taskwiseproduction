import { z } from "zod";
import type { Db } from "mongodb";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

/**
 * Shared helpers for MCP tool packs (Phase 8).
 *
 * Packs (mcp-meeting-tools / mcp-task-tools / mcp-workspace-tools / mcp-resources /
 * mcp-prompts) should use these instead of re-implementing validation, clamping,
 * serialization, or workspace scoping. Keep every new limit explicit — MCP inputs
 * are hostile (assume prompt-injected clients).
 */

/** Default cap for list-style tool limits (people/meetings precedent). */
export const MCP_MAX_LIST_LIMIT = 100;

/** zod-parse tool args, throwing the canonical invalid_arguments McpToolCallError. */
export const parseMcpToolArgs = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  rawArgs: Record<string, unknown> | undefined
): z.infer<TSchema> => {
  const parsed = schema.safeParse(rawArgs || {});
  if (!parsed.success) {
    throw new McpToolCallError(
      "invalid_arguments",
      "Invalid tool arguments.",
      parsed.error.flatten()
    );
  }
  return parsed.data as z.infer<TSchema>;
};

/** Clamp a numeric limit into [1, max], falling back when absent/invalid. */
export const clampListLimit = (
  value: unknown,
  fallback: number,
  max: number = MCP_MAX_LIST_LIMIT
) => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(numeric, 1), max);
};

/** ISO-serialize Date values; pass through other values (null when nullish). */
export const serializeDateValue = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? null;
};

/** Truncate text to maxLength, appending an ellipsis marker when cut. */
export const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

/** Escape user-supplied strings before embedding them in a RegExp. */
export const escapeRegexPattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Distinct active member userIds for a workspace (for legacy fallback scoping). */
export const getWorkspaceMemberUserIds = async (db: Db, workspaceId: string) => {
  const memberships = await listActiveWorkspaceMembershipsForWorkspace(db, workspaceId);
  return Array.from(
    new Set(
      memberships
        .map((membership: any) => String(membership?.userId || "").trim())
        .filter(Boolean)
    )
  );
};

/**
 * Workspace scope with legacy fallback: docs stamped with the workspaceId, plus
 * pre-workspace docs owned by current members (people/tasks/meetings precedent).
 */
export const buildWorkspaceFallbackScope = (
  workspaceId: string,
  workspaceMemberUserIds: string[]
) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: workspaceMemberUserIds },
    },
  ],
});
