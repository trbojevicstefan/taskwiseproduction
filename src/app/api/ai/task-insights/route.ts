import { z } from "zod";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { generateResearchBrief } from "@/ai/flows/generate-research-brief-flow";
import { generateTaskAssistance } from "@/ai/flows/generate-task-assistance-flow";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";

const BRIEF_LIMIT_PER_MONTH = 10;

const requestSchema = z.object({
  mode: z.enum(["brief", "assistance"]),
  taskTitle: z.string().min(1).max(400),
  taskDescription: z.string().optional(),
  assigneeName: z.string().optional(),
  taskPriority: z.enum(["low", "medium", "high"]).optional(),
  primaryTranscript: z.string().optional(),
  relatedTranscripts: z.array(z.string()).optional(),
});

type BriefQuota = {
  limit: number;
  used: number;
  remaining: number;
  month: string;
};

const toMonthKey = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

const getBriefQuota = (
  user: Awaited<ReturnType<typeof findUserById>>,
  month = toMonthKey()
): BriefQuota => {
  const used =
    user?.briefGenerationMonth === month
      ? Math.max(0, Number(user.briefGenerationCount || 0))
      : 0;
  const remaining = Math.max(0, BRIEF_LIMIT_PER_MONTH - used);
  return {
    limit: BRIEF_LIMIT_PER_MONTH,
    used,
    remaining,
    month,
  };
};

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const user = await findUserById(userId);
    if (!user) {
      return apiError(404, "not_found", "User not found.");
    }

    return apiSuccess({ briefQuota: getBriefQuota(user) });
  } catch (error) {
    return mapApiError(error, "Failed to fetch task insights quota.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const payload = await parseJsonBody(request, requestSchema, "Invalid request payload.");
    const user = await findUserById(userId);
    if (!user) {
      return apiError(404, "not_found", "User not found.");
    }

    const quota = getBriefQuota(user);

    if (payload.mode === "brief") {
      if (quota.remaining <= 0) {
        return apiError(429, "quota_exceeded", "Monthly AI Brief limit reached (10/10).", {
          briefQuota: quota,
        });
      }

      const brief = await generateResearchBrief({
        taskTitle: payload.taskTitle,
        taskDescription: payload.taskDescription,
        assigneeName: payload.assigneeName,
        taskPriority: payload.taskPriority,
        primaryTranscript: payload.primaryTranscript,
        relatedTranscripts: payload.relatedTranscripts,
      });

      const nextUsed = quota.used + 1;
      await updateUserById(userId, {
        briefGenerationMonth: quota.month,
        briefGenerationCount: nextUsed,
      });

      return apiSuccess({
        mode: "brief",
        researchBrief: brief.researchBrief,
        briefQuota: {
          ...quota,
          used: nextUsed,
          remaining: Math.max(0, BRIEF_LIMIT_PER_MONTH - nextUsed),
        },
      });
    }

    const assistance = await generateTaskAssistance({
      taskTitle: payload.taskTitle,
      taskDescription: payload.taskDescription,
    });

    return apiSuccess({
      mode: "assistance",
      assistanceMarkdown: assistance.assistanceMarkdown,
      briefQuota: quota,
    });
  } catch (error) {
    return mapApiError(error, "Failed to generate task insight.");
  }
}
