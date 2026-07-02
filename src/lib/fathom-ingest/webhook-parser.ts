import * as ingestHelpers from "@/lib/fathom-ingest-helpers";

export type ParsedFathomMeetingWebhookPayload = {
  title: string | null;
  recordingUrl: string | null;
  shareUrl: string | null;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  organizerEmail: string | null;
  attendees: ReturnType<typeof ingestHelpers.extractMeetingAttendeesFromPayload>;
  attendeeKeys: string[];
  dedupeFingerprints: string[];
};

const extractMeetingOrganizerEmail = (payload: any) => {
  const candidate = ingestHelpers.pickFirst(
    payload?.organizer_email,
    payload?.organizer?.email,
    payload?.host?.email,
    payload?.owner?.email,
    payload?.recording?.organizer_email,
    payload?.recording?.organizer?.email,
    payload?.recording?.host?.email,
    payload?.recording?.owner?.email
  );
  if (typeof candidate !== "string") return null;
  const email = candidate.trim().toLowerCase();
  return email.includes("@") ? email : null;
};

export const parseFathomMeetingWebhookPayload = (
  payload: any
): ParsedFathomMeetingWebhookPayload => {
  const title = ingestHelpers.extractMeetingTitle(payload);
  const recordingUrl = ingestHelpers.extractMeetingRecordingUrl(payload);
  const shareUrl = ingestHelpers.extractMeetingShareUrl(payload);
  const startTime = ingestHelpers.extractMeetingStartTime(payload);
  const endTime = ingestHelpers.extractMeetingEndTime(payload);
  const durationSeconds = ingestHelpers.extractMeetingDurationSeconds(payload);
  const organizerEmail = extractMeetingOrganizerEmail(payload);
  const attendees = ingestHelpers.extractMeetingAttendeesFromPayload(payload);
  const attendeeKeys = ingestHelpers.extractMeetingAttendeeKeysFromPayload(payload);
  const dedupeFingerprints = ingestHelpers.buildMeetingDedupeFingerprints({
    title,
    recordingUrl,
    shareUrl,
    startTime,
    endTime,
    durationSeconds,
  });

  return {
    title,
    recordingUrl,
    shareUrl,
    startTime,
    endTime,
    durationSeconds,
    organizerEmail,
    attendees,
    attendeeKeys,
    dedupeFingerprints,
  };
};
