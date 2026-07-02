import type { ExtractedTaskSchema } from "@/types/chat";

const truncateText = (value: string, maxLength = 2000) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const toSlackMarkdown = (text: string): string =>
  text
    .replace(/\*\*(.*?)\*\*/g, "*$1*")
    .replace(/^### (.*?)$/gm, "*$1*")
    .replace(/^## (.*?)$/gm, "*$1*")
    .replace(/^# (.*?)$/gm, "*$1*");

export const formatTasksToSlackBlocks = (
  tasks: ExtractedTaskSchema[],
  sourceTitle: string,
  customMessage?: string,
  includeAiContent?: boolean
) => {
  const blocks: Array<{ type: string; [key: string]: any }> = [];

  if (customMessage) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncateText(customMessage, 2500) },
    });
  }

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `Action Items from: ${sourceTitle}`, emoji: true },
  });
  blocks.push({ type: "divider" });

  const addTasks = (items: ExtractedTaskSchema[], level = 0) => {
    items.forEach((task: any) => {
      const indent = "  ".repeat(level);
      const taskText = `${indent}- *${task.title}*`;
      const details: string[] = [];
      if (task.priority && task.priority !== "medium") {
        details.push(`_Priority: ${task.priority}_`);
      }
      const assignee = task.assignee?.name || task.assigneeName;
      const assigneeSlackId = task.assignee?.slackId;
      if (assigneeSlackId) {
        details.push(`*Owner:* <@${assigneeSlackId}>`);
      } else if (assignee) {
        details.push(`*Owner:* ${assignee}`);
      }
      if (task.dueAt) {
        const date = new Date(task.dueAt);
        if (!Number.isNaN(date.getTime())) {
          details.push(`_Due: ${date.toLocaleDateString()}_`);
        }
      }
      const composed =
        details.length > 0 ? `${taskText}\n>${details.join(" | ")}` : taskText;

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: truncateText(composed) },
      });

      if (task.description) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: truncateText(`*Description:* ${task.description}`, 2000),
            },
          ],
        });
      }

      if (includeAiContent) {
        if (task.researchBrief) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: truncateText(
                `*AI Research Brief*\n${toSlackMarkdown(task.researchBrief)}`,
                2500
              ),
            },
          });
        }
        if (task.aiAssistanceText) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: truncateText(
                `*AI Assistance*\n${toSlackMarkdown(task.aiAssistanceText)}`,
                2500
              ),
            },
          });
        }
      }

      if (task.subtasks?.length) {
        addTasks(task.subtasks, level + 1);
      }
    });
  };

  addTasks(tasks);

  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Shared from *TaskWiseAI*" }],
  });

  return blocks.slice(0, 50);
};

