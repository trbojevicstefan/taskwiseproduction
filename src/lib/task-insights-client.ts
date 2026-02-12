import { apiFetch } from "@/lib/api";

export type BriefQuota = {
  limit: number;
  used: number;
  remaining: number;
  month: string;
};

export type GenerateTaskBriefPayload = {
  taskTitle: string;
  taskDescription?: string;
  assigneeName?: string;
  taskPriority?: "low" | "medium" | "high";
  primaryTranscript?: string;
  relatedTranscripts?: string[];
};

export type GenerateTaskAssistancePayload = {
  taskTitle: string;
  taskDescription?: string;
};

type BriefResponse = {
  mode: "brief";
  researchBrief: string;
  briefQuota: BriefQuota;
};

type AssistanceResponse = {
  mode: "assistance";
  assistanceMarkdown: string;
  briefQuota: BriefQuota;
};

export const fetchBriefQuota = async (): Promise<BriefQuota> => {
  const result = await apiFetch<{ briefQuota: BriefQuota }>("/api/ai/task-insights", {
    cache: "no-store",
  });
  return result.briefQuota;
};

export const generateTaskBrief = async (
  payload: GenerateTaskBriefPayload
): Promise<BriefResponse> => {
  return apiFetch<BriefResponse>("/api/ai/task-insights", {
    method: "POST",
    body: JSON.stringify({
      mode: "brief",
      ...payload,
    }),
  });
};

export const generateTaskAssistanceText = async (
  payload: GenerateTaskAssistancePayload
): Promise<AssistanceResponse> => {
  return apiFetch<AssistanceResponse>("/api/ai/task-insights", {
    method: "POST",
    body: JSON.stringify({
      mode: "assistance",
      ...payload,
    }),
  });
};
