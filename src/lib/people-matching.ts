/**
 * People matching + canonical identity helpers (Priority 6).
 *
 * Scoring contract (confidences are deliberately tiered so callers can rely on
 * thresholds):
 *   - exact email                        → 1.0   ("email")
 *   - exact Slack id                     → 1.0   ("slack")
 *   - existing alias (name or email)     → 0.92  ("alias")
 *   - exact normalized full name         → 1.0   ("name")
 *   - fuzzy full-name similarity         → ≤0.86 ("name")   — never auto-merges
 *   - same email domain + similar name   → 0.78–0.86 ("domain") — suggest only
 *   - same first name only               → ≤0.45 ("first_name") — never auto-merge
 *   - client company/domain match        → 0.6   ("company") — suggest only
 *
 * Only "email", "slack", "alias" and exact-name matches can reach the >=0.88
 * auto-merge band; every fuzzy signal is capped at 0.86.
 *
 * Canonical precedence: Slack is the canonical source for teammates. When a
 * Slack-backed person and a transcript-only person match, the Slack person is
 * always the merge target (see resolveMergeDirection).
 *
 * Blocked pairs: a person doc may carry `blockedMergePersonIds` (ids of saved
 * people it must never be paired with again) and `blockedMergeKeys`
 * (normalized name/email keys of discovered-but-unsaved candidates the user
 * blocked). Both are honored by every matcher in this module. People with
 * `mergeState: "merged"` are tombstones and are never matched or suggested.
 *
 * NOTE (backfill): existing person docs have none of the canonical fields.
 * That is fine — absence is treated as { mergeState: "active", sourceIdentities: [] }.
 * If a data backfill is ever desired (e.g. stamping `primarySource: "slack"`
 * on docs with a slackId), do it with an idempotent script under scripts/
 * (dry-run + apply); no migration is required for reads.
 *
 * This module is imported by client components — keep it dependency-free of
 * server-only modules (mongodb, db helpers, etc.).
 */
import type { Person, PersonSourceIdentity } from "@/types/person";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

export type PersonMatchReason =
  | "email"
  | "slack"
  | "name"
  | "alias"
  | "domain"
  | "first_name"
  | "company";

export type PersonMatch = {
  source: Person;
  target: Person;
  confidence: number;
  reason: PersonMatchReason;
};

type CandidatePerson = {
  name?: string | null;
  email?: string | null;
  slackId?: string | null;
  company?: string | null;
};

export type CandidateMatch = {
  person: Person;
  confidence: number;
  reason: PersonMatchReason;
};

// Confidence caps/floors for the fuzzy tiers. Anything below
// AUTO_MERGE_MIN_CONFIDENCE must never be auto-merged by callers.
export const AUTO_MERGE_MIN_CONFIDENCE = 0.88;
const FUZZY_NAME_MAX_CONFIDENCE = 0.86;
const DOMAIN_MATCH_MIN_CONFIDENCE = 0.78;
const FIRST_NAME_ONLY_MAX_CONFIDENCE = 0.45;
const COMPANY_MATCH_CONFIDENCE = 0.6;
// Reasons that are suggest-only: they surface in review UIs at a lower floor
// but are never eligible for auto-merge regardless of numeric confidence.
const SUGGEST_ONLY_REASONS: ReadonlySet<PersonMatchReason> = new Set([
  "domain",
  "first_name",
  "company",
]);

// Intentionally duplicated (small) subset of free-mail domains from
// person-classification.ts — that module imports mongodb and must not be
// pulled into client bundles through this one.
const COMMON_FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "msn.com",
]);

const tokenize = (value: string) =>
  new Set(
    value
      .split(" ")
      .map((token: any) => token.trim())
      .filter(Boolean)
  );

const intersectionSize = (a: Set<string>, b: Set<string>) => {
  let count = 0;
  a.forEach((token: any) => {
    if (b.has(token)) count += 1;
  });
  return count;
};

const levenshteinDistance = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

const nameSimilarity = (left: string, right: string): number => {
  const leftNorm = normalizePersonNameKey(left);
  const rightNorm = normalizePersonNameKey(right);
  if (!leftNorm || !rightNorm) return 0;
  if (leftNorm === rightNorm) return 1;

  const leftTokens = tokenize(leftNorm);
  const rightTokens = tokenize(rightNorm);
  const overlap = intersectionSize(leftTokens, rightTokens);
  const tokenScore = overlap / Math.max(leftTokens.size, rightTokens.size, 1);

  const distance = levenshteinDistance(leftNorm, rightNorm);
  const maxLen = Math.max(leftNorm.length, rightNorm.length, 1);
  const levenshteinScore = 1 - distance / maxLen;

  const leftParts = leftNorm.split(" ");
  const rightParts = rightNorm.split(" ");
  const lastNameBoost =
    leftParts.length > 1 &&
    rightParts.length > 1 &&
    leftParts[leftParts.length - 1] === rightParts[rightParts.length - 1]
      ? 0.08
      : 0;

  return Math.min(1, Math.max(tokenScore, levenshteinScore) + lastNameBoost);
};

const normalizeEmail = (email?: string | null) =>
  email ? email.trim().toLowerCase() : "";

const extractDomain = (email?: string | null): string => {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) return "";
  const domain = normalized.slice(atIndex + 1);
  if (!domain.includes(".")) return "";
  return domain;
};

const normalizeCompany = (company?: string | null) =>
  company ? company.trim().toLowerCase() : "";

// True when the only overlap between two different normalized names is the
// shared first token — e.g. "John" vs "John Smith", "John Smith" vs
// "John Doe". Such matches are low-confidence and must never auto-merge.
const isFirstNameOnlyMatch = (leftKey: string, rightKey: string): boolean => {
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  const leftTokens = leftKey.split(" ").filter(Boolean);
  const rightTokens = rightKey.split(" ").filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return false;
  if (leftTokens[0] !== rightTokens[0]) return false;
  const shared = intersectionSize(new Set(leftTokens), new Set(rightTokens));
  return shared === 1;
};

const hasAliasMatch = (source: CandidatePerson, target: Person) => {
  const sourceName = source.name ? normalizePersonNameKey(source.name) : "";
  const sourceEmail = normalizeEmail(source.email);
  if (!sourceName && !sourceEmail) return false;

  const toTokens = (value: string) =>
    value.split(" ").map((token: any) => token.trim()).filter(Boolean);
  const isSubset = (subset: string[], container: Set<string>) =>
    subset.every((token) => container.has(token));

  return (target.aliases || []).some((alias: any) => {
    const trimmed = alias?.trim();
    if (!trimmed) return false;
    const aliasEmail = normalizeEmail(trimmed);
    if (sourceEmail && aliasEmail && aliasEmail === sourceEmail) {
      return true;
    }
    if (sourceName) {
      const aliasNameKey = normalizePersonNameKey(trimmed);
      if (!aliasNameKey) return false;
      if (aliasNameKey === sourceName) return true;
      const sourceTokens = new Set(toTokens(sourceName));
      const aliasTokens = toTokens(aliasNameKey);
      if (!aliasTokens.length || !sourceTokens.size) return false;
      return (
        isSubset(aliasTokens, sourceTokens) ||
        isSubset(Array.from(sourceTokens), new Set(aliasTokens))
      );
    }
    return false;
  });
};

const isMergedTombstone = (person: Person) => person.mergeState === "merged";

const candidateBlockKeys = (candidate: CandidatePerson): string[] => {
  const keys: string[] = [];
  const email = normalizeEmail(candidate.email);
  if (email) keys.push(email);
  const nameKey = candidate.name ? normalizePersonNameKey(candidate.name) : "";
  if (nameKey) keys.push(nameKey);
  return keys;
};

/**
 * True when a discovered (possibly unsaved) candidate was explicitly blocked
 * from matching this saved person (by normalized name or email key).
 */
export const isMergeBlockedForCandidate = (
  candidate: CandidatePerson,
  person: Person
): boolean => {
  const blockedKeys = person.blockedMergeKeys;
  if (!Array.isArray(blockedKeys) || !blockedKeys.length) return false;
  const blocked = new Set(blockedKeys.map((key) => key.trim().toLowerCase()).filter(Boolean));
  return candidateBlockKeys(candidate).some((key) => blocked.has(key));
};

/**
 * True when two saved people were explicitly blocked from being merged with
 * each other (id pair or key block, in either direction).
 */
export const isMergeBlockedBetween = (a: Person, b: Person): boolean => {
  if (a.mergeState === "blocked" || b.mergeState === "blocked") return true;
  const aBlockedIds = new Set(a.blockedMergePersonIds || []);
  const bBlockedIds = new Set(b.blockedMergePersonIds || []);
  if (a.id && bBlockedIds.has(String(a.id))) return true;
  if (b.id && aBlockedIds.has(String(b.id))) return true;
  if (isMergeBlockedForCandidate({ name: a.name, email: a.email }, b)) return true;
  if (isMergeBlockedForCandidate({ name: b.name, email: b.email }, a)) return true;
  return false;
};

/**
 * Slack is canonical for teammates: when two people merge, the Slack-backed
 * person always wins as merge target. Ties fall back to primarySource, then
 * to whichever profile carries an email.
 */
export const resolveMergeDirection = (
  a: Person,
  b: Person
): { source: Person; target: Person } => {
  const aSlack = Boolean(a.slackId) || a.primarySource === "slack";
  const bSlack = Boolean(b.slackId) || b.primarySource === "slack";
  if (aSlack && !bSlack) return { source: b, target: a };
  if (bSlack && !aSlack) return { source: a, target: b };
  if (a.email && !b.email) return { source: b, target: a };
  if (b.email && !a.email) return { source: a, target: b };
  return { source: a, target: b };
};

/** A match is eligible for automatic merging only on exact-identity signals. */
export const isAutoMergeEligible = (match: {
  confidence: number;
  reason: PersonMatchReason;
}): boolean =>
  !SUGGEST_ONLY_REASONS.has(match.reason) &&
  match.confidence >= AUTO_MERGE_MIN_CONFIDENCE;

const scoreCandidateAgainstPerson = (
  candidate: CandidatePerson,
  person: Person
): { confidence: number; reason: PersonMatchReason } | null => {
  const candidateEmail = normalizeEmail(candidate.email);
  const personEmail = normalizeEmail(person.email);
  if (candidateEmail && personEmail && candidateEmail === personEmail) {
    return { confidence: 1, reason: "email" };
  }

  const candidateSlackId = candidate.slackId ? String(candidate.slackId).trim() : "";
  const personSlackId = person.slackId ? String(person.slackId).trim() : "";
  if (candidateSlackId && personSlackId && candidateSlackId === personSlackId) {
    return { confidence: 1, reason: "slack" };
  }

  if (hasAliasMatch(candidate, person)) {
    return { confidence: 0.92, reason: "alias" };
  }

  const candidateName = candidate.name ? candidate.name.trim() : "";
  let best: { confidence: number; reason: PersonMatchReason } | null = null;

  if (candidateName && person.name) {
    const candidateKey = normalizePersonNameKey(candidateName);
    const personKey = normalizePersonNameKey(person.name);
    if (candidateKey && personKey && candidateKey === personKey) {
      return { confidence: 1, reason: "name" };
    }

    const raw = nameSimilarity(candidateName, person.name);
    if (raw > 0) {
      const candidateDomain = extractDomain(candidateEmail);
      const personDomain = extractDomain(personEmail);
      const sharesWorkDomain =
        Boolean(candidateDomain) &&
        candidateDomain === personDomain &&
        !COMMON_FREE_EMAIL_DOMAINS.has(candidateDomain);

      if (isFirstNameOnlyMatch(candidateKey, personKey)) {
        best = {
          confidence: Math.min(raw, FIRST_NAME_ONLY_MAX_CONFIDENCE),
          reason: "first_name",
        };
      } else if (sharesWorkDomain && raw >= 0.5) {
        best = {
          confidence: Math.min(
            FUZZY_NAME_MAX_CONFIDENCE,
            Math.max(DOMAIN_MATCH_MIN_CONFIDENCE, raw)
          ),
          reason: "domain",
        };
      } else {
        best = {
          confidence: Math.min(raw, FUZZY_NAME_MAX_CONFIDENCE),
          reason: "name",
        };
      }
    }
  }

  // Client company / external-domain grouping: suggest-only signal, used when
  // nothing stronger was found.
  if (!best || best.confidence < COMPANY_MATCH_CONFIDENCE) {
    const candidateCompany = normalizeCompany(candidate.company);
    const personCompany = normalizeCompany(person.company);
    const sameCompany =
      Boolean(candidateCompany) && candidateCompany === personCompany;
    const candidateDomain = extractDomain(candidateEmail);
    const personDomain = extractDomain(personEmail);
    const sameExternalDomain =
      Boolean(candidateDomain) &&
      candidateDomain === personDomain &&
      !COMMON_FREE_EMAIL_DOMAINS.has(candidateDomain);
    if (sameCompany || sameExternalDomain) {
      best = { confidence: COMPANY_MATCH_CONFIDENCE, reason: "company" };
    }
  }

  return best;
};

export const getRankedPersonMatches = (
  candidate: CandidatePerson,
  existing: Person[],
  limit = 5
): CandidateMatch[] => {
  const ranked: CandidateMatch[] = [];

  for (const person of existing) {
    if (person.isBlocked) continue;
    if (!person.name) continue;
    if (isMergedTombstone(person)) continue;
    if (isMergeBlockedForCandidate(candidate, person)) continue;

    const score = scoreCandidateAgainstPerson(candidate, person);
    if (score) {
      ranked.push({ person, confidence: score.confidence, reason: score.reason });
    }
  }

  return ranked
    .filter((match: any) => match.confidence > 0)
    .sort((a: any, b: any) => b.confidence - a.confidence)
    .slice(0, limit);
};

export const getBestPersonMatch = (
  candidate: CandidatePerson,
  existing: Person[],
  threshold = 0.88
): { person: Person; confidence: number; reason: PersonMatchReason } | null => {
  let best: { person: Person; confidence: number; reason: PersonMatchReason } | null =
    null;

  for (const person of existing) {
    if (person.isBlocked) continue;
    if (!person.name) continue;
    if (isMergedTombstone(person)) continue;
    if (isMergeBlockedForCandidate(candidate, person)) continue;

    const score = scoreCandidateAgainstPerson(candidate, person);
    if (!score) continue;
    if (!best || score.confidence > best.confidence) {
      best = { person, confidence: score.confidence, reason: score.reason };
    }
  }

  if (!best || best.confidence < threshold) return null;
  return best;
};

export const getPotentialPersonMatches = (
  people: Person[],
  threshold = 0.78
): PersonMatch[] => {
  const candidates = people.filter(
    (person: any) => !person.isBlocked && !isMergedTombstone(person)
  );
  const anchors = candidates.filter((person: any) => person.slackId || person.email);
  const withoutSlack = candidates.filter((person: any) => !person.slackId);

  const matches: PersonMatch[] = [];
  for (const source of withoutSlack) {
    let best: PersonMatch | null = null;
    for (const target of anchors) {
      if (source.id === target.id) continue;
      if (isMergeBlockedBetween(source, target)) continue;
      const score = scoreCandidateAgainstPerson(
        {
          name: source.name,
          email: source.email,
          slackId: source.slackId,
          company: source.company,
        },
        target
      );
      if (!score) continue;
      if (!best || score.confidence > best.confidence) {
        // Canonical precedence: Slack (then email) person wins as target.
        const direction = resolveMergeDirection(source, target);
        best = {
          source: direction.source,
          target: direction.target,
          confidence: score.confidence,
          reason: score.reason,
        };
      }
    }

    if (!best) continue;
    const qualifies =
      best.confidence >= threshold ||
      (SUGGEST_ONLY_REASONS.has(best.reason) &&
        best.confidence >= COMPANY_MATCH_CONFIDENCE);
    if (qualifies) {
      matches.push(best);
    }
  }

  return matches.sort((a: any, b: any) => b.confidence - a.confidence);
};

// ---------------------------------------------------------------------------
// Source identity helpers (canonical profile trail)
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `identities` with `entry` inserted or refreshed. Entries
 * are keyed by provider + externalId (falling back to provider + email, then
 * provider alone) so re-syncs update `lastSeenAt` instead of duplicating.
 */
export const upsertSourceIdentity = (
  identities: PersonSourceIdentity[] | undefined | null,
  entry: PersonSourceIdentity
): PersonSourceIdentity[] => {
  const list = Array.isArray(identities) ? [...identities] : [];
  const keyOf = (identity: PersonSourceIdentity) =>
    `${identity.provider}:${identity.externalId || normalizeEmail(identity.email) || ""}`;
  const entryKey = keyOf(entry);
  const index = list.findIndex((identity) => keyOf(identity) === entryKey);
  if (index >= 0) {
    list[index] = { ...list[index], ...entry };
  } else {
    list.push(entry);
  }
  return list;
};

/** Union of two identity lists, deduped by provider/externalId/email key. */
export const mergeSourceIdentities = (
  target: PersonSourceIdentity[] | undefined | null,
  source: PersonSourceIdentity[] | undefined | null
): PersonSourceIdentity[] => {
  let merged: PersonSourceIdentity[] = Array.isArray(target) ? [...target] : [];
  for (const identity of source || []) {
    merged = upsertSourceIdentity(merged, identity);
  }
  return merged;
};
