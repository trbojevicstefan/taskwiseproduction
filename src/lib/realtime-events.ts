export const REALTIME_TOPICS = ["tasks", "meetings", "board", "people"] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export type RealtimeDomainUpdate = {
  id: string;
  type: string;
  topics: RealtimeTopic[];
  createdAt: string;
  payload: unknown;
};

const TOPIC_SET = new Set<RealtimeTopic>(REALTIME_TOPICS);

export const parseRealtimeTopicList = (
  value: string | null | undefined
): RealtimeTopic[] => {
  if (!value) return [];
  const topics = new Set<RealtimeTopic>();
  value
    .split(",")
    .map((entry: any) => entry.trim().toLowerCase())
    .forEach((entry: any) => {
      if (TOPIC_SET.has(entry as RealtimeTopic)) {
        topics.add(entry as RealtimeTopic);
      }
    });
  return Array.from(topics);
};

export const deriveRealtimeTopicsForDomainEvent = (
  type: string,
  payload: unknown
): RealtimeTopic[] => {
  switch (type) {
    case "meeting.ingested":
      return ["meetings", "tasks", "board", "people"];
    case "task.status.changed": {
      const topics = new Set<RealtimeTopic>(["tasks", "board"]);
      const sourceSessionType =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).sourceSessionType
          : null;
      if (sourceSessionType === "meeting") {
        topics.add("meetings");
      }
      return Array.from(topics);
    }
    case "board.item.updated":
      return ["board", "tasks"];
    default:
      return [];
  }
};
