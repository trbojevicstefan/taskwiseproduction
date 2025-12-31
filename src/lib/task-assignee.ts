import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { Person } from "@/types/person";

type AssigneePayload = {
  uid?: string | null;
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
};

type AssigneeTaskLike = {
  assignee?: AssigneePayload | null;
  assigneeName?: string | null;
  assigneeNameKey?: string | null;
  assigneeEmail?: string | null;
};

type AssigneeMaps = {
  peopleById?: Map<string, Person>;
  personNameKeyToId?: Map<string, string>;
  personEmailToId?: Map<string, string>;
};

const PLACEHOLDER_LABELS = new Set([
  "unassigned",
  "unknown",
  "n/a",
  "na",
  "none",
  "tbd",
]);

const normalizeLabel = (value?: string | null) =>
  (value || "").trim().toLowerCase();

export const isPlaceholderAssignee = (value?: string | null) => {
  const normalized = normalizeLabel(value);
  return !normalized || PLACEHOLDER_LABELS.has(normalized);
};

export const resolveAssigneePersonId = (
  task: AssigneeTaskLike,
  maps: AssigneeMaps = {}
) => {
  const rawAssignee = task.assignee || undefined;
  const directId = rawAssignee?.uid || rawAssignee?.id;
  if (directId) {
    const directKey = String(directId);
    if (maps.peopleById && !maps.peopleById.has(directKey)) {
      return null;
    }
    return directKey;
  }

  const email =
    rawAssignee?.email?.toLowerCase?.() ||
    task.assigneeEmail?.toLowerCase?.();
  if (email && maps.personEmailToId?.has(email)) {
    return maps.personEmailToId.get(email) || null;
  }

  const nameKey =
    task.assigneeNameKey ||
    (task.assigneeName ? normalizePersonNameKey(task.assigneeName) : "") ||
    (rawAssignee?.name ? normalizePersonNameKey(rawAssignee.name) : "") ||
    (rawAssignee?.displayName
      ? normalizePersonNameKey(rawAssignee.displayName)
      : "");
  if (nameKey && maps.personNameKeyToId?.has(nameKey)) {
    return maps.personNameKeyToId.get(nameKey) || null;
  }

  return null;
};

export const getAssigneeLabel = (
  task: AssigneeTaskLike,
  maps: AssigneeMaps = {}
) => {
  const rawAssignee = task.assignee || undefined;
  const directLabel =
    task.assigneeName ||
    rawAssignee?.name ||
    rawAssignee?.displayName ||
    rawAssignee?.email ||
    task.assigneeEmail ||
    null;

  const personId = resolveAssigneePersonId(task, maps);
  if (personId && maps.peopleById?.has(personId)) {
    return maps.peopleById.get(personId)?.name || directLabel;
  }

  return directLabel;
};
