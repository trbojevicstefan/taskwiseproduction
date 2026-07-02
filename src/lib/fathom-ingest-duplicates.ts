import { getFathomRecordingHashScope } from "@/lib/fathom";
import {
  buildMeetingScopeFilter,
  computeAttendeeOverlapRatio,
  extractMeetingAttendeeKeysFromDocument,
  hasStrongFingerprint,
  selectBestAttendeeOverlapCandidate,
} from "@/lib/fathom-ingest-helpers";

const CROSS_NOTETAKER_DEDUPE_WINDOW_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.FATHOM_CROSS_NOTETAKER_DEDUPE_WINDOW_MS || 20 * 60 * 1000)
);

const CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS = Math.max(
  0,
  Number(process.env.FATHOM_CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS || 180)
);

const CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN = Math.min(
  1,
  Math.max(0, Number(process.env.FATHOM_CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN || 0.5))
);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findCanonicalFathomDuplicate = async ({
  db,
  userId,
  workspaceId,
  dedupeFingerprints,
  incomingAttendeeKeys,
  title,
  startTime,
  durationSeconds,
}: {
  db: any;
  userId: string;
  workspaceId: string | null;
  dedupeFingerprints: string[];
  incomingAttendeeKeys: string[];
  title: string | null;
  startTime: Date | null;
  durationSeconds: number | null;
}) => {
  const meetings = db.collection("meetings");
  const scopeFilter = buildMeetingScopeFilter({ userId, workspaceId });

  if (dedupeFingerprints.length) {
    const incomingFingerprintSet = new Set(dedupeFingerprints);
    const fingerprintCandidates = await meetings
      .find({
        $and: [
          scopeFilter,
          { ingestSource: "fathom" },
          { dedupeFingerprints: { $in: dedupeFingerprints } },
        ],
      })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(12)
      .toArray();
    if (fingerprintCandidates.length) {
      const strongMatches: any[] = [];
      const weakMatches: any[] = [];
      for (const candidate of fingerprintCandidates) {
        const candidateFingerprints = Array.isArray(candidate?.dedupeFingerprints)
          ? candidate.dedupeFingerprints.filter((value: any) => typeof value === "string")
          : [];
        const matchedFingerprints = candidateFingerprints.filter((fingerprint: string) =>
          incomingFingerprintSet.has(fingerprint)
        );
        if (!matchedFingerprints.length) continue;
        if (matchedFingerprints.some((fingerprint: string) => hasStrongFingerprint(fingerprint))) {
          strongMatches.push(candidate);
        } else {
          weakMatches.push(candidate);
        }
      }

      if (strongMatches.length > 0) {
        if (strongMatches.length === 1) {
          return strongMatches[0];
        }
        if (incomingAttendeeKeys.length) {
          const bestStrong = selectBestAttendeeOverlapCandidate(
            strongMatches,
            incomingAttendeeKeys
          );
          if (bestStrong.candidate && bestStrong.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN) {
            return bestStrong.candidate;
          }
        }
        return strongMatches[0];
      }

      if (weakMatches.length > 0 && incomingAttendeeKeys.length) {
        const bestWeak = selectBestAttendeeOverlapCandidate(
          weakMatches,
          incomingAttendeeKeys
        );
        if (bestWeak.candidate && bestWeak.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN) {
          return bestWeak.candidate;
        }
      }
    }
  }

  if (!startTime || !title) {
    return null;
  }

  const rangeStart = new Date(startTime.getTime() - CROSS_NOTETAKER_DEDUPE_WINDOW_MS);
  const rangeEnd = new Date(startTime.getTime() + CROSS_NOTETAKER_DEDUPE_WINDOW_MS);
  const titleRegex = new RegExp(`^${escapeRegex(title.trim())}$`, "i");

  const titleTimeMatches = await meetings
    .find({
      $and: [
        scopeFilter,
        { ingestSource: "fathom" },
        { title: titleRegex },
        { startTime: { $gte: rangeStart, $lte: rangeEnd } },
        ...(durationSeconds === null
          ? []
          : [
              {
                duration: {
                  $gte: durationSeconds - CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS,
                  $lte: durationSeconds + CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS,
                },
              },
            ]),
      ],
    })
    .sort({ lastActivityAt: -1, _id: -1 })
    .limit(12)
    .toArray();

  if (!titleTimeMatches.length || !incomingAttendeeKeys.length) {
    return null;
  }

  const bestTitleTimeMatch = selectBestAttendeeOverlapCandidate(
    titleTimeMatches,
    incomingAttendeeKeys
  );
  if (
    bestTitleTimeMatch.candidate &&
    bestTitleTimeMatch.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN
  ) {
    return bestTitleTimeMatch.candidate;
  }

  return null;
};

export const buildDuplicateRecordingHashScope = getFathomRecordingHashScope;

export const computeDuplicateAttendeeOverlapRatio = computeAttendeeOverlapRatio;

export const extractDuplicateMeetingAttendeeKeysFromDocument =
  extractMeetingAttendeeKeysFromDocument;
