const MEETING_COUNT_THIS_WEEK_REGEX =
  /\bhow many meetings\b.*\bthis week\b|\bhow many\b.*\bmeetings did we have this week\b/i;

const WEEKLY_MEETING_OVERVIEW_REGEX =
  /\b(?:what|which|list|show)\b.*\bmeetings?\b.*\bthis week\b|\bmeetings?\b.*\b(?:this week|week)\b/i;

const OPERATIONAL_CALENDAR_REGEX =
  /\bhow many meetings\b|\bthis week\b|\bcalendar\b|\bagenda\b/i;

export type ChatWorkspaceToolName =
  | "get_calendar_agenda"
  | "list_clients"
  | "get_client_commitments"
  | "list_tasks";

export type ChatWorkspaceQueryPlan =
  | { mode: "workspace_retrieval" }
  | {
      mode: "workspace_tool";
      toolName: ChatWorkspaceToolName;
      toolArgs: Record<string, unknown>;
      rationale: string;
    };

const startOfIsoWeek = (date: Date) => {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const endOfIsoWeek = (date: Date) => {
  const copy = startOfIsoWeek(date);
  copy.setUTCDate(copy.getUTCDate() + 6);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
};

export function planWorkspaceChatQuestion(
  question: string,
  now: Date = new Date()
): ChatWorkspaceQueryPlan {
  const trimmed = question.trim();
  const weeklyToolArgs = {
    from: startOfIsoWeek(now).toISOString(),
    to: endOfIsoWeek(now).toISOString(),
  };
  if (MEETING_COUNT_THIS_WEEK_REGEX.test(trimmed)) {
    return {
      mode: "workspace_tool",
      toolName: "get_calendar_agenda",
      toolArgs: weeklyToolArgs,
      rationale: "meeting_count_this_week",
    };
  }

  if (
    WEEKLY_MEETING_OVERVIEW_REGEX.test(trimmed) ||
    (OPERATIONAL_CALENDAR_REGEX.test(trimmed) &&
      /\bhow many\b/i.test(trimmed) &&
      /\bmeeting/i.test(trimmed))
  ) {
    return {
      mode: "workspace_tool",
      toolName: "get_calendar_agenda",
      toolArgs: weeklyToolArgs,
      rationale: "weekly_meetings_overview",
    };
  }

  return { mode: "workspace_retrieval" };
}
