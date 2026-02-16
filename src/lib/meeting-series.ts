
import { Db } from "mongodb";
import { Meeting } from "@/types/meeting";
import { normalizeTitleKey } from "@/lib/ai-utils";
import { normalizeEmail } from "@/lib/task-completion";

const TITLE_SIMILARITY_THRESHOLD = 0.8;
const ATTENDEE_OVERLAP_THRESHOLD = 0.5;

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}

function tokenize(text: string): Set<string> {
    const normalized = normalizeTitleKey(text);
    if (!normalized) return new Set();
    return new Set(normalized.split(" "));
}

export const findPreviousMeeting = async (
    db: Db,
    currentMeeting: Meeting
): Promise<Meeting | null> => {
    if (!currentMeeting.workspaceId) return null;

    // Candidate fetching: Meetings in same workspace, before this one
    const filter = {
        workspaceId: currentMeeting.workspaceId,
        _id: { $ne: currentMeeting._id },
        startTime: { $lt: currentMeeting.startTime },
        status: { $ne: "cancelled" },
    };
    const candidates = await db.collection<Meeting>("meetings")
        .find(filter as import('mongodb').Filter<Meeting>)
        .sort({ startTime: -1 })
        .limit(20)
        .toArray();

    if (!candidates.length) return null;

    const currentTokens = tokenize(currentMeeting.title || "");
    const currentEmails = new Set(
        (currentMeeting.attendees || []).map(a => normalizeEmail(a.email)).filter(Boolean)
    );

    let bestMatch: Meeting | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
        // Title Similarity
        const candidateTokens = tokenize(candidate.title || "");
        const titleScore = jaccardSimilarity(currentTokens, candidateTokens);

        // Attendee Overlap
        const candidateEmails = new Set(
            (candidate.attendees || []).map(a => normalizeEmail(a.email)).filter(Boolean)
        );
        const personScore = jaccardSimilarity(currentEmails, candidateEmails);

        // Weighted Score (Title matters more?)
        // If title is "Weekly Sync", it matches perfectly.
        // If title is different, people match matters.

        // Heuristic:
        // If Title > 0.8, it's a match regardless of people (likely).
        // If Title > 0.4 AND People > 0.5, it's a match.

        let isMatch = false;
        let score = 0;

        if (titleScore > TITLE_SIMILARITY_THRESHOLD) {
            isMatch = true;
            score = titleScore + (personScore * 0.2);
        } else if (titleScore > 0.4 && personScore > ATTENDEE_OVERLAP_THRESHOLD) {
            isMatch = true;
            score = titleScore + personScore;
        }

        if (isMatch && score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }

    // If no good match found, maybe just return the very last meeting with > 50% attendee overlap?
    // Context is usually relevant if same people are there.
    if (!bestMatch) {
        for (const candidate of candidates) {
            const candidateEmails = new Set(
                (candidate.attendees || []).map(a => normalizeEmail(a.email)).filter(Boolean)
            );
            if (jaccardSimilarity(currentEmails, candidateEmails) > 0.7) {
                return candidate; // Fallback to attendee match
            }
        }
    }

    return bestMatch;
}

