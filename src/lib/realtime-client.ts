import type {
  RealtimeDomainUpdate,
  RealtimeTopic,
} from "@/lib/realtime-events";

type SubscribeOptions = {
  onOpen?: () => void;
  onError?: (event: Event) => void;
};

export const subscribeRealtimeUpdates = (
  topics: RealtimeTopic[],
  onUpdate: (event: RealtimeDomainUpdate) => void,
  options?: SubscribeOptions
) => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }

  const normalizedTopics = Array.from(new Set(topics));
  const params = new URLSearchParams();
  if (normalizedTopics.length) {
    params.set("topics", normalizedTopics.join(","));
  }

  const query = params.toString();
  const url = query ? `/api/realtime/stream?${query}` : "/api/realtime/stream";
  const source = new EventSource(url);

  const handleReady = () => {
    options?.onOpen?.();
  };

  const handleUpdate = (event: Event) => {
    const message = event as MessageEvent<string>;
    if (!message.data) return;
    try {
      const payload = JSON.parse(message.data) as RealtimeDomainUpdate;
      if (!payload || typeof payload !== "object") return;
      onUpdate(payload);
    } catch (error) {
      console.error("Failed to parse realtime update payload:", error);
    }
  };

  source.addEventListener("ready", handleReady);
  source.addEventListener("update", handleUpdate);
  source.onerror = (event: Event) => {
    options?.onError?.(event);
  };

  return () => {
    source.removeEventListener("ready", handleReady);
    source.removeEventListener("update", handleUpdate);
    source.close();
  };
};
