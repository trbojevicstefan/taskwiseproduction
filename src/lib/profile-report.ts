/**
 * Priority 9 — evidence gathering for one-click person/company reports.
 *
 * Shared by POST /api/people/[id]/report and POST /api/companies/[id]/report:
 * collects the subject's people, meetings (by attendee email/name, source
 * session, or company domain), tasks (open / overdue / recently completed),
 * and transcript mention snippets, then renders them as the same compact
 * labeled context blocks the general chat route uses (MEETING/TASK/PERSON
 * lines with ids right after the label) so the report flow can copy source
 * ids exactly and the route can filter LLM-cited sources against the
 * gathered id sets — the same anti-hallucination contract as /api/ai/chat.
 *
 * Pure Mongo reads; no LLM calls here. Never throws for missing/empty data —
 * an empty workspace yields `isEmpty: true` and the routes short-circuit to a
 * deterministic no-evidence report without calling the LLM.
 */

import {
  extractTranscriptSnippets,
  tokenize,
} from "@/lib/workspace-retrieval";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { GeneralChatSource } from "@/types/general-chat";
import type { ProfileReport, ProfileReportSubjectType } from "@/types/profile-report";

export type ProfileReportScope = {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
};

export type ProfileReportSubject = {
  type: ProfileReportSubjectType;
  name: string;
  /** Raw people docs (Mongo shape) belonging to the subject. */
  people: any[];
  /** Company email domain, when the subject is a company with one. */
  domain?: string | null;
};

export type ProfileReportEvidence = {
  contextBlocks: string;
  meetingIds: Set<string>;
  taskIds: Set<string>;
  personIds: Set<string>;
  isEmpty: boolean;
  counts: {
    meetings: number;
    openTasks: number;
    overdueTasks: number;
    completedTasks: number;
  };
};

const MAX_MEETINGS = 12;
const MAX_TRANSCRIPT_MEETINGS = 6;
const MAX_SNIPPETS_PER_MEETING = 2;
const MAX_OPEN_TASKS = 25;
const MAX_COMPLETED_TASKS = 15;
const SUMMARY_SNIPPET_CHARS = 280;

const singleLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Same fallback scoping semantics the people/meeting routes use: docs stamped
 * with the workspace id plus legacy docs (no workspaceId) owned by a member.
 */
const buildScopeFilter = (scope: ProfileReportScope): Record<string, any> => {
  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (scope.workspaceId) {
    return {
      $or: [
        { workspaceId: scope.workspaceId },
        { workspaceId: { $exists: false }, userId: { $in: memberUserIds } },
      ],
    };
  }
  return { userId: { $in: memberUserIds } };
};

type SubjectIdentity = {
  personIds: string[];
  emails: string[];
  names: string[];
  nameKeys: string[];
  sessionIds: string[];
};

const collectSubjectIdentity = (subject: ProfileReportSubject): SubjectIdentity => {
  const personIds: string[] = [];
  const emails = new Set<string>();
  const names = new Set<string>();
  const nameKeys = new Set<string>();
  const sessionIds = new Set<string>();

  for (const person of subject.people) {
    const id = String(person?._id ?? person?.id ?? "").trim();
    if (id) personIds.push(id);
    const email =
      typeof person?.email === "string" ? person.email.trim().toLowerCase() : "";
    if (email) emails.add(email);
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (name) {
      names.add(name);
      const key = normalizePersonNameKey(name);
      if (key) nameKeys.add(key);
    }
    if (Array.isArray(person?.aliases)) {
      for (const alias of person.aliases) {
        if (typeof alias !== "string" || !alias.trim()) continue;
        names.add(alias.trim());
        const key = normalizePersonNameKey(alias);
        if (key) nameKeys.add(key);
      }
    }
    if (Array.isArray(person?.sourceSessionIds)) {
      for (const sessionId of person.sourceSessionIds) {
        if (sessionId) sessionIds.add(String(sessionId));
      }
    }
  }

  return {
    personIds,
    emails: Array.from(emails),
    names: Array.from(names),
    nameKeys: Array.from(nameKeys),
    sessionIds: Array.from(sessionIds),
  };
};

const buildMeetingMatch = (
  identity: SubjectIdentity,
  domain: string | null | undefined
): Record<string, any> | null => {
  const clauses: Record<string, any>[] = [];
  if (identity.sessionIds.length) {
    clauses.push({ _id: { $in: identity.sessionIds } });
  }
  if (identity.emails.length) {
    clauses.push({ "attendees.email": { $in: identity.emails } });
    clauses.push({ organizerEmail: { $in: identity.emails } });
  }
  if (identity.names.length) {
    clauses.push({ "attendees.name": { $in: identity.names } });
  }
  const normalizedDomain =
    typeof domain === "string" ? domain.trim().toLowerCase() : "";
  if (normalizedDomain) {
    const domainRegex = new RegExp(`@${escapeRegex(normalizedDomain)}$`, "i");
    clauses.push({ "attendees.email": domainRegex });
    clauses.push({ organizerEmail: domainRegex });
  }
  return clauses.length ? { $or: clauses } : null;
};

const buildTaskAssigneeMatch = (
  identity: SubjectIdentity
): Record<string, any> | null => {
  const clauses: Record<string, any>[] = [];
  if (identity.personIds.length) {
    clauses.push({ "assignee.uid": { $in: identity.personIds } });
  }
  if (identity.emails.length) {
    clauses.push({ "assignee.email": { $in: identity.emails } });
  }
  const nameMatchers = Array.from(
    new Set([...identity.nameKeys, ...identity.names])
  );
  if (nameMatchers.length) {
    clauses.push({ assigneeNameKey: { $in: nameMatchers } });
    clauses.push({ assigneeName: { $in: nameMatchers } });
    clauses.push({ "assignee.name": { $in: nameMatchers } });
  }
  return clauses.length ? { $or: clauses } : null;
};

const normalizeStatus = (status: unknown): string => {
  const raw = typeof status === "string" ? status.toLowerCase().trim() : "";
  if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
    return "inprogress";
  }
  if (raw === "done" || raw === "completed" || raw === "complete") return "done";
  if (raw === "recurring") return "recurring";
  return raw || "todo";
};

/**
 * Gather the subject's evidence and render it as labeled context blocks.
 * Returns id sets used by the routes to filter LLM-cited sources.
 */
export const gatherProfileReportEvidence = async (
  db: any,
  scope: ProfileReportScope,
  subject: ProfileReportSubject
): Promise<ProfileReportEvidence> => {
  const scopeFilter = buildScopeFilter(scope);
  const identity = collectSubjectIdentity(subject);
  const now = new Date();

  // --- Meetings -----------------------------------------------------------
  const meetingMatch = buildMeetingMatch(identity, subject.domain);
  let meetings: any[] = [];
  if (meetingMatch) {
    meetings = await db
      .collection("meetings")
      .find(
        { $and: [scopeFilter, { isHidden: { $ne: true } }, meetingMatch] },
        {
          projection: {
            _id: 1,
            title: 1,
            summary: 1,
            startTime: 1,
            lastActivityAt: 1,
          },
        }
      )
      .sort({ startTime: -1, lastActivityAt: -1, _id: -1 })
      .limit(MAX_MEETINGS)
      .toArray();
  }

  // Transcript mention snippets — only for the most recent few meetings.
  const mentionQuery = tokenize(
    [subject.name, ...identity.names].join(" ")
  );
  const transcriptTargets = meetings
    .slice(0, MAX_TRANSCRIPT_MEETINGS)
    .map((meeting: any) => String(meeting._id));
  const snippetsByMeetingId = new Map<string, ReturnType<typeof extractTranscriptSnippets>>();
  if (transcriptTargets.length && (mentionQuery.tokens.length || mentionQuery.phrases.length)) {
    const transcriptDocs: any[] = await db
      .collection("meetings")
      .find(
        { $and: [scopeFilter, { _id: { $in: transcriptTargets } }] },
        { projection: { _id: 1, originalTranscript: 1 } }
      )
      .toArray();
    for (const doc of transcriptDocs) {
      const snippets = extractTranscriptSnippets(
        typeof doc?.originalTranscript === "string" ? doc.originalTranscript : "",
        mentionQuery,
        MAX_SNIPPETS_PER_MEETING
      );
      if (snippets.length) {
        snippetsByMeetingId.set(String(doc._id), snippets);
      }
    }
  }

  // --- Tasks ---------------------------------------------------------------
  const taskMatch = buildTaskAssigneeMatch(identity);
  let tasks: any[] = [];
  if (taskMatch) {
    tasks = await db
      .collection("tasks")
      .find(
        { $and: [scopeFilter, { taskState: { $ne: "archived" } }, taskMatch] },
        {
          projection: {
            _id: 1,
            title: 1,
            status: 1,
            dueAt: 1,
            assigneeName: 1,
            lastUpdated: 1,
          },
        }
      )
      .sort({ lastUpdated: -1, _id: -1 })
      .limit(200)
      .toArray();
  }

  const openTasks: any[] = [];
  const completedTasks: any[] = [];
  let overdueCount = 0;
  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    if (status === "done") {
      if (completedTasks.length < MAX_COMPLETED_TASKS) completedTasks.push(task);
      continue;
    }
    const dueAt = toDate(task?.dueAt);
    const overdue = Boolean(dueAt) && dueAt!.getTime() < now.getTime();
    if (overdue) overdueCount += 1;
    if (openTasks.length < MAX_OPEN_TASKS) {
      openTasks.push({ ...task, __overdue: overdue });
    }
  }
  // Overdue tasks first so they survive the cap and lead the context.
  openTasks.sort((a, b) => Number(b.__overdue) - Number(a.__overdue));

  // --- Render context blocks ------------------------------------------------
  const lines: string[] = [];

  for (const person of subject.people) {
    const id = String(person?._id ?? person?.id ?? "").trim();
    if (!id) continue;
    const parts = [
      `PERSON ${id}`,
      singleLine(String(person?.name ?? "Unknown person")),
      String(person?.personType ?? "unknown"),
    ];
    if (person?.email) parts.push(singleLine(String(person.email)));
    if (person?.title) parts.push(singleLine(String(person.title)));
    lines.push(parts.join(" | "));
  }

  for (const meeting of meetings) {
    const id = String(meeting._id);
    const startTime = toDate(meeting?.startTime);
    const date = startTime ? startTime.toISOString().slice(0, 10) : "date unknown";
    const title =
      typeof meeting?.title === "string" && meeting.title.trim()
        ? singleLine(meeting.title)
        : "Untitled meeting";
    lines.push(`MEETING ${id} | ${title} | ${date}`);
    if (typeof meeting?.summary === "string" && meeting.summary.trim()) {
      lines.push(
        `  SUMMARY: ${singleLine(meeting.summary).slice(0, SUMMARY_SNIPPET_CHARS)}`
      );
    }
    const snippets = snippetsByMeetingId.get(id) || [];
    for (const snippet of snippets) {
      const stamp = snippet.timestamp ? `[${snippet.timestamp}] ` : "";
      lines.push(`  ${stamp}${singleLine(snippet.snippet)}`);
    }
  }

  const renderTaskLine = (task: any, overdue: boolean) => {
    const dueAt = toDate(task?.dueAt);
    const parts = [
      `TASK ${String(task._id)}`,
      singleLine(String(task?.title ?? "Untitled task")),
      `status=${normalizeStatus(task?.status)}`,
      `due=${dueAt ? dueAt.toISOString().slice(0, 10) : "none"}`,
    ];
    if (task?.assigneeName) {
      parts.push(`assignee=${singleLine(String(task.assigneeName))}`);
    }
    if (overdue) parts.push("OVERDUE");
    return parts.join(" | ");
  };

  for (const task of openTasks) {
    lines.push(renderTaskLine(task, Boolean(task.__overdue)));
  }
  for (const task of completedTasks) {
    lines.push(renderTaskLine(task, false));
  }

  const meetingIds = new Set(meetings.map((meeting: any) => String(meeting._id)));
  const taskIds = new Set(
    [...openTasks, ...completedTasks].map((task: any) => String(task._id))
  );
  const personIds = new Set(identity.personIds);

  return {
    contextBlocks: lines.join("\n"),
    meetingIds,
    taskIds,
    personIds,
    isEmpty: meetingIds.size === 0 && taskIds.size === 0,
    counts: {
      meetings: meetingIds.size,
      openTasks: openTasks.length,
      overdueTasks: overdueCount,
      completedTasks: completedTasks.length,
    },
  };
};

const UNVERIFIED_SOURCES_CAVEAT =
  "Note: I could not verify the cited sources against your workspace data, so treat this report with caution.";

/**
 * Anti-hallucination filter (same contract as /api/ai/chat): keep only
 * sources whose sourceId exists in the gathered evidence. Transcript sources
 * must reference a gathered meeting id. When the model cited sources but none
 * survive, confidence degrades to low and the summary gains a caveat.
 */
export const filterReportSources = (
  report: ProfileReport,
  evidence: Pick<ProfileReportEvidence, "meetingIds" | "taskIds" | "personIds">
): ProfileReport => {
  const sources = report.sources.filter((source: GeneralChatSource) => {
    switch (source.sourceType) {
      case "meeting":
      case "transcript":
        return evidence.meetingIds.has(source.sourceId);
      case "task":
        return evidence.taskIds.has(source.sourceId);
      case "person":
      case "client":
        return evidence.personIds.has(source.sourceId);
      default:
        return false;
    }
  });

  if (report.sources.length > 0 && sources.length === 0) {
    return {
      ...report,
      confidence: "low",
      executiveSummary: `${report.executiveSummary.trim()} ${UNVERIFIED_SOURCES_CAVEAT}`,
      sources,
    };
  }
  return { ...report, sources };
};

/**
 * Deterministic report used when a subject has no meetings and no tasks —
 * returned by the routes without any LLM call.
 */
export const buildNoEvidenceReport = (
  subjectType: ProfileReportSubjectType,
  subjectName: string
): ProfileReport => ({
  subjectType,
  subjectName,
  generatedAt: new Date().toISOString(),
  executiveSummary: `There is no recorded activity for ${subjectName} yet — no meetings, transcripts, or tasks reference ${
    subjectType === "company" ? "this company or its people" : "this person"
  }. Sync your latest meetings or assign tasks to build a history, then generate the report again.`,
  openCommitments: [],
  overdueOrRisk: [],
  completedWork: [],
  recentMeetings: [],
  keyDecisions: [],
  suggestedNextAction: `Record a meeting or assign a task involving ${subjectName}, then regenerate this report.`,
  confidence: "low",
  sources: [],
});
