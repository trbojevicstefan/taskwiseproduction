/**
 * Grain adapter helpers — lenient value coercion + transcript normalization
 * (JSON segments and WebVTT). Split out of grain.ts to keep the adapter file
 * under the ~400-line house limit. See grain.ts for the full list of
 * VERIFY-ON-FIRST-LIVE-RUN external-API assumptions.
 */

import type { NormalizedTranscriptSegment } from "@/lib/meeting-providers/types";

// ---------------------------------------------------------------------------
// Lenient coercion helpers
// ---------------------------------------------------------------------------

export const asTrimmedString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

export const asDate = (value: unknown): Date | null => {
  const text = asTrimmedString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const asLowerEmail = (value: unknown): string | null => {
  const text = asTrimmedString(value);
  return text && text.includes("@") ? text.toLowerCase() : null;
};

export const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// ---------------------------------------------------------------------------
// Transcript normalization (JSON segments + VTT fallback)
// ---------------------------------------------------------------------------

const segmentOffsetSeconds = (segment: Record<string, unknown>): number | null => {
  // `start` / `start_time` / `offset` assumed seconds. VERIFY-ON-FIRST-LIVE-RUN.
  for (const key of ["start", "start_time", "offset", "offset_seconds"]) {
    const value = asFiniteNumber(segment[key]);
    if (value !== null) return value;
  }
  // `timestamp` assumed milliseconds (Grain highlights are ms). VERIFY-ON-FIRST-LIVE-RUN.
  const timestamp = asFiniteNumber(segment.timestamp);
  if (timestamp !== null) return timestamp / 1000;
  return null;
};

/**
 * Map Grain JSON transcript payloads (an array of utterances, or an object
 * wrapping one under `segments`) into normalized segments. Unusable entries
 * are dropped, never thrown on.
 */
export const mapJsonSegments = (value: unknown): NormalizedTranscriptSegment[] => {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as any).segments)
      ? (value as any).segments
      : null;
  if (!list) return [];
  const segments: NormalizedTranscriptSegment[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const text = asTrimmedString(record.text) || asTrimmedString(record.words);
    if (!text) continue;
    segments.push({
      speaker:
        asTrimmedString(record.speaker) ||
        asTrimmedString(record.speaker_name) ||
        asTrimmedString(record.name),
      text,
      offsetSeconds: segmentOffsetSeconds(record),
    });
  }
  return segments;
};

const parseVttTimestamp = (value: string): number | null => {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const VTT_VOICE_TAG = /^<v(?:\.[^\s>]*)?\s+([^>]+)>/i;
const SPEAKER_PREFIX = /^([A-Za-z][^:<>{}\n]{0,60}?):\s+(.+)$/;

/** Parse WebVTT cue text into normalized segments (speaker via <v> tags or "Name: text"). */
export const parseVttTranscript = (vtt: string): NormalizedTranscriptSegment[] => {
  const segments: NormalizedTranscriptSegment[] = [];
  const blocks = vtt.replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim());
    const cueIndex = lines.findIndex((line) => line.includes("-->"));
    if (cueIndex === -1) continue;
    const offsetSeconds = parseVttTimestamp(lines[cueIndex].split("-->")[0] || "");
    const textLines = lines.slice(cueIndex + 1).filter(Boolean);
    if (!textLines.length) continue;
    let speaker: string | null = null;
    let text = textLines.join(" ");
    const voiceMatch = text.match(VTT_VOICE_TAG);
    if (voiceMatch) {
      speaker = voiceMatch[1].trim() || null;
      text = text.replace(VTT_VOICE_TAG, "");
    }
    text = text.replace(/<[^>]*>/g, "").trim();
    if (!speaker) {
      const prefixMatch = text.match(SPEAKER_PREFIX);
      if (prefixMatch) {
        speaker = prefixMatch[1].trim();
        text = prefixMatch[2].trim();
      }
    }
    if (!text) continue;
    segments.push({ speaker, text, offsetSeconds });
  }
  return segments;
};

export const looksLikeVtt = (text: string) => /^WEBVTT/m.test(text) || /-->/.test(text);
