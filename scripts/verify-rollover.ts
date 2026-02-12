import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb } from "../src/lib/db";
import { ObjectId } from "mongodb";
import { extractTasksFromChat } from "../src/ai/flows/extract-tasks";
import { findPreviousMeeting } from "../src/lib/meeting-series";
import { v4 as uuidv4 } from 'uuid';

// Mock AI to avoid real costs if possible, or use real one?
// The flows import 'ai' from '@/ai/genkit'.
// If I run this with `tsx`, it will use the real OpenAI/Gemini keys if env vars are set.
// User environment likely has keys. I'll use real AI for "End-to-End" fidelity.

async function main() {
    console.log("🚀 Starting End-to-End Rollover Verification...");

    const userId = "test-user-simulation-" + Date.now();
    const db = await getDb();

    // 1. Create Meeting A
    console.log("\n📅 Creating Meeting A (Previous)...");
    const meetingAId = new ObjectId();
    const task1Id = uuidv4();
    const task2Id = uuidv4();

    const meetingA = {
        _id: meetingAId,
        id: meetingAId.toString(),
        userId,
        title: "Weekly Engineering Sync",
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
        attendees: [{ name: "Alice", email: "alice@example.com" }, { name: "Bob", email: "bob@example.com" }],
        createdAt: new Date(),
        extractedTasks: [
            { taskId: task1Id, title: "Implement Auth", status: "todo" }, // Reference
            { taskId: task2Id, title: "Design Dashboard", status: "todo" }
        ]
    };

    await db.collection("meetings").insertOne(meetingA);

    // Create Canonical Tasks
    await db.collection("tasks").insertMany([
        {
            _id: new ObjectId(task1Id), // Wait, _id is ObjectId? Or string? 
            // normalizeTask uses uuid for id. _id in MongoDB is ObjectId.
            // Let's use string IDs for simplicity if the app supports it, 
            // or properly map uuid -> _id if that's the schema.
            // App seems to use `_id` as ObjectId and `id` as UUID.
            // In hydration, we check `_id` and `id` against `taskId`.
            // Let's make `_id` be the UUID to be safe? No, mongo _id must be unique.

            id: task1Id, // client ID
            userId,
            title: "Implement Auth",
            status: "todo",
            sourceSessionId: meetingAId.toString(),
            sourceSessionType: "meeting"
        },
        {
            id: task2Id,
            userId,
            title: "Design Dashboard",
            status: "todo",
            sourceSessionId: meetingAId.toString(),
            sourceSessionType: "meeting"
        }
    ]);

    // 2. Create Meeting B (Current)
    console.log("\n📅 Creating Meeting B (Current)...");
    const meetingBId = new ObjectId();
    const meetingB = {
        _id: meetingBId,
        id: meetingBId.toString(),
        userId,
        title: "Weekly Engineering Sync", // Same title
        startTime: new Date(),
        attendees: [{ name: "Alice", email: "alice@example.com" }, { name: "Bob", email: "bob@example.com" }],
        extractedTasks: []
    };
    await db.collection("meetings").insertOne(meetingB);

    // 3. Verify Series Detection
    console.log("\n🔍 Verifying Series Detection...");
    const previous = await findPreviousMeeting(db, userId, meetingB);
    if (previous && previous._id.toString() === meetingAId.toString()) {
        console.log("✅ Previous meeting found correctly:", previous.title);
    } else {
        console.error("❌ Failed to find previous meeting!", previous);
        process.exit(1);
    }

    // 4. Simulate Chat Processing
    console.log("\n💬 Processing Chat: 'I finished auth implementation'...");

    // Fetch existing tasks for context (the orchestrator normally gets these passed in)
    // In a real flow, `MeetingsPage` would fetch tasks for the user/meeting.
    // We need to fetch 'Open Tasks' that would be injected.

    // In `extractTasksFromChat`, we pass `previousMeetingId`.
    // The Orchestrator uses that to fetch context.

    const result = await extractTasksFromChat({
        message: "I finished Implement Auth. Also let's keep working on Design Dashboard.",
        sourceMeetingTranscript: "Okay, let's review progress. I finished Implement Auth.",
        existingTasks: [], // Initially empty in the new meeting context? 
        // Wait, if it's a follow-up, we might pass EXISTING tasks from the workspace?
        // Or does the `previousMeetingId` context handle it?
        // `extractTasksFromChat` (orchestrator) uses `previousMeetingId` to build a text context string.
        // It does NOT auto-load task objects into `existingTasks`.
        // BUT `refineTasks` or `extractTasksFromMessage` might use that text context?

        // We want to test if it UPDATES the canonical task.
        // The orchestrator needs to know about the tasks to update them.
        // If `existingTasks` is empty, it can't update "Implement Auth" unless it finds it by search?
        // `findTaskMatches` searches `existingTasks`.

        // So effectively, the frontend must pass the relevant tasks.
        // In `MeetingPlannerPageContent` (or similar), do we pass all user tasks?
        // Or does the "Context Injection" allow the AI to say "Update task X"?
        // If the AI says "Update task X", but X is not in `existingTasks`, can it update it?
        // No, `extractTasksFromChat` modifies `existingTasks`.

        // HOWEVER, `analyzeMeeting` (first pass) might find tasks.
        // But we are doing Chat.

        // The "Global Context" update we made in Step 786/795 says:
        // "ensure it considers *all* relevant active tasks (from Workspace/Board)... not just local session context."

        // So we should pass the previous tasks as `existingTasks` to the orchestrator, 
        // mimicking what the frontend would do (it loads open tasks for the user/attendees).

        previousMeetingId: meetingAId.toString(),
        existingTasks: [
            { id: task1Id, title: "Implement Auth", status: "todo", priority: 'medium' },
            { id: task2Id, title: "Design Dashboard", status: "todo", priority: 'medium' }
        ]
    });

    // 5. Verify Results
    console.log("\n📊 Results:", JSON.stringify(result, null, 2));

    const updatedTask1 = result.tasks?.find(t => t.id === task1Id);
    const updatedTask2 = result.tasks?.find(t => t.id === task2Id);

    if (updatedTask1?.status === 'done') {
        console.log("✅ Task 1 marked as DONE!");
    } else {
        console.error("❌ Task 1 NOT marked as done. Status:", updatedTask1?.status);
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await db.collection("meetings").deleteOne({ _id: meetingAId });
    await db.collection("meetings").deleteOne({ _id: meetingBId });
    await db.collection("tasks").deleteMany({ userId });

    console.log("Done.");
    process.exit(0);
}

main().catch(console.error);
