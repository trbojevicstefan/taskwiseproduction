import { randomUUID } from "crypto";
import type { Db } from "mongodb";

export type WorkspaceStatus = "active" | "archived" | "deleted";

export interface WorkspaceDoc {
  _id: string;
  name: string;
  slug?: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  status: WorkspaceStatus;
  settings?: {
    defaultBoardTemplate?: string | null;
    timezone?: string | null;
  } | null;
}

const WORKSPACES_COLLECTION = "workspaces";

export const ensureWorkspaceIndexes = async (db: Db) => {
  const collection = db.collection<WorkspaceDoc>(WORKSPACES_COLLECTION);
  await Promise.all([
    collection.createIndex({ _id: 1 }, { unique: true }),
    collection.createIndex(
      { slug: 1 },
      { unique: true, sparse: true, partialFilterExpression: { slug: { $type: "string" } } }
    ),
    collection.createIndex({ createdByUserId: 1, createdAt: -1 }),
    collection.createIndex({ status: 1, updatedAt: -1 }),
  ]);
};

export const createWorkspace = async (
  db: Db,
  input: {
    name: string;
    createdByUserId: string;
    slug?: string | null;
    status?: WorkspaceStatus;
    settings?: WorkspaceDoc["settings"];
    id?: string;
  }
) => {
  const now = new Date();
  const workspace: WorkspaceDoc = {
    _id: input.id || randomUUID(),
    name: input.name,
    slug: input.slug || null,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    status: input.status || "active",
    settings: input.settings || null,
  };

  await db.collection<WorkspaceDoc>(WORKSPACES_COLLECTION).insertOne(workspace);
  return workspace;
};

export const findWorkspaceById = async (db: Db, workspaceId: string) =>
  db.collection<WorkspaceDoc>(WORKSPACES_COLLECTION).findOne({ _id: workspaceId });

export const listWorkspacesByIds = async (db: Db, workspaceIds: string[]) => {
  if (!workspaceIds.length) {
    return [] as WorkspaceDoc[];
  }
  return db
    .collection<WorkspaceDoc>(WORKSPACES_COLLECTION)
    .find({ _id: { $in: workspaceIds } })
    .toArray();
};

export const updateWorkspaceById = async (
  db: Db,
  workspaceId: string,
  update: Partial<Omit<WorkspaceDoc, "_id" | "createdAt" | "createdByUserId">>
) => {
  await db.collection<WorkspaceDoc>(WORKSPACES_COLLECTION).updateOne(
    { _id: workspaceId },
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
    }
  );
};
