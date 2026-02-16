import { REALTIME_TOPICS } from "@/lib/realtime-events";
import type { RealtimeDomainUpdate, RealtimeTopic } from "@/lib/realtime-events";

type SubscribeOptions = {
  onOpen?: () => void;
  onError?: (event: Event) => void;
};

type RealtimeListener = {
  id: number;
  topics: Set<RealtimeTopic>;
  onUpdate: (event: RealtimeDomainUpdate) => void;
  onOpen?: () => void;
  onError?: (event: Event) => void;
};

type RealtimeConnectionState = {
  source: EventSource | null;
  activeTopicsKey: string;
  listeners: Map<number, RealtimeListener>;
  nextListenerId: number;
};

const topicOrder = (REALTIME_TOPICS as readonly RealtimeTopic[]) || [];

const connectionState: RealtimeConnectionState = {
  source: null,
  activeTopicsKey: "",
  listeners: new Map(),
  nextListenerId: 1,
};

const normalizeTopics = (topics: RealtimeTopic[]) => {
  const topicSet = new Set<RealtimeTopic>(topics);
  return topicOrder.filter((topic) => topicSet.has(topic));
};

const buildTopicsQuery = (topics: RealtimeTopic[]) => {
  const normalized = normalizeTopics(topics);
  if (!normalized.length) return "";
  return normalized.join(",");
};

const broadcastReady = () => {
  connectionState.listeners.forEach((listener: any) => {
    listener.onOpen?.();
  });
};

const broadcastError = (event: Event) => {
  connectionState.listeners.forEach((listener: any) => {
    listener.onError?.(event);
  });
};

const listenerMatches = (
  listenerTopics: Set<RealtimeTopic>,
  updateTopics: RealtimeTopic[]
) => {
  if (!listenerTopics.size) return true;
  return updateTopics.some((topic: any) => listenerTopics.has(topic));
};

const broadcastUpdate = (update: RealtimeDomainUpdate) => {
  const updateTopics = Array.isArray(update.topics)
    ? (update.topics as RealtimeTopic[])
    : [];
  connectionState.listeners.forEach((listener: any) => {
    if (!listenerMatches(listener.topics, updateTopics)) {
      return;
    }
    listener.onUpdate(update);
  });
};

const closeSource = () => {
  if (!connectionState.source) return;
  connectionState.source.close();
  connectionState.source = null;
  connectionState.activeTopicsKey = "";
};

const computeUnionTopics = (): RealtimeTopic[] => {
  const union = new Set<RealtimeTopic>();
  connectionState.listeners.forEach((listener: any) => {
    listener.topics.forEach((topic: any) => union.add(topic));
  });
  return normalizeTopics(Array.from(union));
};

const ensureConnection = () => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return;
  }

  if (connectionState.listeners.size === 0) {
    closeSource();
    return;
  }

  const unionTopics = computeUnionTopics();
  const topicsQuery = buildTopicsQuery(unionTopics);
  if (connectionState.source && connectionState.activeTopicsKey === topicsQuery) {
    return;
  }

  closeSource();

  const params = new URLSearchParams();
  if (topicsQuery) {
    params.set("topics", topicsQuery);
  }
  const query = params.toString();
  const url = query ? `/api/realtime/stream?${query}` : "/api/realtime/stream";
  const source = new EventSource(url);
  connectionState.source = source;
  connectionState.activeTopicsKey = topicsQuery;

  source.addEventListener("ready", () => {
    broadcastReady();
  });
  source.addEventListener("update", (event: Event) => {
    const message = event as MessageEvent<string>;
    if (!message.data) return;
    try {
      const payload = JSON.parse(message.data) as RealtimeDomainUpdate;
      if (!payload || typeof payload !== "object") return;
      broadcastUpdate(payload);
    } catch (error) {
      console.error("Failed to parse realtime update payload:", error);
    }
  });
  source.onerror = (event: Event) => {
    broadcastError(event);
  };
};

export const subscribeRealtimeUpdates = (
  topics: RealtimeTopic[],
  onUpdate: (event: RealtimeDomainUpdate) => void,
  options?: SubscribeOptions
) => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }

  const listenerId = connectionState.nextListenerId++;
  connectionState.listeners.set(listenerId, {
    id: listenerId,
    topics: new Set(normalizeTopics(topics)),
    onUpdate,
    onOpen: options?.onOpen,
    onError: options?.onError,
  });
  ensureConnection();

  return () => {
    connectionState.listeners.delete(listenerId);
    ensureConnection();
  };
};
