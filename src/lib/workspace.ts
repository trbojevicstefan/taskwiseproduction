import type { Db } from "mongodb";
import { buildIdQuery } from "@/lib/mongo-id";

export const getWorkspaceForUser = async (db: Db, userId: string) => {
  const userIdQuery = buildIdQuery(userId);
  const user = await db
    .collection<any>("users")
    .findOne({ $or: [{ _id: userIdQuery }, { id: userId }] });
  return user?.workspace || null;
};

export const getWorkspaceIdForUser = async (db: Db, userId: string) => {
  const workspace = await getWorkspaceForUser(db, userId);
  return workspace?.id || null;
};
