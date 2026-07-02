import { formatTasksToSlackBlocks } from "@/lib/slack-format";
import { getValidSlackToken } from "@/lib/slack";
import type { ExtractedTaskSchema } from "@/types/chat";

type SlackAutomationUser = {
  slackTeamId?: string | null;
  slackAutoShareEnabled?: boolean;
  slackAutoShareChannelId?: string | null;
};

type PostMeetingAutomationToSlackParams = {
  user: SlackAutomationUser;
  meetingTitle: string;
  meetingSummary?: string | null;
  tasks: ExtractedTaskSchema[];
};

const buildSummaryMessage = (meetingSummary?: string | null) => {
  const summary = typeof meetingSummary === "string" ? meetingSummary.trim() : "";
  if (!summary) {
    return "*Meeting Summary*\n_No summary was generated for this meeting._";
  }
  return `*Meeting Summary*\n${summary}`;
};

export const postMeetingAutomationToSlack = async ({
  user,
  meetingTitle,
  meetingSummary,
  tasks,
}: PostMeetingAutomationToSlackParams): Promise<boolean> => {
  if (!user?.slackAutoShareEnabled) return false;

  const teamId = user.slackTeamId;
  const channelId = user.slackAutoShareChannelId;
  if (!teamId || !channelId) return false;

  const safeTitle = meetingTitle?.trim() || "Meeting";
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  try {
    const accessToken = await getValidSlackToken(teamId);
    const baseBlocks = formatTasksToSlackBlocks(
      safeTasks,
      safeTitle,
      buildSummaryMessage(meetingSummary),
      false
    );
    const blocks =
      safeTasks.length > 0
        ? baseBlocks
        : [
            ...baseBlocks.slice(0, 3),
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "_No action items were detected for this meeting._",
              },
            },
            ...baseBlocks.slice(3),
          ];

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        blocks: blocks.slice(0, 50),
        text: `Meeting summary and action items from: ${safeTitle}`,
      }),
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      throw new Error(payload.error || "Slack post failed.");
    }
    return true;
  } catch (error) {
    console.error("Failed to auto-share meeting to Slack:", error);
    return false;
  }
};
