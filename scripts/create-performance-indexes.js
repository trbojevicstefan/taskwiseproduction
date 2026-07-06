#!/usr/bin/env node
const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set in .env");
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "taskwise";

const indexPlan = [
  {
    collection: "tasks",
    indexes: [
      {
        key: {
          userId: 1,
          workspaceId: 1,
          taskState: 1,
          projectId: 1,
          parentId: 1,
          order: 1,
          createdAt: 1,
        },
        options: { name: "tasks_user_workspace_state_sort" },
      },
      {
        key: { userId: 1, sourceSessionType: 1, sourceSessionId: 1 },
        options: { name: "tasks_user_source_session" },
      },
      {
        key: { userId: 1, sourceTaskId: 1 },
        options: { name: "tasks_user_source_task" },
      },
      {
        key: { userId: 1, assigneeNameKey: 1, status: 1 },
        options: { name: "tasks_user_assignee_status" },
      },
      {
        key: { userId: 1, dueAt: 1 },
        options: { name: "tasks_user_due_at" },
      },
    ],
  },
  {
    collection: "meetings",
    indexes: [
      {
        key: { userId: 1, isHidden: 1, lastActivityAt: -1 },
        options: { name: "meetings_user_hidden_activity" },
      },
      {
        key: { userId: 1, chatSessionId: 1 },
        options: { name: "meetings_user_chat_session" },
      },
      {
        key: { userId: 1, startTime: 1 },
        options: { name: "meetings_user_start_time" },
      },
    ],
  },
  {
    collection: "people",
    indexes: [
      {
        key: { userId: 1, lastSeenAt: -1 },
        options: { name: "people_user_last_seen" },
      },
      {
        key: { userId: 1, name: 1 },
        options: { name: "people_user_name" },
      },
    ],
  },
  {
    collection: "chatSessions",
    indexes: [
      {
        key: { userId: 1, lastActivityAt: -1 },
        options: { name: "chat_user_activity" },
      },
      {
        key: { userId: 1, sourceMeetingId: 1 },
        options: { name: "chat_user_source_meeting" },
      },
    ],
  },
  {
    collection: "boards",
    indexes: [
      {
        key: { userId: 1, workspaceId: 1, createdAt: 1 },
        options: { name: "boards_user_workspace_created" },
      },
    ],
  },
  {
    collection: "boardStatuses",
    indexes: [
      {
        key: { userId: 1, workspaceId: 1, boardId: 1, order: 1, createdAt: 1 },
        options: { name: "board_status_user_workspace_board_order" },
      },
    ],
  },
  {
    collection: "boardItems",
    indexes: [
      {
        key: {
          userId: 1,
          workspaceId: 1,
          boardId: 1,
          statusId: 1,
          rank: 1,
          createdAt: 1,
        },
        options: { name: "board_items_user_workspace_board_rank" },
      },
      {
        key: { userId: 1, workspaceId: 1, boardId: 1, taskId: 1 },
        options: {
          name: "board_items_user_workspace_board_task_unique",
          unique: true,
          partialFilterExpression: { taskId: { $type: "string" } },
        },
      },
    ],
  },
  {
    collection: "taskReminders",
    indexes: [
      {
        key: { workspaceId: 1, dedupKey: 1 },
        options: {
          name: "task_reminders_workspace_dedup_unique",
          unique: true,
          partialFilterExpression: { dedupKey: { $type: "string" } },
        },
      },
      {
        key: { workspaceId: 1, status: 1, runAt: 1 },
        options: { name: "task_reminders_workspace_status_run_at" },
      },
      {
        key: { taskId: 1, status: 1 },
        options: { name: "task_reminders_task_status" },
      },
      {
        key: { userId: 1, status: 1, runAt: 1 },
        options: { name: "task_reminders_user_status_run_at" },
      },
    ],
  },
  {
    collection: "meetingConnections",
    indexes: [
      {
        key: { workspaceId: 1, provider: 1 },
        options: {
          name: "meeting_connections_workspace_provider_unique",
          unique: true,
        },
      },
      {
        key: { webhookToken: 1 },
        options: {
          name: "meeting_connections_webhook_token_unique",
          unique: true,
          sparse: true,
          partialFilterExpression: { webhookToken: { $type: "string" } },
        },
      },
      {
        key: { provider: 1, status: 1 },
        options: { name: "meeting_connections_provider_status" },
      },
    ],
  },
  {
    collection: "meetingSearchChunks",
    indexes: [
      {
        key: { workspaceId: 1, meetingId: 1 },
        options: { name: "meeting_search_chunks_workspace_meeting" },
      },
      {
        key: { workspaceId: 1, updatedAt: -1 },
        options: { name: "meeting_search_chunks_workspace_updated" },
      },
      {
        key: { meetingId: 1 },
        options: { name: "meeting_search_chunks_meeting" },
      },
      {
        key: { userId: 1, updatedAt: -1 },
        options: { name: "meeting_search_chunks_user_updated" },
      },
    ],
  },
  {
    collection: "domainEvents",
    indexes: [
      {
        key: { userId: 1, status: 1, createdAt: 1, _id: 1 },
        options: { name: "domain_events_user_status_created_cursor" },
      },
      {
        key: { userId: 1, type: 1, createdAt: -1 },
        options: { name: "domain_events_user_type_created" },
      },
      {
        key: { expiresAt: 1 },
        options: { name: "domain_events_expires_at_ttl", expireAfterSeconds: 0 },
      },
    ],
  },
];

async function main() {
  const client = new MongoClient(uri);
  let hadErrors = false;
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`Applying performance indexes to DB "${dbName}"...`);

    for (const entry of indexPlan) {
      const collection = db.collection(entry.collection);
      for (const index of entry.indexes) {
        try {
          // createIndex is idempotent if key/options are unchanged.
          await collection.createIndex(index.key, index.options);
          console.log(
            `  [ok] ${entry.collection}.${index.options.name} -> ${JSON.stringify(
              index.key
            )}`
          );
        } catch (error) {
          const message = String(error?.message || "");
          const isConflict =
            error?.codeName === "IndexOptionsConflict" ||
            message.includes("already exists with different options");
          if (isConflict) {
            console.warn(
              `  [skip] ${entry.collection}.${index.options.name}: conflicting index already exists`
            );
          } else {
            hadErrors = true;
            console.error(
              `  [error] ${entry.collection}.${index.options.name}:`,
              error
            );
          }
        }
      }
    }

    if (hadErrors) {
      process.exitCode = 1;
      console.log("Index setup completed with errors.");
    } else {
      console.log("Index setup complete.");
    }
  } catch (error) {
    console.error("Failed to create performance indexes:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
