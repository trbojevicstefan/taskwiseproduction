import type { Db } from "mongodb";
import {
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceForUser,
  getActiveWorkspaceIdForUser,
} from "@/lib/workspace-context";

export const getWorkspaceForUser = async (db: Db, userId: string) => {
  await ensureWorkspaceBootstrapForUser(db, userId);
  return getActiveWorkspaceForUser(db, userId);
};

export const getWorkspaceIdForUser = async (db: Db, userId: string) => {
  const bootstrapWorkspace = await ensureWorkspaceBootstrapForUser(db, userId);
  if (bootstrapWorkspace?.id) {
    return bootstrapWorkspace.id;
  }
  return getActiveWorkspaceIdForUser(db, userId);
};
