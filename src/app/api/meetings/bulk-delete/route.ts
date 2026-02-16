import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";

const bulkDeleteMeetingsSchema = z.object({
  ids: z.array(z.union([z.string(), z.number()])).min(1),
});

const collectDescendantTaskIds = async (
  db: any,
  userId: string,
  parentIds: string[]
) => {
  const allIds = new Set<string>(parentIds);
  const queue = [...parentIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, 200);
    const children = await db
      .collection("tasks")
      .find({
        userId,
        parentId: { $in: batch },
      })
      .project({ _id: 1 })
      .toArray();

    children.forEach((child: any) => {
      const childId = String(child._id);
      if (!allIds.has(childId)) {
        allIds.add(childId);
        queue.push(childId);
      }
    });
  }

  return Array.from(allIds);
};

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const body = await parseJsonBody(
      request,
      bulkDeleteMeetingsSchema,
      "Meeting IDs are required."
    );
    const uniqueIds = Array.from(
      new Set(body.ids.map((id: string | number) => String(id)).filter(Boolean))
    );
    if (!uniqueIds.length) {
      return apiError(400, "invalid_payload", "Meeting IDs are required.");
    }

    const db = await getDb();
    const meetingFilter = {
      userId,
      $or: [{ _id: { $in: uniqueIds } }, { id: { $in: uniqueIds } }],
    };

    const meetings = await db
      .collection("meetings")
      .find(meetingFilter)
      .toArray();

    if (meetings.length === 0) {
      return apiError(404, "not_found", "Meetings not found.");
    }

    const sessionIds = new Set<string>();
    const chatSessionIds = new Set<string>();
    meetings.forEach((meeting: any) => {
      if (meeting?._id) sessionIds.add(String(meeting._id));
      if (meeting?.id) sessionIds.add(String(meeting.id));
      if (meeting?.chatSessionId) {
        chatSessionIds.add(String(meeting.chatSessionId));
      }
    });
    uniqueIds.forEach((id: string) => sessionIds.add(String(id)));

    const now = new Date();
    await db.collection("meetings").updateMany(meetingFilter, {
      $set: {
        isHidden: true,
        hiddenAt: now,
        lastActivityAt: now,
        extractedTasks: [],
      },
    });

    const sessionIdList = Array.from(sessionIds);
    const tasksToRemove = await db
      .collection("tasks")
      .find({
        userId,
        sourceSessionType: "meeting",
        sourceSessionId: { $in: sessionIdList },
      })
      .project({ _id: 1 })
      .toArray();
    const rootTaskIds = tasksToRemove.map((task: any) => String(task._id));
    const taskIds = await collectDescendantTaskIds(db, userId, rootTaskIds);

    const deleteResult = await db.collection("tasks").deleteMany({
      userId,
      _id: { $in: taskIds },
    });

    if (taskIds.length) {
      await db.collection("boardItems").deleteMany({
        userId,
        taskId: { $in: taskIds },
      });
    }

    const chatMeetingIds = Array.from(sessionIds);
    const chatIds = Array.from(chatSessionIds);
    if (chatMeetingIds.length || chatIds.length) {
      await db.collection("chatSessions").deleteMany({
        userId,
        $or: [
          chatMeetingIds.length
            ? { sourceMeetingId: { $in: chatMeetingIds } }
            : undefined,
          chatIds.length ? { _id: { $in: chatIds } } : undefined,
          chatIds.length ? { id: { $in: chatIds } } : undefined,
        ].filter(Boolean),
      });
    }

    return apiSuccess({
      deletedMeetings: meetings.length,
      deletedTasks: deleteResult.deletedCount || 0,
    });
  } catch (error) {
    return mapApiError(error, "Failed to bulk delete meetings.");
  }
}

