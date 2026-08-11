import { z } from "zod";
import type { Db } from "mongodb";
import {
  assertChatScopeAccess,
  buildWorkspaceVisibilityFilter,
} from "@/lib/chat-scope";
import type {
  McpToolDefinition,
  McpToolResult,
} from "@/lib/mcp-registry";
import {
  extractTranscriptSnippets,
  searchWorkspaceContext,
  tokenize,
  type RetrievedMeeting,
} from "@/lib/workspace-retrieval";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import type { ChatScope } from "@/types/general-chat";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

const SCOPE_TYPES = [
  "workspace",
  "meeting",
  "client",
  "person",
  "planner",
] as const;
const MAX_KNOWLEDGE_LIMIT = 50;
const DEFAULT_KNOWLEDGE_LIMIT = 10;
const MAX_QUERY_CHARS = 4_000;
const MAX_RELATED_PEOPLE = 300;
const MAX_DIRECT_MEETING_SUMMARY_CHARS = 4_000;
const MAX_DIRECT_TRANSCRIPT_SCAN_CHARS = 80_000;

const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Expected a valid ISO date or date-time.",
  });

export const searchWorkspaceKnowledgeArgsSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY_CHARS),
    scopeType: z.enum(SCOPE_TYPES),
    scopeId: z.string().trim().min(1).max(200).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.number().int().min(1).max(MAX_KNOWLEDGE_LIMIT).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.scopeType === "meeting" ||
        value.scopeType === "client" ||
        value.scopeType === "person") &&
      !value.scopeId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: `scopeId is required for ${value.scopeType} scope.`,
      });
    }
    if (
      value.from &&
      value.to &&
      new Date(value.from).getTime() > new Date(value.to).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must be on or after from.",
      });
    }
  });

type KnowledgeArgs = z.infer<typeof searchWorkspaceKnowledgeArgsSchema>;

type ScopeContext = {
  scope: ChatScope;
  meeting?: any;
  person?: any;
  client?: any;
  relatedPeople: any[];
};

const identifierFilter = (id: string) => ({
  $or: [{ _id: id }, { id }],
});

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toScope = (args: KnowledgeArgs): ChatScope => {
  switch (args.scopeType) {
    case "meeting":
      return { type: "meeting", meetingId: args.scopeId! };
    case "client":
      return { type: "client", clientId: args.scopeId! };
    case "person":
      return { type: "person", personId: args.scopeId! };
    case "planner":
      return { type: "planner" };
    case "workspace":
      return { type: "workspace" };
  }
};

const collectPeopleIdentity = (people: any[]) => ({
  ids: uniqueStrings(
    people.flatMap((person) => [
      person?._id,
      person?.id,
      person?.uid,
      person?.slackId,
    ])
  ),
  emails: uniqueStrings(people.map((person) => person?.email)).map((email) =>
    email.toLowerCase()
  ),
});

const uniqueFallbackNames = (people: any[]) =>
  uniqueStrings(
    people.flatMap((person) => {
      const allowedKeys = new Set(
        Array.isArray(person?.__knowledgeUniqueNameKeys)
          ? person.__knowledgeUniqueNameKeys
          : []
      );
      return [person?.name, ...(person?.aliases || [])].filter(
        (name) =>
          typeof name === "string" &&
          allowedKeys.has(normalizePersonNameKey(name))
      );
    })
  );

const missingOrEmptyField = (field: string): Record<string, unknown> => ({
  $or: [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: "" },
  ],
});

const personIdentityMatches = (left: any, right: any) => {
  const leftIdentity = collectPeopleIdentity([left]);
  const rightIdentity = collectPeopleIdentity([right]);
  return (
    leftIdentity.ids.some((id) => rightIdentity.ids.includes(id)) ||
    leftIdentity.emails.some((email) => rightIdentity.emails.includes(email))
  );
};

const markWorkspaceUniqueNames = async (
  db: Db,
  visibility: Record<string, unknown>,
  people: any[]
): Promise<any[]> => {
  const entries = new Map<string, { name: string; owners: any[] }>();
  for (const person of people) {
    const seenPersonKeys = new Set<string>();
    for (const name of uniqueStrings([person?.name, ...(person?.aliases || [])])) {
      const key = normalizePersonNameKey(name);
      if (!key || seenPersonKeys.has(key)) continue;
      seenPersonKeys.add(key);
      const entry = entries.get(key) || { name, owners: [] };
      entry.owners.push(person);
      entries.set(key, entry);
    }
  }

  const workspacePeople = await db
    .collection("people")
    .find(visibility as any, {
      projection: {
        _id: 1,
        id: 1,
        uid: 1,
        slackId: 1,
        email: 1,
        name: 1,
        aliases: 1,
      },
    })
    .limit(MAX_RELATED_PEOPLE + 1)
    .toArray();
  if (workspacePeople.length > MAX_RELATED_PEOPLE) {
    return people.map((person) => ({
      ...person,
      __knowledgeUniqueNameKeys: [],
    }));
  }

  const workspaceOwnersByKey = new Map<string, any[]>();
  for (const person of workspacePeople) {
    const seenPersonKeys = new Set<string>();
    for (const name of uniqueStrings([person?.name, ...(person?.aliases || [])])) {
      const key = normalizePersonNameKey(name);
      if (!key || seenPersonKeys.has(key)) continue;
      seenPersonKeys.add(key);
      const owners = workspaceOwnersByKey.get(key) || [];
      owners.push(person);
      workspaceOwnersByKey.set(key, owners);
    }
  }

  const uniqueKeysByIdentity = new Map<any, string[]>();
  for (const [key, entry] of entries) {
    if (entry.owners.length !== 1) continue;
    const matches = workspaceOwnersByKey.get(key) || [];
    const owner = entry.owners[0];
    if (matches.length === 1 && personIdentityMatches(owner, matches[0])) {
      const keys = uniqueKeysByIdentity.get(owner) || [];
      keys.push(key);
      uniqueKeysByIdentity.set(owner, keys);
    }
  }

  return people.map((person) => ({
    ...person,
    __knowledgeUniqueNameKeys: uniqueKeysByIdentity.get(person) || [],
  }));
};

const personRelationshipFilter = (people: any[]): Record<string, unknown> => {
  const { ids, emails } = collectPeopleIdentity(people);
  const names = uniqueFallbackNames(people);
  const clauses: Record<string, unknown>[] = [
    ...ids.flatMap((id) => [
      { "assignee.uid": id },
      { assigneeId: id },
      { personId: id },
    ]),
    ...emails.flatMap((email) => [
      { "assignee.email": email },
      { assigneeEmail: email },
    ]),
    ...names.map((name) => ({
      $and: [
        { $or: [{ "assignee.name": name }, { assigneeName: name }] },
        missingOrEmptyField("assignee.uid"),
        missingOrEmptyField("assignee.id"),
        missingOrEmptyField("assigneeId"),
        missingOrEmptyField("personId"),
        missingOrEmptyField("assignee.email"),
        missingOrEmptyField("assigneeEmail"),
      ],
    })),
  ];
  return clauses.length ? { $or: clauses } : { _id: { $in: [] } };
};

const attendeeRelationshipFilter = (people: any[]): Record<string, unknown> => {
  const { ids, emails } = collectPeopleIdentity(people);
  const names = uniqueFallbackNames(people);
  const attendeeClauses: Record<string, unknown>[] = [
    ...ids.flatMap((id) => [{ _id: id }, { id }, { uid: id }, { personId: id }]),
    ...emails.map((email) => ({ email })),
    ...names.map((name) => ({
      $and: [
        { name },
        missingOrEmptyField("_id"),
        missingOrEmptyField("id"),
        missingOrEmptyField("uid"),
        missingOrEmptyField("personId"),
        missingOrEmptyField("email"),
      ],
    })),
  ];
  return attendeeClauses.length
    ? { attendees: { $elemMatch: { $or: attendeeClauses } } }
    : { _id: { $in: [] } };
};

const peopleDocumentIdentityFilter = (
  people: any[]
): Record<string, unknown> => {
  const { ids, emails } = collectPeopleIdentity(people);
  const clauses: Record<string, unknown>[] = [
    ...ids.flatMap((id) => [{ _id: id }, { id }]),
    ...emails.map((email) => ({ email })),
  ];
  return clauses.length ? { $or: clauses } : { _id: { $in: [] } };
};

const resolveMeetingAttendeePeople = async (
  db: Db,
  visibility: Record<string, unknown>,
  attendees: any[]
): Promise<any[]> => {
  const stableClauses: Record<string, unknown>[] = [];
  const nameOnly: string[] = [];
  for (const attendee of attendees) {
    const ids = uniqueStrings([
      attendee?._id,
      attendee?.id,
      attendee?.uid,
      attendee?.personId,
    ]);
    const emails = uniqueStrings([attendee?.email]).map((email) =>
      email.toLowerCase()
    );
    if (ids.length || emails.length) {
      stableClauses.push(
        ...ids.flatMap((id) => [{ _id: id }, { id }, { slackId: id }]),
        ...emails.map((email) => ({ email }))
      );
      continue;
    }
    if (typeof attendee?.name === "string" && attendee.name.trim()) {
      nameOnly.push(attendee.name.trim());
    }
  }

  const stablePeople = stableClauses.length
    ? await db
        .collection("people")
        .find({ $and: [visibility, { $or: stableClauses }] } as any)
        .limit(MAX_RELATED_PEOPLE)
        .toArray()
    : [];

  const uniqueNamePeople: any[] = [];
  if (nameOnly.length) {
    for (const name of uniqueStrings(nameOnly).slice(0, MAX_RELATED_PEOPLE)) {
      const exact = new RegExp(`^${escapeRegex(name)}$`, "i");
      const candidates = await db
        .collection("people")
        .find({
          $and: [
            visibility,
            { $or: [{ name: exact }, { aliases: exact }] },
          ],
        } as any)
        .limit(2)
        .toArray();
      const nameKey = normalizePersonNameKey(name);
      const matches = candidates.filter((candidate: any) => {
        const keys = uniqueStrings([
          candidate?.name,
          ...(candidate?.aliases || []),
        ]).map(normalizePersonNameKey);
        return keys.includes(nameKey);
      });
      if (matches.length === 1) {
        uniqueNamePeople.push({
          ...matches[0],
          __knowledgeUniqueNameKeys: [nameKey],
        });
      }
    }
  }

  const deduped = new Map<string, any>();
  for (const person of [...stablePeople, ...uniqueNamePeople]) {
    const identity =
      uniqueStrings([person?._id, person?.id])[0] ||
      uniqueStrings([person?.email])[0]?.toLowerCase();
    if (identity && !deduped.has(identity)) deduped.set(identity, person);
  }
  return Array.from(deduped.values());
};

const loadScopeContext = async (
  db: Db,
  workspaceId: string,
  memberUserIds: string[],
  scope: ChatScope
): Promise<ScopeContext> => {
  const visibility = buildWorkspaceVisibilityFilter(workspaceId, memberUserIds);
  if (scope.type === "meeting") {
    const meeting = await db.collection("meetings").findOne({
      $and: [identifierFilter(scope.meetingId), visibility],
    } as any);
    const relatedPeople = await resolveMeetingAttendeePeople(
      db,
      visibility,
      Array.isArray(meeting?.attendees) ? meeting.attendees : []
    );
    return { scope, meeting, relatedPeople };
  }
  if (scope.type === "person") {
    const person = await db.collection("people").findOne({
      $and: [identifierFilter(scope.personId), visibility],
    } as any);
    const relatedPeople = person
      ? await markWorkspaceUniqueNames(db, visibility, [person])
      : [];
    return { scope, person, relatedPeople };
  }
  if (scope.type === "client") {
    const client = await db.collection("companies").findOne({
      $and: [identifierFilter(scope.clientId), { workspaceId }],
    } as any);
    const peopleIds = uniqueStrings(client?.peopleIds || []);
    const relationshipClauses: Record<string, unknown>[] = [];
    if (peopleIds.length) {
      relationshipClauses.push(
        { _id: { $in: peopleIds } },
        { id: { $in: peopleIds } }
      );
    }
    if (typeof client?.name === "string" && client.name.trim()) {
      relationshipClauses.push({ company: client.name.trim() });
    }
    if (typeof client?.domain === "string" && client.domain.trim()) {
      relationshipClauses.push({
        email: new RegExp(`@${escapeRegex(client.domain.trim())}$`, "i"),
      });
    }
    const relatedPeople = relationshipClauses.length
      ? await db
          .collection("people")
          .find({
            $and: [visibility, { $or: relationshipClauses }],
          } as any)
          .limit(MAX_RELATED_PEOPLE)
          .toArray()
      : [];
    return {
      scope,
      client,
      relatedPeople: await markWorkspaceUniqueNames(
        db,
        visibility,
        relatedPeople
      ),
    };
  }
  return { scope, relatedPeople: [] };
};

const buildConstraints = (context: ScopeContext) => {
  switch (context.scope.type) {
    case "meeting": {
      const meetingId = context.scope.meetingId;
      return {
        meetings: identifierFilter(meetingId),
        chunks: { meetingId },
        tasks: {
          $or: [
            { sourceSessionId: meetingId },
            { sourceMeetingId: meetingId },
            { meetingId },
          ],
        },
        people: peopleDocumentIdentityFilter(context.relatedPeople),
      };
    }
    case "person":
      return {
        meetings: attendeeRelationshipFilter(context.relatedPeople),
        tasks: personRelationshipFilter(context.relatedPeople),
        people: identifierFilter(context.scope.personId),
      };
    case "client": {
      const ids = uniqueStrings(
        context.relatedPeople.flatMap((person) => [person?._id, person?.id])
      );
      const peopleClauses: Record<string, unknown>[] = [];
      if (ids.length) {
        peopleClauses.push({ _id: { $in: ids } }, { id: { $in: ids } });
      }
      return {
        meetings: attendeeRelationshipFilter(context.relatedPeople),
        tasks: personRelationshipFilter(context.relatedPeople),
        people: peopleClauses.length ? { $or: peopleClauses } : { _id: { $in: [] } },
      };
    }
    case "planner":
    case "workspace":
      return undefined;
  }
};

const serializeClient = (client: any) => ({
  id: String(client?._id ?? client?.id ?? ""),
  name: typeof client?.name === "string" ? client.name : "Unknown client",
  domain: typeof client?.domain === "string" ? client.domain : null,
  aliases: Array.isArray(client?.aliases) ? client.aliases : [],
  peopleIds: uniqueStrings(client?.peopleIds || []),
});

const loadRelatedClients = async (
  db: Db,
  workspaceId: string,
  context: ScopeContext,
  people: any[],
  limit: number
) => {
  if (context.scope.type === "client" && context.client) {
    return [serializeClient(context.client)];
  }
  const personIds = uniqueStrings(people.flatMap((person) => [person?.id, person?._id]));
  const domains = uniqueStrings(
    people.map((person) => {
      const email = typeof person?.email === "string" ? person.email : "";
      return email.includes("@") ? email.split("@").pop() : "";
    })
  );
  if (!personIds.length && !domains.length) return [];
  const clauses: Record<string, unknown>[] = [];
  if (personIds.length) clauses.push({ peopleIds: { $in: personIds } });
  if (domains.length) clauses.push({ domain: { $in: domains } });
  const clients = await db
    .collection("companies")
    .find({ workspaceId, $or: clauses } as any)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit)
    .toArray();
  return clients.map(serializeClient).filter((client) => client.id);
};

const hasIdentityMatch = (
  ids: unknown,
  emails: unknown,
  allowedIds: Set<string>,
  allowedEmails: Set<string>
) => {
  const evidenceIds = Array.isArray(ids) ? uniqueStrings(ids) : uniqueStrings([ids]);
  const evidenceEmails = (Array.isArray(emails)
    ? uniqueStrings(emails)
    : uniqueStrings([emails])
  ).map((email) => email.toLowerCase());
  return (
    evidenceIds.some((id) => allowedIds.has(id)) ||
    evidenceEmails.some((email) => allowedEmails.has(email))
  );
};

const hasEvidenceIdentityMatch = (
  evidence: { ids?: unknown; emails?: unknown; nameKey?: unknown },
  allowedIds: Set<string>,
  allowedEmails: Set<string>,
  allowedUniqueNameKeys: Set<string>
) => {
  const ids = Array.isArray(evidence.ids)
    ? uniqueStrings(evidence.ids)
    : uniqueStrings([evidence.ids]);
  const emails = (Array.isArray(evidence.emails)
    ? uniqueStrings(evidence.emails)
    : uniqueStrings([evidence.emails])
  ).map((email) => email.toLowerCase());
  if (ids.length || emails.length) {
    return (
      ids.some((id) => allowedIds.has(id)) ||
      emails.some((email) => allowedEmails.has(email))
    );
  }
  const nameKey =
    typeof evidence.nameKey === "string"
      ? normalizePersonNameKey(evidence.nameKey)
      : "";
  return Boolean(nameKey && allowedUniqueNameKeys.has(nameKey));
};

const filterScopedResult = (context: ScopeContext, result: any) => {
  if (context.scope.type === "workspace" || context.scope.type === "planner") {
    return result;
  }

  if (context.scope.type === "meeting" && context.meeting?.isHidden === true) {
    return {
      ...result,
      meetings: [],
      tasks: [],
      people: [],
      isEmpty: true,
    };
  }

  const identity = collectPeopleIdentity(context.relatedPeople);
  const allowedIds = new Set(identity.ids);
  const allowedEmails = new Set(identity.emails);
  const allowedUniqueNameKeys = new Set(
    uniqueFallbackNames(context.relatedPeople).map(normalizePersonNameKey)
  );
  const people = result.people.filter((person: any) =>
    hasIdentityMatch(
      [person?.id, person?._id],
      person?.email,
      allowedIds,
      allowedEmails
    )
  );

  if (context.scope.type === "meeting") {
    const meetingId = context.scope.meetingId;
    return {
      ...result,
      meetings: result.meetings.filter((meeting: any) => meeting.id === meetingId),
      tasks: result.tasks.filter(
        (task: any) =>
          task.sourceSessionId === meetingId ||
          task.sourceMeetingId === meetingId ||
          task.meetingId === meetingId
      ),
      people,
    };
  }

  return {
    ...result,
    meetings: result.meetings.filter((meeting: any) => {
      const attendeeIdentities = Array.isArray(meeting?.attendeeIdentities)
        ? meeting.attendeeIdentities
        : [
            {
              ids: meeting?.attendeeIds,
              emails: meeting?.attendeeEmails,
              nameKey: null,
            },
          ];
      return attendeeIdentities.some((attendee: any) =>
        hasEvidenceIdentityMatch(
          attendee,
          allowedIds,
          allowedEmails,
          allowedUniqueNameKeys
        )
      );
    }),
    tasks: result.tasks.filter((task: any) =>
      hasEvidenceIdentityMatch(
        {
          ids: task?.assigneeId,
          emails: task?.assigneeEmail,
          nameKey:
            typeof task?.assigneeName === "string"
              ? normalizePersonNameKey(task.assigneeName)
              : null,
        },
        allowedIds,
        allowedEmails,
        allowedUniqueNameKeys
      )
    ),
    people,
  };
};

const toIsoString = (value: unknown): string | null => {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const boundedText = (value: unknown, maxChars: number): string =>
  typeof value === "string" ? value.slice(0, maxChars).trim() : "";

const getMeetingTranscript = (meeting: any): string => {
  for (const value of [meeting?.originalTranscript, meeting?.transcript]) {
    const bounded = boundedText(value, MAX_DIRECT_TRANSCRIPT_SCAN_CHARS);
    if (bounded) return bounded;
  }
  if (!Array.isArray(meeting?.artifacts)) return "";
  for (const artifact of meeting.artifacts) {
    if (artifact?.type !== "transcript") continue;
    const bounded = boundedText(
      artifact?.processedText,
      MAX_DIRECT_TRANSCRIPT_SCAN_CHARS
    );
    if (bounded) return bounded;
  }
  return "";
};

/**
 * Meeting scope is already server-authorized by loadScopeContext. If the
 * ranked/indexed pass has no meeting hit, expose only that exact document as
 * bounded evidence rather than broadening retrieval to neighboring meetings.
 */
const buildAuthorizedMeetingEvidence = (
  context: ScopeContext,
  args: KnowledgeArgs
): RetrievedMeeting | null => {
  if (
    context.scope.type !== "meeting" ||
    !context.meeting ||
    context.meeting.isHidden === true
  ) {
    return null;
  }
  const meeting = context.meeting;
  const meetingDate = toIsoString(meeting.startTime);
  if (args.from || args.to) {
    if (!meetingDate) return null;
    const timestamp = new Date(meetingDate).getTime();
    if (args.from && timestamp < new Date(args.from).getTime()) return null;
    if (args.to && timestamp > new Date(args.to).getTime()) return null;
  }
  const transcript = getMeetingTranscript(meeting);
  const summary = boundedText(
    meeting.summary,
    MAX_DIRECT_MEETING_SUMMARY_CHARS
  );
  const title = boundedText(meeting.title, 300) || "Untitled meeting";
  const transcriptSnippets = extractTranscriptSnippets(
    transcript,
    tokenize(args.query)
  );
  if (!summary && !transcriptSnippets.length) return null;

  return {
    id: context.scope.meetingId,
    title,
    startTime: meetingDate,
    summarySnippet: summary || null,
    transcriptSnippets,
    score: 0,
  };
};

const addAuthorizedMeetingFallback = (
  context: ScopeContext,
  result: any,
  args: KnowledgeArgs
) => {
  if (context.scope.type !== "meeting" || result.meetings.length) return result;
  const meeting = buildAuthorizedMeetingEvidence(context, args);
  if (!meeting) return result;
  return {
    ...result,
    meetings: [meeting],
    isEmpty: false,
  };
};

const buildCitations = (result: any, clients: any[], limit: number) => {
  const citations: Array<Record<string, unknown>> = [];
  for (const meeting of result.meetings) {
    if (meeting.transcriptSnippets?.length) {
      for (const transcript of meeting.transcriptSnippets) {
        citations.push({
          sourceType: "transcript",
          sourceId: meeting.id,
          title: meeting.title,
          snippet: transcript.snippet,
          ...(transcript.timestamp ? { timestamp: transcript.timestamp } : {}),
        });
      }
    } else {
      citations.push({
        sourceType: "meeting",
        sourceId: meeting.id,
        title: meeting.title,
        snippet: meeting.summarySnippet || meeting.title,
      });
    }
  }
  for (const task of result.tasks) {
    const details = [
      `Status: ${task.status}`,
      task.assigneeName ? `Assignee: ${task.assigneeName}` : null,
      task.dueAt ? `Due: ${task.dueAt}` : null,
    ].filter(Boolean);
    citations.push({
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      snippet: details.join(" · "),
    });
  }
  for (const person of result.people) {
    citations.push({
      sourceType: "person",
      sourceId: person.id,
      title: person.name,
      snippet: person.email || `Person type: ${person.personType}`,
    });
  }
  for (const client of clients) {
    citations.push({
      sourceType: "client",
      sourceId: client.id,
      title: client.name,
      snippet: client.domain || client.name,
    });
  }
  const seen = new Set<string>();
  return citations
    .filter((citation) => {
      const key = `${citation.sourceType}:${citation.sourceId}:${citation.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(limit, limit * 4));
};

const executeKnowledgeSearch = async (
  db: Db,
  workspaceId: string,
  args: KnowledgeArgs
): Promise<McpToolResult> => {
  const memberships = await listActiveWorkspaceMembershipsForWorkspace(
    db,
    workspaceId
  );
  const memberUserIds = uniqueStrings(
    memberships.map((membership: any) => membership?.userId)
  );
  const userId = memberUserIds[0] || "";
  const requestedScope = toScope(args);
  const scope = await assertChatScopeAccess({
    db,
    userId,
    workspaceId,
    memberUserIds,
    scope: requestedScope,
  });
  const context = await loadScopeContext(db, workspaceId, memberUserIds, scope);
  const limit = args.limit || DEFAULT_KNOWLEDGE_LIMIT;
  const retrieved = await searchWorkspaceContext(
    db,
    { userId, workspaceId, memberUserIds },
    args.query,
    {
      maxMeetings: limit,
      maxTasks: limit,
      maxPeople: limit,
      from: args.from,
      to: args.to,
      plannerBias: scope.type === "planner",
      constraints: buildConstraints(context),
    }
  );
  const scopedResult = addAuthorizedMeetingFallback(
    context,
    filterScopedResult(context, retrieved),
    args
  );
  const clients = await loadRelatedClients(
    db,
    workspaceId,
    context,
    scopedResult.people,
    limit
  );
  const citations = buildCitations(scopedResult, clients, limit);
  const total =
    scopedResult.meetings.length +
    scopedResult.tasks.length +
    scopedResult.people.length +
    clients.length;

  return {
    toolName: "search_workspace_knowledge",
    summary: `Returned ${total} scoped knowledge item(s) with ${citations.length} citation(s).`,
    data: {
      meetings: scopedResult.meetings,
      tasks: scopedResult.tasks,
      people: scopedResult.people,
      clients,
      citations,
      isEmpty: total === 0,
    },
  };
};

export const getMcpKnowledgeToolDefinitions = (): McpToolDefinition[] => [
  {
    name: "search_workspace_knowledge",
    description:
      "Search workspace meetings, tasks, people, and clients with semantic grounding inside an explicit scope.",
    scope: "mcp:read",
    inputSchema: searchWorkspaceKnowledgeArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "scopeType"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS },
        scopeType: { type: "string", enum: [...SCOPE_TYPES] },
        scopeId: { type: "string", minLength: 1, maxLength: 200 },
        from: { type: "string", description: "Inclusive ISO date or date-time." },
        to: { type: "string", description: "Inclusive ISO date or date-time." },
        limit: {
          type: "number",
          minimum: 1,
          maximum: MAX_KNOWLEDGE_LIMIT,
        },
      },
    },
    handler: ({ db, workspaceId }, rawArgs) =>
      executeKnowledgeSearch(db, workspaceId, rawArgs as KnowledgeArgs),
  },
];
