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
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import type { ChatScope } from "@/types/general-chat";

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

const personRelationshipFilter = (people: any[]): Record<string, unknown> => {
  const ids = uniqueStrings(
    people.flatMap((person) => [person?._id, person?.id, person?.uid, person?.slackId])
  );
  const emails = uniqueStrings(people.map((person) => person?.email));
  const names = uniqueStrings(
    people.flatMap((person) => [person?.name, ...(person?.aliases || [])])
  );
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
    ...names.flatMap((name) => [
      { "assignee.name": name },
      { assigneeName: name },
    ]),
  ];
  return clauses.length ? { $or: clauses } : { _id: { $in: [] } };
};

const attendeeRelationshipFilter = (people: any[]): Record<string, unknown> => {
  const ids = uniqueStrings(
    people.flatMap((person) => [person?._id, person?.id, person?.uid, person?.slackId])
  );
  const emails = uniqueStrings(people.map((person) => person?.email));
  const names = uniqueStrings(
    people.flatMap((person) => [person?.name, ...(person?.aliases || [])])
  );
  const attendeeClauses: Record<string, unknown>[] = [
    ...ids.flatMap((id) => [{ id }, { uid: id }, { personId: id }]),
    ...emails.map((email) => ({ email })),
    ...names.map((name) => ({ name })),
  ];
  return attendeeClauses.length
    ? { attendees: { $elemMatch: { $or: attendeeClauses } } }
    : { _id: { $in: [] } };
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
    const relatedPeople = Array.isArray(meeting?.attendees) ? meeting.attendees : [];
    return { scope, meeting, relatedPeople };
  }
  if (scope.type === "person") {
    const person = await db.collection("people").findOne({
      $and: [identifierFilter(scope.personId), visibility],
    } as any);
    return { scope, person, relatedPeople: person ? [person] : [] };
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
    return { scope, client, relatedPeople };
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
        people: attendeeRelationshipFilter(context.relatedPeople),
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

const filterMeetingScope = (context: ScopeContext, result: any) => {
  if (context.scope.type !== "meeting") return result;
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
  const scopedResult = filterMeetingScope(context, retrieved);
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
