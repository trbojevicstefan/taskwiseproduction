import type { Db } from "mongodb";
import type { ChatWorkspaceToolName } from "@/lib/chat-query-planner";
import { getMcpWorkspaceToolDefinitions } from "@/lib/mcp-workspace-tools";

export type InternalChatToolResult = {
  summary: string;
  contextBlocks: string;
  answerHint?: string;
};

const renderCalendarAgendaContext = (data: any): string => {
  const lines: string[] = [`AGENDA_RANGE ${data.from} | ${data.to}`];

  for (const meeting of Array.isArray(data.meetings) ? data.meetings : []) {
    const day =
      typeof meeting.startTime === "string"
        ? meeting.startTime.slice(0, 10)
        : "unknown";
    lines.push(
      `MEETING ${meeting.id} | ${meeting.title} | ${day} | attendees=${
        meeting.attendeeCount ?? 0
      } | clientMeeting=${Boolean(meeting.isClientMeeting)}`
    );
  }

  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    lines.push(
      `TASK ${task.id} | ${task.title} | due=${task.dueAt ?? "none"} | status=${
        task.status ?? "unknown"
      } | overdue=${Boolean(task.overdue)}`
    );
  }

  for (const reminder of Array.isArray(data.reminders) ? data.reminders : []) {
    lines.push(
      `REMINDER ${reminder.id} | task=${
        reminder.taskTitle || reminder.taskId || "unknown"
      } | runAt=${reminder.runAt}`
    );
  }

  return lines.join("\n");
};

export async function runInternalChatTool(params: {
  db: Db;
  workspaceId: string;
  toolName: ChatWorkspaceToolName;
  toolArgs: Record<string, unknown>;
}): Promise<InternalChatToolResult> {
  const definitions = getMcpWorkspaceToolDefinitions();
  const tool = definitions.find((entry) => entry.name === params.toolName);
  if (!tool) {
    throw new Error(`Unsupported internal chat tool: ${params.toolName}`);
  }

  const payload = await tool.handler(
    { db: params.db, workspaceId: params.workspaceId } as any,
    params.toolArgs
  );

  if (params.toolName === "get_calendar_agenda") {
    return {
      summary: payload.summary,
      contextBlocks: renderCalendarAgendaContext(payload.data),
      answerHint:
        "Use the agenda rows to answer operational questions deterministically.",
    };
  }

  return {
    summary: payload.summary,
    contextBlocks: JSON.stringify(payload.data),
  };
}
