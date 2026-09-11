import type {
  MeetingProviderConnection,
  NormalizedProviderParticipant,
  NormalizedTranscriptSegment,
} from "@/lib/meeting-providers/types";

export const cleanString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const cleanEmail = (value: unknown): string | null => {
  const email = cleanString(value);
  return email && email.includes("@") ? email.toLowerCase() : null;
};

export const asDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = cleanString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const durationBetween = (start: Date | null, end: Date | null) =>
  start && end && end.getTime() >= start.getTime()
    ? Math.round((end.getTime() - start.getTime()) / 1000)
    : null;

export const requireApiKey = (
  connection: MeetingProviderConnection,
  displayName: string
): string => {
  const key = cleanString(connection?.apiKey);
  if (!key) throw new Error(`${displayName} connection is missing an API key.`);
  return key;
};

const participantKey = (participant: NormalizedProviderParticipant) =>
  participant.email || `name:${participant.name.toLowerCase()}`;

export const normalizeParticipants = (raw: unknown): NormalizedProviderParticipant[] => {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, NormalizedProviderParticipant>();
  for (const value of raw) {
    if (typeof value === "string") {
      const email = cleanEmail(value);
      const text = cleanString(value);
      const name = email
        ? email.split("@")[0].replace(/[._-]+/g, " ")
        : text;
      if (!name) continue;
      const participant: NormalizedProviderParticipant = {
        name,
        ...(email ? { email } : {}),
      };
      byKey.set(participantKey(participant), participant);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const nestedUser =
      entry.user && typeof entry.user === "object"
        ? (entry.user as Record<string, unknown>)
        : null;
    const email =
      cleanEmail(entry.email) ||
      cleanEmail(entry.email_address) ||
      cleanEmail(nestedUser?.email);
    const name =
      cleanString(entry.name) ||
      cleanString(entry.displayName) ||
      cleanString(entry.display_name) ||
      cleanString(entry.full_name) ||
      cleanString(nestedUser?.name) ||
      (email ? email.split("@")[0].replace(/[._-]+/g, " ") : null);
    if (!name) continue;
    const participant: NormalizedProviderParticipant = {
      name,
      ...(email ? { email } : {}),
    };
    const title = cleanString(entry.title) || cleanString(entry.job_title);
    if (title) participant.title = title;
    const key = participantKey(participant);
    const existing = byKey.get(key);
    if (!existing || (!existing.title && participant.title)) byKey.set(key, participant);
  }
  return Array.from(byKey.values());
};

export const normalizeTranscriptSegments = (
  raw: unknown,
  meetingStart?: Date | null
): NormalizedTranscriptSegment[] => {
  const candidate =
    Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? ((raw as any).segments ||
            (raw as any).sentences ||
            (raw as any).transcript ||
            (raw as any).utterances ||
            (raw as any).data)
        : null;
  if (!Array.isArray(candidate)) return [];

  const segments: NormalizedTranscriptSegment[] = [];
  for (const value of candidate) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const text =
      cleanString(entry.text) ||
      cleanString(entry.content) ||
      cleanString(entry.transcript);
    if (!text) continue;
    const speakerValue =
      entry.speaker && typeof entry.speaker === "object"
        ? (entry.speaker as Record<string, unknown>).name
        : entry.speaker;
    const speaker =
      cleanString(speakerValue) ||
      cleanString(entry.speaker_name) ||
      cleanString(entry.speakerName) ||
      cleanString(entry.participant_name);

    let offsetSeconds: number | null = null;
    for (const rawOffset of [
      entry.offsetSeconds,
      entry.start_offset,
      entry.start_time,
      entry.startTime,
      entry.start,
      entry.offset,
    ]) {
      if (typeof rawOffset === "number" && Number.isFinite(rawOffset)) {
        offsetSeconds = Math.max(0, rawOffset);
        break;
      }
    }
    if (offsetSeconds === null && meetingStart) {
      const absolute =
        asDate(entry.start_time) || asDate(entry.startTime) || asDate(entry.timestamp);
      if (absolute) {
        offsetSeconds = Math.max(
          0,
          Math.round((absolute.getTime() - meetingStart.getTime()) / 1000)
        );
      }
    }

    segments.push({ speaker, text, offsetSeconds });
  }
  return segments;
};

export const normalizeActionItems = (raw: unknown): string[] => {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
  const items: string[] = [];
  for (const value of values) {
    const text =
      typeof value === "string"
        ? cleanString(value)
        : value && typeof value === "object"
          ? cleanString((value as any).text) ||
            cleanString((value as any).description) ||
            cleanString((value as any).title)
          : null;
    if (!text) continue;
    const cleaned = text.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (cleaned && !items.includes(cleaned)) items.push(cleaned);
  }
  return items;
};

export const arrayFromEnvelope = (body: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

export const firstString = (...values: unknown[]) => {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return null;
};

export const safeJson = async (response: Response): Promise<any> =>
  response.json().catch(() => null);
