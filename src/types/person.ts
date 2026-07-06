// src/types/person.ts

export type PersonType = "teammate" | "client" | "unknown";
export type PersonTypeSource = "manual" | "auto";

// Canonical identity model (Priority 6). All fields are additive/optional —
// docs without them are treated as { mergeState: "active" } with no recorded
// source identities.
export type PersonPrimarySource =
  | "slack"
  | "manual"
  | "meeting_provider"
  | "transcript";

export type PersonSourceIdentityProvider =
  | "slack"
  | "fathom"
  | "fireflies"
  | "grain"
  | "google"
  | "manual";

export interface PersonSourceIdentity {
  provider: PersonSourceIdentityProvider;
  externalId?: string;
  email?: string;
  name?: string;
  confidence?: number;
  lastSeenAt?: any; // Date in Mongo, ISO string over the wire
}

export type PersonMergeState = "active" | "merged" | "blocked";

export interface Person {
  id: string; // Document ID
  userId: string; // The TaskWiseAI user who this person belongs to
  name: string;
  email?: string | null;
  title?: string | null; // e.g., "Project Manager"
  avatarUrl?: string | null;
  slackId?: string | null;
  firefliesId?: string | null;
  phantomBusterId?: string | null;
  aliases?: string[]; 
  isBlocked?: boolean | null;
  sourceSessionIds: string[]; // List of session IDs where this person was identified
  personType?: PersonType; // absent === 'unknown'
  personTypeSource?: PersonTypeSource; // 'manual' set only by user actions; auto must never overwrite manual
  personTypeReason?: string; // short human-readable heuristic reason
  company?: string | null; // client accounts; user-editable; may be auto-suggested from email domain
  nextFollowUpAt?: string | null; // ISO date, user-set
  canonicalPersonId?: string | null; // for merged losers: the canonical (winning) person id
  primarySource?: PersonPrimarySource | null; // where this profile canonically comes from
  sourceIdentities?: PersonSourceIdentity[]; // per-provider identity trail
  mergeState?: PersonMergeState | null; // absent === "active"
  mergedIntoPersonId?: string | null; // set when mergeState === "merged"
  blockedMergePersonIds?: string[]; // person ids this person must never be merge-suggested with
  blockedMergeKeys?: string[]; // normalized name/email keys of discovered candidates blocked from matching this person
  createdAt: any; // Timestamp
  lastSeenAt: any; // Timestamp
}

export interface PersonWithTaskCount extends Person {
    taskCount: number;
    taskCounts?: {
      total: number;
      open: number;
      todo: number;
      inprogress: number;
      done: number;
      recurring: number;
    };
    lastMeetingAt?: string | null; // ISO string — max meeting startTime among sourceSessionIds
    overdueTaskCount?: number; // open tasks with dueAt < now and status !== 'done'
}
