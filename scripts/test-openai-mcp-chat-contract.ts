import {
  GENERAL_CHAT_SOURCE_TYPES,
  GeneralChatAnswerSchema,
  type GeneralChatAnswer,
  type GeneralChatSourceType,
} from "../src/types/general-chat";

const sourceKey = (sourceType: GeneralChatSourceType, sourceId: string) =>
  `${sourceType}:${sourceId}`;

const addEntityIds = (
  ids: Set<string>,
  sourceType: GeneralChatSourceType,
  value: unknown
) => {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = record.id ?? record._id;
    if (typeof id !== "string" || !id.trim()) continue;
    ids.add(sourceKey(sourceType, id.trim()));
    if (sourceType === "meeting") {
      ids.add(sourceKey("transcript", id.trim()));
    }
  }
};

export const collectSyntheticEvidenceSourceIds = (
  evidence: unknown
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    addEntityIds(ids, "meeting", record.meeting);
    addEntityIds(ids, "meeting", record.meetings);
    addEntityIds(ids, "task", record.task);
    addEntityIds(ids, "task", record.tasks);
    addEntityIds(ids, "person", record.person);
    addEntityIds(ids, "person", record.people);
    addEntityIds(ids, "client", record.client);
    addEntityIds(ids, "client", record.clients);

    if (
      typeof record.sourceType === "string" &&
      GENERAL_CHAT_SOURCE_TYPES.includes(
        record.sourceType as GeneralChatSourceType
      ) &&
      typeof record.sourceId === "string" &&
      record.sourceId.trim()
    ) {
      ids.add(
        sourceKey(
          record.sourceType as GeneralChatSourceType,
          record.sourceId.trim()
        )
      );
    }
    Object.values(record).forEach(visit);
  };
  visit(evidence);
  return ids;
};

export const parseSyntheticToolArguments = (
  serializedArguments: string
): { query: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedArguments);
  } catch {
    throw new Error("Configured model emitted non-JSON tool arguments.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configured model emitted invalid tool arguments.");
  }
  const args = parsed as Record<string, unknown>;
  if (
    Object.keys(args).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(args, "query")
  ) {
    throw new Error("Configured model emitted unexpected tool arguments.");
  }
  if (typeof args.query !== "string" || !args.query.trim()) {
    throw new Error("Configured model emitted invalid tool arguments.");
  }
  return { query: args.query };
};

export const parseSyntheticGroundedAnswer = (
  serializedAnswer: string,
  observedSourceIds: ReadonlySet<string>
): GeneralChatAnswer => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedAnswer);
  } catch {
    throw new Error("Configured model did not return a JSON final answer.");
  }
  const answer = GeneralChatAnswerSchema.safeParse(parsed);
  if (!answer.success) {
    throw new Error(
      "Configured model did not return the production GeneralChatAnswer contract."
    );
  }
  if (answer.data.sources.length === 0) {
    throw new Error("Configured model returned no grounded synthetic source.");
  }
  for (const source of answer.data.sources) {
    if (!observedSourceIds.has(sourceKey(source.sourceType, source.sourceId))) {
      throw new Error(
        "Configured model cited a source not present in synthetic tool evidence."
      );
    }
  }
  return answer.data;
};
