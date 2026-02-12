import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { generateResearchBrief } from "@/ai/flows/generate-research-brief-flow";
import { generateTaskAssistance } from "@/ai/flows/generate-task-assistance-flow";

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
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ briefQuota: getBriefQuota(user) });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const payload = parsed.data;
  const quota = getBriefQuota(user);

  if (payload.mode === "brief") {
    if (quota.remaining <= 0) {
      return NextResponse.json(
        {
          error: "Monthly AI Brief limit reached (10/10).",
          briefQuota: quota,
        },
        { status: 429 }
      );
    }
    try {
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

      return NextResponse.json({
        mode: "brief",
        researchBrief: brief.researchBrief,
        briefQuota: {
          ...quota,
          used: nextUsed,
          remaining: Math.max(0, BRIEF_LIMIT_PER_MONTH - nextUsed),
        },
      });
    } catch (error) {
      console.error("Failed to generate task brief:", error);
      return NextResponse.json(
        { error: "Failed to generate brief. Please try again." },
        { status: 500 }
      );
    }
  }
  try {
    const assistance = await generateTaskAssistance({
      taskTitle: payload.taskTitle,
      taskDescription: payload.taskDescription,
    });

    return NextResponse.json({
      mode: "assistance",
      assistanceMarkdown: assistance.assistanceMarkdown,
      briefQuota: quota,
    });
  } catch (error) {
    console.error("Failed to generate task assistance:", error);
    return NextResponse.json(
      { error: "Failed to generate assistance. Please try again." },
      { status: 500 }
    );
  }
}
