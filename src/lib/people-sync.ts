import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

type AttendeeInput = {
  name?: string | null;
  email?: string | null;
  title?: string | null;
};

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
}: {
  db: Db;
  userId: string;
  attendees: AttendeeInput[];
  sourceSessionId?: string | null;
}): Promise<UpsertPeopleResult> => {
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return { created: 0, updated: 0 };
  }

  const userIdQuery = buildIdQuery(userId);
  const people = await db
    .collection<any>("people")
    .find({ userId: userIdQuery })
    .toArray();

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

      await db.collection<any>("people").updateOne(
        { _id: existing._id, userId: userIdQuery },
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
      createdAt: now,
      lastSeenAt: now,
    };

    await db.collection<any>("people").insertOne(person);
    attachToMaps(person);
    created += 1;
  }

  return { created, updated };
};
