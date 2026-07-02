import { config } from "dotenv";
import { ObjectId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../src/lib/db";
import { extractTasksFromChat } from "../src/ai/flows/extract-tasks";
import { findPreviousMeeting } from "../src/lib/meeting-series";

config({ path: ".env.local" });

async function main() {
  console.log("Starting rollover verification...");

  const userId = `test-user-simulation-${Date.now()}`;
  const workspaceId = `ws-test-${Date.now()}`;
  const db = await getDb();

  const meetingAId = new ObjectId();
  const meetingBId = new ObjectId();
  const task1Id = uuidv4();
  const task2Id = uuidv4();

  const meetingA = {
    _id: meetingAId,
    id: meetingAId.toString(),
    userId,
    workspaceId,
    title: "Weekly Engineering Sync",
    startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    attendees: [
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ],
    createdAt: new Date(),
    extractedTasks: [
      { taskId: task1Id, title: "Implement Auth", status: "todo" },
      { taskId: task2Id, title: "Design Dashboard", status: "todo" },
    ],
  };

  const meetingB = {
    _id: meetingBId,
    id: meetingBId.toString(),
    userId,
    workspaceId,
    title: "Weekly Engineering Sync",
    startTime: new Date(),
    attendees: [
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ],
    extractedTasks: [],
  };

  await db.collection("meetings").insertOne(meetingA as any);
  await db.collection("meetings").insertOne(meetingB as any);
  await db.collection("tasks").insertMany([
    {
      id: task1Id,
      userId,
      workspaceId,
      title: "Implement Auth",
      status: "todo",
      sourceSessionId: meetingAId.toString(),
      sourceSessionType: "meeting",
    },
    {
      id: task2Id,
      userId,
      workspaceId,
      title: "Design Dashboard",
      status: "todo",
      sourceSessionId: meetingAId.toString(),
      sourceSessionType: "meeting",
    },
  ]);

  const previous = await findPreviousMeeting(db, meetingB as any);
  if (!previous || String((previous as any)._id) !== meetingAId.toString()) {
    throw new Error("Failed to detect previous meeting in series.");
  }

  const result = await extractTasksFromChat({
    message: "I finished Implement Auth. Also let's keep working on Design Dashboard.",
    sourceMeetingTranscript: "Okay, let's review progress. I finished Implement Auth.",
    existingTasks: [
      { id: task1Id, title: "Implement Auth", status: "todo", priority: "medium" },
      { id: task2Id, title: "Design Dashboard", status: "todo", priority: "medium" },
    ] as any,
    previousMeetingId: meetingAId.toString(),
    isFirstMessage: true,
    requestedDetailLevel: "medium",
  });

  const updatedTask1 = result.tasks?.find((task) => task.id === task1Id);
  if (updatedTask1?.status !== "done") {
    throw new Error(`Task not marked done. Current status: ${updatedTask1?.status || "missing"}`);
  }

  await db.collection("meetings").deleteMany({ _id: { $in: [meetingAId, meetingBId] } });
  await db.collection("tasks").deleteMany({ userId });
  console.log("Rollover verification succeeded.");
}

main().catch((error) => {
  console.error("Rollover verification failed:", error);
  process.exit(1);
});
