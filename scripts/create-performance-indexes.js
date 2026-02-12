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
        options: { name: "board_items_user_workspace_board_task" },
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
