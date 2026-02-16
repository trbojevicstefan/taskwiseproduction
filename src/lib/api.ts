const GET_RESPONSE_CACHE_TTL_MS = 1000;

type CachedGetResponse = {
  value: unknown;
  expiresAt: number;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();
const cachedGetResponses = new Map<string, CachedGetResponse>();

const isBrowserRuntime = () => typeof window !== "undefined";

const normalizeMethod = (options: RequestInit) =>
  (options.method || "GET").toUpperCase();

const buildGetRequestKey = (url: string, options: RequestInit) => {
  const headers = new Headers(options.headers || undefined);
  return [
    url,
    headers.get("accept") || "",
    headers.get("x-correlation-id") || "",
  ].join("|");
};

const executeRequest = async <T>(
  url: string,
  options: RequestInit = {}
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Request failed.");
  }

  return response.json() as Promise<T>;
};

export const apiFetch = async <T>(
  url: string,
  options: RequestInit = {}
): Promise<T> => {
  const method = normalizeMethod(options);
  const shouldDedupeGet =
    isBrowserRuntime() && method === "GET" && options.body === undefined;

  if (!shouldDedupeGet) {
    return executeRequest<T>(url, options);
  }

  const requestKey = buildGetRequestKey(url, options);
  const now = Date.now();
  const cached = cachedGetResponses.get(requestKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  if (cached && cached.expiresAt <= now) {
    cachedGetResponses.delete(requestKey);
  }

  const inFlight = inFlightGetRequests.get(requestKey);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const requestPromise = executeRequest<T>(url, options)
    .then((result) => {
      cachedGetResponses.set(requestKey, {
        value: result,
        expiresAt: Date.now() + GET_RESPONSE_CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      inFlightGetRequests.delete(requestKey);
    });

  inFlightGetRequests.set(requestKey, requestPromise);
  return requestPromise;
};
