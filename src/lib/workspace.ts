import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

const buildUserLookupFilter = (userId: string) => {
  if (ObjectId.isValid(userId)) {
    return { $or: [{ _id: new ObjectId(userId) }, { id: userId }] };
  }
  return { id: userId };
};

export const getWorkspaceForUser = async (db: Db, userId: string) => {
  const user = await (db.collection("users") as any).findOne(
    buildUserLookupFilter(userId)
  );
  return user?.workspace || null;
};

export const getWorkspaceIdForUser = async (db: Db, userId: string) => {
  const workspace = await getWorkspaceForUser(db, userId);
  return workspace?.id || null;
};

