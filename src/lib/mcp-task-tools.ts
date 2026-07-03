import type { McpToolDefinition } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: task tools.
 *
 * OWNED BY the task-tools pack agent. Fill TASK_TOOLS with registry definitions for:
 * list_tasks, update_task_status, assign_task, set_task_due_date, prioritize_tasks,
 * create_task_from_meeting, schedule_slack_reminder.
 * Registration is already wired — src/lib/mcp-register-all.ts imports this module
 * exactly once. Do NOT edit any shared MCP file (registry, register-all, mcp-tools,
 * route) from this pack.
 *
 * Conventions:
 * - Mutating tools MUST use scope: "mcp:write" (drives scope checks, the write
 *   rate-limit bucket, and audit logging in the route). prioritize_tasks,
 *   create_task_from_meeting, and schedule_slack_reminder are writes.
 * - Prefer existing domain helpers over reimplementing logic:
 *   @/lib/task-priority (computeTaskPriority), @/lib/task-reminders
 *   (buildTaskReminderDedupKey, ensureTaskReminderIndexes, cancelRemindersForTask,
 *   enqueueReminderSweepJob), @/lib/jobs/store (enqueueJob), @/lib/domain-events
 *   (publishDomainEvent for task.status.changed).
 * - NEVER call syncTasksForSource with a partial task list — it deletes canonical
 *   tasks missing from the incoming embedded list for that source session.
 * - MCP has no session user: use task.userId as the actor userId; existing write
 *   tools (src/lib/mcp-write-tools.ts) are the precedent.
 * - Keep review-owned fields (cleanup and priority fields) OUT of any meeting re-sync $set.
 * - Validate ALL args with zod; explicit max limits (hostile input).
 * - Shared helpers live in @/lib/mcp-tool-helpers.
 */
const TASK_TOOLS: McpToolDefinition[] = [];

export const getMcpTaskToolDefinitions = (): McpToolDefinition[] => TASK_TOOLS;
