export type AutomationHealthState = "active" | "paused" | "needs_attention";

export type AutomationHealthInput = {
  enabled: boolean;
  autoDisabledAt?: string | null;
};

export const getAutomationHealthState = (
  workflow: AutomationHealthInput
): AutomationHealthState => {
  if (workflow.autoDisabledAt) return "needs_attention";
  return workflow.enabled ? "active" : "paused";
};

export const buildAutomationHealthSummary = (
  workflows: AutomationHealthInput[]
) =>
  workflows.reduce(
    (summary, workflow) => {
      const state = getAutomationHealthState(workflow);
      summary.total += 1;
      if (state === "active") summary.active += 1;
      if (state === "paused") summary.paused += 1;
      if (state === "needs_attention") summary.needsAttention += 1;
      return summary;
    },
    { total: 0, active: 0, paused: 0, needsAttention: 0 }
  );

export type AutomationTemplateId =
  | "meeting-webhook"
  | "meeting-updated"
  | "client-handoff";

export type AutomationTemplateDraft = {
  name: string;
  description: string;
  trigger: "meeting.ingested" | "meeting.updated";
};

const TEMPLATE_DRAFTS: Record<AutomationTemplateId, AutomationTemplateDraft> = {
  "meeting-webhook": {
    name: "Meeting handoff",
    description: "Send each newly processed meeting to another system.",
    trigger: "meeting.ingested",
  },
  "meeting-updated": {
    name: "Meeting update handoff",
    description: "Notify another system when a meeting record changes.",
    trigger: "meeting.updated",
  },
  "client-handoff": {
    name: "Client meeting handoff",
    description: "Forward processed client meeting data to a downstream workflow.",
    trigger: "meeting.ingested",
  },
};

export const getAutomationTemplateDraft = (
  templateId: AutomationTemplateId
): AutomationTemplateDraft => ({ ...TEMPLATE_DRAFTS[templateId] });
