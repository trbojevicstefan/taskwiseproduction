import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { upsertSourceIdentity } from "@/lib/people-matching";
import {
  classifyPersonHeuristic,
  resolveInternalDomains,
} from "@/lib/person-classification";
import type { PersonSourceIdentityProvider } from "@/types/person";

type AttendeeInput = {
  name?: string | null;
  email?: string | null;
  title?: string | null;
};

// Meeting providers whose attendee lists flow through this upsert path.
export type MeetingPeopleProvider = Extract<
  PersonSourceIdentityProvider,
  "fathom" | "fireflies" | "grain" | "google"
>;

const MEETING_PEOPLE_PROVIDERS: ReadonlySet<string> = new Set([
  "fathom",
  "fireflies",
  "grain",
  "google",
]);

export const resolveMeetingPeopleProvider = (
  ingestSource?: string | null
): MeetingPeopleProvider | null =>
  typeof ingestSource === "string" && MEETING_PEOPLE_PROVIDERS.has(ingestSource)
    ? (ingestSource as MeetingPeopleProvider)
    : null;

type UpsertPeopleResult = {
  created: number;
  updated: number;
};

const normalizeEmail = (email?: string | null) =>
  email ? email.trim().toLowerCase() : "";

const normalizeName = (name?: string | null) => (name ? name.trim() : "");

const addToMap = (map: Map<string, any>, key: string, person: any) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, person);
};

export const upsertPeopleFromAttendees = async ({
  db,
  userId,
  attendees,
  sourceSessionId,
  provider,
}: {
  db: Db;
  userId: string;
  attendees: AttendeeInput[];
  sourceSessionId?: string | null;
  // Meeting provider the attendees came from (records sourceIdentities);
  // omit for plain transcript/paste ingestion.
  provider?: MeetingPeopleProvider | null;
}): Promise<UpsertPeopleResult> => {
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return { created: 0, updated: 0 };
  }

  const allPeople = await db
    .collection("people")
    .find({ userId })
    .toArray();
  // Merged tombstones must never re-absorb attendees — their aliases were
  // unioned into the surviving person during the merge.
  const people = allPeople.filter(
    (person: any) => person.mergeState !== "merged"
  );

  const emailMap = new Map<string, any>();
  const nameKeyMap = new Map<string, any>();
  const aliasKeyMap = new Map<string, any>();

  const attachToMaps = (person: any) => {
    addToMap(emailMap, normalizeEmail(person.email), person);
    addToMap(nameKeyMap, normalizePersonNameKey(person.name || ""), person);
    if (Array.isArray(person.aliases)) {
      person.aliases.forEach((alias: string) => {
        const trimmed = alias?.trim();
        if (!trimmed) return;
        if (trimmed.includes("@")) {
          addToMap(emailMap, normalizeEmail(trimmed), person);
          return;
        }
        addToMap(aliasKeyMap, normalizePersonNameKey(trimmed), person);
      });
    }
  };

  people.forEach(attachToMaps);

  // Internal domains for auto-classification. Kept cheap: derived lazily from
  // the ingesting user's own email domain only (a single users lookup per
  // ingestion batch) — full workspace member ids are not available here.
  let internalDomainsPromise: Promise<Set<string>> | null = null;
  const getInternalDomains = () => {
    if (!internalDomainsPromise) {
      internalDomainsPromise = resolveInternalDomains(db, {
        userIds: [userId],
      }).catch(() => new Set<string>());
    }
    return internalDomainsPromise;
  };

  let created = 0;
  let updated = 0;
  const now = new Date();

  for (const attendee of attendees) {
    const name = normalizeName(attendee?.name);
    const email = normalizeEmail(attendee?.email);
    if (!name && !email) continue;

    const nameKey = name ? normalizePersonNameKey(name) : "";
    const existing =
      (email && emailMap.get(email)) ||
      (nameKey && (nameKeyMap.get(nameKey) || aliasKeyMap.get(nameKey))) ||
      null;

    if (existing) {
      const update: Record<string, any> = { lastSeenAt: now };
      const nextAliases = new Set<string>(existing.aliases || []);
      if (name && existing.name && name !== existing.name) {
        nextAliases.add(name);
      }
      if (email && existing.email && normalizeEmail(existing.email) !== email) {
        nextAliases.add(email);
      }

      if (!existing.email && email) update.email = email;
      if (!existing.title && attendee?.title) update.title = attendee.title;
      if (!existing.name && name) update.name = name;

      const sourceSessions = new Set<string>(existing.sourceSessionIds || []);
      if (sourceSessionId) sourceSessions.add(sourceSessionId);
      update.sourceSessionIds = Array.from(sourceSessions);

      if (nextAliases.size !== (existing.aliases || []).length) {
        update.aliases = Array.from(nextAliases);
      }

      if (provider) {
        update.sourceIdentities = upsertSourceIdentity(existing.sourceIdentities, {
          provider,
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
          confidence: 0.9,
          lastSeenAt: now,
        });
      }
      if (!existing.mergeState) update.mergeState = "active";

      // Auto-(re)classify only when it cannot clobber a manual choice and the
      // doc is unclassified or just gained an email — avoid churning docs.
      const gainedEmail = Boolean(!existing.email && email);
      if (
        existing.personTypeSource !== "manual" &&
        (gainedEmail || !existing.personType)
      ) {
        const classification = classifyPersonHeuristic(
          {
            email: update.email ?? existing.email ?? null,
            slackId: existing.slackId ?? null,
          },
          await getInternalDomains()
        );
        update.personType = classification.personType;
        update.personTypeSource = "auto";
        update.personTypeReason = classification.reason;
      }

      await db.collection("people").updateOne(
        { _id: existing._id, userId },
        { $set: update }
      );

      const nextPerson = {
        ...existing,
        ...update,
        aliases: update.aliases ?? existing.aliases,
        email: update.email ?? existing.email,
        name: update.name ?? existing.name,
      };
      attachToMaps(nextPerson);
      updated += 1;
      continue;
    }

    const classification = classifyPersonHeuristic(
      { email: email || null, slackId: null },
      await getInternalDomains()
    );

    const person = {
      _id: randomUUID(),
      userId,
      name: name || email,
      email: email || null,
      title: attendee?.title || null,
      avatarUrl: null,
      slackId: null,
      firefliesId: null,
      phantomBusterId: null,
      aliases: [],
      isBlocked: false,
      sourceSessionIds: sourceSessionId ? [sourceSessionId] : [],
      personType: classification.personType,
      personTypeSource: "auto",
      personTypeReason: classification.reason,
      primarySource: provider ? "meeting_provider" : "transcript",
      mergeState: "active",
      sourceIdentities: provider
        ? [
            {
              provider,
              ...(email ? { email } : {}),
              ...(name ? { name } : {}),
              confidence: 0.9,
              lastSeenAt: now,
            },
          ]
        : [],
      createdAt: now,
      lastSeenAt: now,
    };

    await db.collection("people").insertOne(person as any);
    attachToMaps(person);
    created += 1;
  }

  return { created, updated };
};

