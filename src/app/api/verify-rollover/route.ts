
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";
import { extractTasksFromChat } from "@/ai/flows/extract-tasks";
import { findPreviousMeeting } from "@/lib/meeting-series";
import { v4 as uuidv4 } from 'uuid';
import { syncTasksForSource } from "@/lib/task-sync";

export async function GET() {
    console.log("🚀 Starting End-to-End Rollover Verification API...");

    const userId = "test-user-simulation-" + Date.now();
    const db = await getDb();
    let log = "";
    const logMsg = (msg: string) => { console.log(msg); log += msg + "\n"; };

    try {
        // 1. Create Meeting A
        logMsg("📅 Creating Meeting A (Previous)...");
        const meetingAId = new ObjectId();
        const task1Id = uuidv4();
        const task2Id = uuidv4();

        const workspaceId = "ws-test-" + Date.now();

        const meetingA = {
            _id: meetingAId,
            id: meetingAId.toString(),
            userId,
            workspaceId, // Required for series detection
            title: "Weekly Engineering Sync",
            startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
            attendees: [{ name: "Alice", email: "alice@example.com" }, { name: "Bob", email: "bob@example.com" }],
            createdAt: new Date(),
            extractedTasks: [
                { taskId: task1Id, title: "Implement Auth", status: "todo" },
                { taskId: task2Id, title: "Design Dashboard", status: "todo" }
            ]
        };

        await db.collection("meetings").insertOne(meetingA);

        // Create Canonical Tasks
        const tasks = [
            {
                id: task1Id,
                userId,
                workspaceId,
                title: "Implement Auth",
                status: "todo",
                sourceSessionId: meetingAId.toString(),
                sourceSessionType: "meeting"
            },
            {
                id: task2Id,
                userId,
                workspaceId,
                title: "Design Dashboard",
                status: "todo",
                sourceSessionId: meetingAId.toString(),
                sourceSessionType: "meeting"
            }
        ];
        await db.collection("tasks").insertMany(tasks.map((t: any) => ({ ...t, _id: new ObjectId(t._id) }))); // Insert canonical

        // 2. Create Meeting B (Current)
        logMsg("📅 Creating Meeting B (Current)...");
        const meetingBId = new ObjectId();
        const meetingB = {
            _id: meetingBId,
            id: meetingBId.toString(),
            userId,
            workspaceId,
            title: "Weekly Engineering Sync",
            startTime: new Date(),
            attendees: [{ name: "Alice", email: "alice@example.com" }, { name: "Bob", email: "bob@example.com" }],
            extractedTasks: []
        };
        await db.collection("meetings").insertOne(meetingB as any);

        // 3. Verify Series Detection
        logMsg("🔍 Verifying Series Detection...");
        const previous = await findPreviousMeeting(db, meetingB as any);
        if (previous && String(previous._id) === String(meetingAId)) {
            logMsg(`✅ Previous meeting found correctly: ${previous.title}`);
        } else {
            logMsg(`❌ Failed to find previous meeting! Found: ${previous?._id}`);
            throw new Error("Series detection failed");
        }

        // 4. Simulate Chat Processing
        logMsg("💬 Processing Chat: 'I finished Implement Auth'...");

        const existingTasks = [
            { ...tasks[0], priority: 'medium' },
            { ...tasks[1], priority: 'medium' }
        ];

        const result = await extractTasksFromChat({
            message: "I have fully completed the task titled 'Implement Auth'. It is done.",
            sourceMeetingTranscript: "Okay, let's review progress. I finished Implement Auth.",
            existingTasks: existingTasks as any,
            previousMeetingId: meetingAId.toString(),
            contextTaskTitle: undefined,
            isFirstMessage: true,
            requestedDetailLevel: "medium"
        });

        // 5. Verify Results
        logMsg("📊 Results: " + JSON.stringify(result.tasks?.map(t => ({ id: t.id, title: t.title, status: t.status })), null, 2));

        let updatedTask1 = result.tasks?.find(t => t.id === task1Id);

        // If the orchestrator doesn't return the full list, search DB
        if (!updatedTask1) {
            const dbTask = await db.collection("tasks").findOne({ id: task1Id });
            if (dbTask) updatedTask1 = dbTask;
        }

        if (updatedTask1?.status === 'done') {
            logMsg("✅ Task 1 marked as DONE!");
        } else {
            logMsg(`❌ Task 1 NOT marked as done. Status: ${updatedTask1?.status}`);
        }

        // Cleanup
        logMsg("🧹 Cleaning up...");
        await db.collection("meetings").deleteOne({ _id: meetingAId });
        await db.collection("meetings").deleteOne({ _id: meetingBId });
        await db.collection("tasks").deleteMany({ userId });

        return NextResponse.json({ success: true, log });

    } catch (error: any) {
        logMsg("ERROR: " + error.message);
        return NextResponse.json({ success: false, log, error: error.message }, { status: 500 });
    }
}
