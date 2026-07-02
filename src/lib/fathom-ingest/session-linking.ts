export const syncFathomMeetingChatSession = async (input: {
  db: any;
  userId: string;
  chatSessionId: string | null;
  meetingTitle: string;
  uniquePeople: any[];
  finalizedTasks: any[];
  sanitizedTasks: any[];
  sanitizedTaskLevels: any;
  meetingMetadata: any;
  now: Date;
}) => {
  if (!input.chatSessionId) return;

  try {
    const sourceIds = input.finalizedTasks.map((task: any) => task.id).filter(Boolean);
    if (!sourceIds.length) return;

    const tasks = await input.db
      .collection("tasks")
      .find({ userId: input.userId, sourceTaskId: { $in: sourceIds } })
      .project({ _id: 1, sourceTaskId: 1 })
      .toArray();

    const map = new Map(tasks.map((row: any) => [String(row.sourceTaskId), String(row._id)]));
    const augmented = input.finalizedTasks.map((task: any) => ({
      ...task,
      taskCanonicalId: map.get(task.id) || undefined,
    }));

    await input.db.collection("chatSessions").updateMany(
      {
        userId: input.userId,
        $or: [{ _id: input.chatSessionId }, { id: input.chatSessionId }],
      },
      {
        $set: {
          title: `Chat about "${input.meetingTitle}"`,
          suggestedTasks: augmented,
          originalAiTasks: input.sanitizedTasks,
          originalAllTaskLevels: input.sanitizedTaskLevels,
          people: input.uniquePeople,
          allTaskLevels: input.sanitizedTaskLevels,
          meetingMetadata: input.meetingMetadata || undefined,
          lastActivityAt: input.now,
        },
      }
    );
  } catch (error) {
    console.error("Failed to attach canonical ids to chat sessions:", error);
  }
};
