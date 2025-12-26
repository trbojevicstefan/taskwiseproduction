import type { Person } from "@/types/person";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

export type PersonMatchReason = "email" | "name" | "alias";

export type PersonMatch = {
  source: Person;
  target: Person;
  confidence: number;
  reason: PersonMatchReason;
};

type CandidatePerson = {
  name?: string | null;
  email?: string | null;
};

export type CandidateMatch = {
  person: Person;
  confidence: number;
  reason: PersonMatchReason;
};

const tokenize = (value: string) =>
  new Set(
    value
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
  );

const intersectionSize = (a: Set<string>, b: Set<string>) => {
  let count = 0;
  a.forEach((token) => {
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

const hasAliasMatch = (source: CandidatePerson, target: Person) => {
  const sourceName = source.name ? normalizePersonNameKey(source.name) : "";
  if (!sourceName) return false;
  return (target.aliases || []).some(
    (alias) => normalizePersonNameKey(alias) === sourceName
  );
};

export const getRankedPersonMatches = (
  candidate: CandidatePerson,
  existing: Person[],
  limit = 5
): CandidateMatch[] => {
  const candidateEmail = normalizeEmail(candidate.email);
  const candidateName = candidate.name ? candidate.name.trim() : "";
  const ranked: CandidateMatch[] = [];

  existing.forEach((person) => {
    if (person.isBlocked) return;
    if (!person.name) return;

    const personEmail = normalizeEmail(person.email);
    if (candidateEmail && personEmail && candidateEmail === personEmail) {
      ranked.push({ person, confidence: 1, reason: "email" });
      return;
    }

    if (hasAliasMatch(candidate, person)) {
      ranked.push({ person, confidence: 0.92, reason: "alias" });
      return;
    }

    if (candidateName) {
      const score = nameSimilarity(candidateName, person.name);
      ranked.push({ person, confidence: score, reason: "name" });
    }
  });

  return ranked
    .filter((match) => match.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
};

export const getBestPersonMatch = (
  candidate: CandidatePerson,
  existing: Person[],
  threshold = 0.88
): { person: Person; confidence: number; reason: PersonMatchReason } | null => {
  const candidateEmail = normalizeEmail(candidate.email);
  const candidateName = candidate.name ? candidate.name.trim() : "";

  let best: { person: Person; confidence: number; reason: PersonMatchReason } | null =
    null;

  existing.forEach((person) => {
    if (person.isBlocked) return;
    if (!person.name) return;

    const personEmail = normalizeEmail(person.email);
    if (candidateEmail && personEmail && candidateEmail === personEmail) {
      best = { person, confidence: 1, reason: "email" };
      return;
    }

    if (hasAliasMatch(candidate, person)) {
      const confidence = 0.92;
      if (!best || confidence > best.confidence) {
        best = { person, confidence, reason: "alias" };
      }
      return;
    }

    if (candidateName) {
      const score = nameSimilarity(candidateName, person.name);
      if (!best || score > best.confidence) {
        best = { person, confidence: score, reason: "name" };
      }
    }
  });

  if (!best || best.confidence < threshold) return null;
  return best;
};

export const getPotentialPersonMatches = (
  people: Person[],
  threshold = 0.78
): PersonMatch[] => {
  const candidates = people.filter((person) => !person.isBlocked);
  const withSlack = candidates.filter((person) => person.slackId || person.email);
  const withoutSlack = candidates.filter((person) => !person.slackId);

  const matches: PersonMatch[] = [];
  withoutSlack.forEach((source) => {
    let best: PersonMatch | null = null;
    withSlack.forEach((target) => {
      if (source.id === target.id) return;
      const emailMatch =
        source.email && target.email && source.email.toLowerCase() === target.email.toLowerCase();
      if (emailMatch) {
        best = { source, target, confidence: 1, reason: "email" };
        return;
      }
      if (hasAliasMatch(source, target)) {
        const confidence = 0.92;
        if (!best || confidence > best.confidence) {
          best = { source, target, confidence, reason: "alias" };
        }
        return;
      }
      if (source.name && target.name) {
        const score = nameSimilarity(source.name, target.name);
        if (!best || score > best.confidence) {
          best = { source, target, confidence: score, reason: "name" };
        }
      }
    });

    if (best && best.confidence >= threshold) {
      matches.push(best);
    }
  });

  return matches.sort((a, b) => b.confidence - a.confidence);
};
