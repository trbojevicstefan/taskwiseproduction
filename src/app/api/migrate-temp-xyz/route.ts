
import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { syncTasksForSource } from "../../../lib/task-sync";
import type { ExtractedTaskSchema } from "../../../types/chat";

export async function GET() {
    console.log("Starting migration via API...");
    const db = await getDb();

    // 1. Migrate Meetings
    const meetings = await db.collection("meetings").find({}).toArray();
    let meetingsUpdated = 0;

    for (const meeting of meetings) {
        if (!meeting.extractedTasks || !meeting.extractedTasks.length) continue;

        // We migrate if we find any task that looks like a full task object (has definition but no taskId/canonicalId)
        // Or just re-sync everything to be safe.

        const userId = meeting.userId;
        const workspaceId = meeting.workspaceId;

        try {
            // Sync to ensure canonical tasks exist
            const syncResult = await syncTasksForSource(db, meeting.extractedTasks, {
                userId,
                workspaceId,
                sourceSessionId: String(meeting._id),
                sourceSessionType: "meeting",
                sourceSessionName: meeting.title || "Meeting",
                origin: "meeting",
                taskState: "active",
            });

            // Convert to references (thin)
            const referencedTasks = meeting.extractedTasks.map((task: any) => {
                const canonicalId = syncResult.taskMap.get(task.id);
                if (!canonicalId) return task;

                return {
                    taskId: canonicalId,
                    sourceTaskId: task.id,
                    title: task.title,
                    // No extracted status/description in reference
                };
            });

            await db.collection("meetings").updateOne(
                { _id: meeting._id },
                { $set: { extractedTasks: referencedTasks } }
            );
            meetingsUpdated++;
        } catch (e) {
            console.error(`Failed to migrate meeting ${meeting._id}:`, e);
        }
    }

    // 2. Migrate Chat Sessions
    const chats = await db.collection("chatSessions").find({}).toArray();
    let chatsUpdated = 0;

    for (const chat of chats) {
        if (!chat.suggestedTasks || !chat.suggestedTasks.length) continue;
        const userId = chat.userId;

        try {
            const syncResult = await syncTasksForSource(db, chat.suggestedTasks, {
                userId,
                sourceSessionId: String(chat._id),
                sourceSessionType: "chat",
                sourceSessionName: chat.title || "Chat Session",
                origin: "chat",
                taskState: "active",
            });

            const referencedTasks = chat.suggestedTasks.map((task: any) => {
                const canonicalId = syncResult.taskMap.get(task.id);
                if (!canonicalId) return task;

                return {
                    taskId: canonicalId,
                    sourceTaskId: task.id,
                    title: task.title,
                };
            });

            await db.collection("chatSessions").updateOne(
                { _id: chat._id },
                { $set: { suggestedTasks: referencedTasks } }
            );
            chatsUpdated++;
        } catch (e) {
            console.error(`Failed to migrate chat ${chat._id}:`, e);
        }
    }

    return NextResponse.json({
        status: "success",
        meetingsMigrated: meetingsUpdated,
        chatsMigrated: chatsUpdated
    });
}
