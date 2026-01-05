import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { buildIdQuery } from "@/lib/mongo-id";
import {
  getBoardTemplate,
  DEFAULT_BOARD_TEMPLATE_ID,
  type BoardTemplate,
  type BoardStatusCategory,
} from "@/lib/board-templates";

export interface BoardRecord {
  _id: string;
  userId: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  templateId?: string | null;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardStatusRecord {
  _id: string;
  userId: string;
  workspaceId: string;
  boardId: string;
  label: string;
  color: string;
  category: BoardStatusCategory;
  order: number;
  isTerminal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const buildBoardRecord = (
  userId: string,
  workspaceId: string,
  name: string,
  template: BoardTemplate,
  options: { description?: string | null; isDefault?: boolean; color?: string | null } = {}
) => {
  const now = new Date();
  return {
    board: {
      _id: randomUUID(),
      userId,
      workspaceId,
      name,
      description: options.description ?? null,
      color: options.color ?? template.statuses[0]?.color ?? "#2563eb",
      templateId: template.id,
      isDefault: Boolean(options.isDefault),
      createdAt: now,
      updatedAt: now,
    },
    now,
  };
};

const buildStatusRecords = (
  boardId: string,
  userId: string,
  workspaceId: string,
  template: BoardTemplate,
  now: Date
) =>
  template.statuses.map((status, index) => ({
    _id: randomUUID(),
    userId,
    workspaceId,
    boardId,
    label: status.label,
    color: status.color,
    category: status.category,
    order: index,
    isTerminal: Boolean(status.isTerminal),
    createdAt: now,
    updatedAt: now,
  }));

export const createBoardWithTemplate = async (
  db: Db,
  userId: string,
  workspaceId: string,
  name: string,
  templateId?: string | null,
  options: { description?: string | null; isDefault?: boolean; color?: string | null } = {}
) => {
  const template = getBoardTemplate(templateId);
  const { board, now } = buildBoardRecord(userId, workspaceId, name, template, options);
  const statuses = buildStatusRecords(board._id, userId, workspaceId, template, now);

  await db.collection("boards").insertOne(board);
  if (statuses.length) {
    await db.collection("boardStatuses").insertMany(statuses);
  }

  return { board, statuses };
};

export const ensureDefaultBoard = async (
  db: Db,
  userId: string,
  workspaceId: string
) => {
  const userIdQuery = buildIdQuery(userId);
  const existing = await db.collection<BoardRecord>("boards").findOne({
    userId: userIdQuery,
    workspaceId,
    isDefault: true,
  });
  if (existing) {
    return existing;
  }

  const template = getBoardTemplate(DEFAULT_BOARD_TEMPLATE_ID);
  const { board } = await createBoardWithTemplate(
    db,
    userId,
    workspaceId,
    `${template.name}`,
    template.id,
    { isDefault: true }
  );
  return board;
};
