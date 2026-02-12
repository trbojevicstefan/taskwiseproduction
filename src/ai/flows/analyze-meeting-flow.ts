// src/ai/flows/analyze-meeting-flow.ts
'use server';
/**
 * @fileOverview Meeting analysis pipeline:
 * 1) Classify meeting type (router)
 * 2) Extract action items with a specialist prompt
 * 3) Audit/verify tasks against the transcript
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import {
  AnalyzeMeetingInputSchema,
  AnalyzeMeetingOutputSchema,
  type AnalyzeMeetingInput,
  type AnalyzeMeetingOutput,
  type TaskType,
} from "./schemas";
import { extractJsonValue } from "./parse-json-output";
import {
  annotateTasksWithProvider,
  applyTaskMetadata,
  normalizeAiTasks,
  normalizeTitleKey,
  isPlaceholderTitle,
} from "@/lib/ai-utils";
import {
  attachEvidenceToTasks,
  extractTranscriptAttendees,
  extractTranscriptEmails,
  extractTranscriptMentionNames,
  extractTranscriptTasks,
  normalizePersonNameKey,
  assignAssigneesFromTranscript,
  sanitizeTaskAssignees,
  sanitizeTaskDescriptions,
} from "@/lib/transcript-utils";
import { rewriteTaskTitles } from "./rewrite-task-titles";
import { runPromptWithFallback } from "@/ai/prompt-fallback";

const MeetingTypeSchema = z.enum([
  "SALES_DISCOVERY",
  "ENGINEERING_SCRUM",
  "GENERAL_INTERNAL",
]);
type MeetingType = z.infer<typeof MeetingTypeSchema>;

const RouterInputSchema = z.object({
  transcript: z.string(),
  currentDate: z.string(),
});

const SpecialistInputSchema = z.object({
  transcript: z.string(),
  currentDate: z.string(),
});

const OPEN_ITEMS_TRIGGER_REGEX =
  /task\s*-?\s*wise\s+open\s+items?|open\s+items|running\s+items/i;

const AuditorInputSchema = z.object({
  transcript: z.string(),
  currentDate: z.string(),
  actionItemsJson: z.string(),
});

const routerPrompt = ai.definePrompt({
  name: "meetingRouterPrompt",
  input: { schema: RouterInputSchema },
  output: { format: "json" },
  prompt: `
You are a Meeting Taxonomy Classifier. Your job is to analyze the beginning of a conversation and categorize it into one of three buckets.

Current Date: {{currentDate}}

Partial Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Classification Rules:
1) SALES_DISCOVERY:
 - Keywords: "budget", "pricing", "contract", "demo", "pain points", "competitors".
 - Context: One party asking qualifying questions to another party.

2) ENGINEERING_SCRUM:
 - Keywords: "PR", "ticket", "blocker", "deploy", "branch", "bug", "sprint".
 - Context: Status updates, technical problem solving.

3) GENERAL_INTERNAL:
 - Keywords: "marketing", "Q3 plan", "hiring", "operations", "sync".
 - Context: General strategy or operational planning.

Output JSON only:
{
  "meeting_type": "SALES_DISCOVERY" | "ENGINEERING_SCRUM" | "GENERAL_INTERNAL",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why."
}
`,
});

const salesPrompt = ai.definePrompt({
  name: "meetingSalesSpecialistPrompt",
  input: { schema: SpecialistInputSchema },
  output: { format: "json" },
  prompt: `
You are a top-tier Sales Ops Analyst. Your goal is to extract concrete next steps that move a deal forward. You have a low tolerance for fluff.

Current Date: {{currentDate}}. Interpret relative dates based on this.

Extraction Framework (SPICED):
- Situation: current tech stack
- Pain: explicit problems
- Impact: cost of pain
- Critical Event: deadlines mentioned
- Decision: who signs the check

Action Item Rules:
- MUST extract explicit promises to send info, schedule meetings, introductions, or deliverables.
- IGNORE vague suggestions or hypotheticals.
- If assignee is unclear, set assigneeName to "Unassigned".

Include a brief summary in 2-3 sentences.

Full Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Output JSON only:
{
  "title": "Short meeting title",
  "deal_intelligence": {
    "pain_points": ["string"],
    "economic_buyer": "Name or Unknown",
    "timeline": "Date or Unknown"
  },
  "summary": "string",
  "action_items": [
    {
      "title": "Verb + object",
      "description": "Concise description in your own words",
      "assigneeName": "Name or Unassigned",
      "priority": "high|medium|low",
      "dueAt": "YYYY-MM-DD or null",
      "source_quote": "short supporting snippet",
      "source_speaker": "speaker name if known",
      "source_timestamp": "timestamp if known"
    }
  ]
}
`,
});

const engineeringPrompt = ai.definePrompt({
  name: "meetingEngineeringSpecialistPrompt",
  input: { schema: SpecialistInputSchema },
  output: { format: "json" },
  prompt: `
You are a Technical Project Manager (TPM). Your goal is to convert conversation into Jira-ready tickets.

Current Date: {{currentDate}}. Interpret relative dates based on this.

Rules:
1) Identify blockers: if someone says "I'm stuck on...", mark as high priority.
2) Convert commitments into tickets. Ignore speculative discussions.
3) If assignee is unclear, set assigneeName to "Unassigned".

Include a brief summary in 2-3 sentences.

Full Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Output JSON only:
{
  "title": "Short meeting title",
  "sprint_health": "ON_TRACK" | "AT_RISK",
  "blockers": ["string"],
  "summary": "string",
  "action_items": [
    {
      "title": "Verb + object",
      "description": "Concise description in your own words",
      "assigneeName": "Name or Unassigned",
      "priority": "high|medium|low",
      "dueAt": "YYYY-MM-DD or null",
      "source_quote": "short supporting snippet",
      "source_speaker": "speaker name if known",
      "source_timestamp": "timestamp if known"
    }
  ]
}
`,
});

const generalPrompt = ai.definePrompt({
  name: "meetingGeneralSpecialistPrompt",
  input: { schema: SpecialistInputSchema },
  output: { format: "json" },
  prompt: `
You are an Executive Assistant. Your goal is to ensure no commitment is forgotten.

Current Date: {{currentDate}}. Interpret relative dates based on this.

Definition of Action:
- "I will..." commitments
- "Can you please..." followed by agreement
- "Let's make sure to..." assigned to owner

Do NOT turn ideas into actions.
If assignee is unclear, set assigneeName to "Unassigned".

Provide a 3-bullet executive summary.

Full Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Output JSON only:
{
  "title": "Short meeting title",
  "summary": "string",
  "action_items": [
    {
      "title": "Verb + object",
      "description": "Concise description in your own words",
      "assigneeName": "Name or Unassigned",
      "priority": "high|medium|low",
      "dueAt": "YYYY-MM-DD or null",
      "source_quote": "short supporting snippet",
      "source_speaker": "speaker name if known",
      "source_timestamp": "timestamp if known"
    }
  ]
}
`,
});

const openItemsPrompt = ai.definePrompt({
  name: "meetingOpenItemsReviewPrompt",
  input: { schema: SpecialistInputSchema },
  output: { format: "json" },
  prompt: `
You are a Task Review Analyst. This meeting is reviewing "open items" and status updates.

Current Date: {{currentDate}}. Interpret relative dates based on this.

Rules:
- Extract every task explicitly mentioned, even if phrased as a status check.
- Set status to "done" only when the speaker explicitly confirms completion (done/completed/finished/resolved).
- If a task is not done, set status to "todo".
- If a task is postponed or rescheduled, keep status "todo" and capture the new due date.
- For new tasks introduced during the review, set status "todo".
- If assignee is unclear, set assigneeName to "Unassigned".

Provide a 2-3 sentence summary focused on progress and blockers.

Full Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Output JSON only:
{
  "title": "Short meeting title",
  "summary": "string",
  "action_items": [
    {
      "title": "Verb + object or clear task noun",
      "description": "Concise description in your own words",
      "assigneeName": "Name or Unassigned",
      "priority": "high|medium|low",
      "dueAt": "YYYY-MM-DD or null",
      "status": "done|todo|inprogress|recurring",
      "source_quote": "short supporting snippet",
      "source_speaker": "speaker name if known",
      "source_timestamp": "timestamp if known"
    }
  ]
}
`,
});

const auditorPrompt = ai.definePrompt({
  name: "meetingActionItemAuditorPrompt",
  input: { schema: AuditorInputSchema },
  output: { format: "json" },
  prompt: `
You are a Forensic Auditor. Validate action items against the transcript and remove hallucinations.

Current Date: {{currentDate}}. Interpret relative dates based on this.

Rules:
- Reject jokes, questions, or speculative items.
- If multiple people agree, assign to the last person who explicitly commits. Otherwise, set assigneeName to "Unassigned".
- If conditional ("if I have time"), downgrade priority to low.

Raw Transcript:
\`\`\`
{{{transcript}}}
\`\`\`

Proposed Action Items (JSON):
\`\`\`
{{{actionItemsJson}}}
\`\`\`

Output JSON only:
{
  "action_items": [
    {
      "title": "Verb + object",
      "description": "Concise description in your own words",
      "assigneeName": "Name or Unassigned",
      "priority": "high|medium|low",
      "dueAt": "YYYY-MM-DD or null",
      "status": "done|todo|inprogress|recurring",
      "source_quote": "short supporting snippet",
      "source_speaker": "speaker name if known",
      "source_timestamp": "timestamp if known"
    }
  ]
}
`,
});

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toTranscriptPreview = (transcript: string, wordLimit = 2000) => {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) return transcript;
  return words.slice(0, wordLimit).join(" ");
};

const ROUTER_KEYWORDS: Record<MeetingType, string[]> = {
  SALES_DISCOVERY: [
    "budget",
    "pricing",
    "contract",
    "demo",
    "pain point",
    "competitor",
    "procurement",
    "security review",
    "renewal",
  ],
  ENGINEERING_SCRUM: [
    "pr",
    "pull request",
    "ticket",
    "blocker",
    "deploy",
    "branch",
    "bug",
    "sprint",
    "standup",
    "retro",
  ],
  GENERAL_INTERNAL: [
    "hiring",
    "operations",
    "roadmap",
    "planning",
    "campaign",
    "q1",
    "q2",
    "q3",
    "q4",
    "okrs",
  ],
};

const inferMeetingType = (
  transcript: string
): { type: MeetingType; confidence: number; reasoning: string; usedHeuristic: boolean } => {
  const normalized = transcript.toLowerCase();
  const scoreType = (type: MeetingType) =>
    ROUTER_KEYWORDS[type].reduce((score, keyword) => {
      const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const matches = normalized.match(pattern);
      return score + (matches?.length || 0);
    }, 0);

  const meetingTypes: MeetingType[] = [
    "SALES_DISCOVERY",
    "ENGINEERING_SCRUM",
    "GENERAL_INTERNAL",
  ];
  const scores = meetingTypes
    .map((type) => ({ type, score: scoreType(type) }))
    .sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];
  if (!top || top.score <= 0) {
    return {
      type: "GENERAL_INTERNAL",
      confidence: 0,
      reasoning: "Heuristic router found no strong keyword signals.",
      usedHeuristic: false,
    };
  }
  const margin = Math.max(0, top.score - (second?.score || 0));
  const confidence = Math.min(0.95, 0.58 + margin * 0.08 + Math.min(0.18, top.score * 0.03));
  return {
    type: top.type,
    confidence,
    reasoning: `Heuristic router matched ${top.score} ${top.type} keyword signals.`,
    usedHeuristic: confidence >= 0.78,
  };
};

const buildActionItems = (items: unknown[]): TaskType[] => {
  const normalizeStatus = (value: string | undefined): TaskType["status"] | undefined => {
    if (!value) return undefined;
    const lowered = value.toLowerCase();
    if (["done", "complete", "completed", "finished", "resolved"].some((word) => lowered.includes(word))) {
      return "done";
    }
    if (["in progress", "in-progress", "progress", "working"].some((word) => lowered.includes(word))) {
      return "inprogress";
    }
    if (["recurring", "repeat"].some((word) => lowered.includes(word))) {
      return "recurring";
    }
    if (["todo", "to do", "pending", "not done", "postpone", "delayed"].some((word) => lowered.includes(word))) {
      return "todo";
    }
    return undefined;
  };

  const mapped = items
    .map((item) => {
      const obj = getObject(item);
      if (!obj) return null;
      const title =
        getString(obj.title) ||
        getString(obj.task) ||
        getString(obj.action);
      if (!title) return null;
      const description = getString(obj.description);
      const assigneeName = getString(obj.assigneeName) || getString(obj.assignee);
      const dueAt = getString(obj.dueAt);
      const priority = getString(obj.priority);
      const status = normalizeStatus(getString(obj.status) || getString(obj.state));
      const sourceQuote = getString(obj.source_quote) || getString(obj.sourceQuote);
      const sourceSpeaker = getString(obj.source_speaker) || getString(obj.sourceSpeaker);
      const sourceTimestamp = getString(obj.source_timestamp) || getString(obj.sourceTimestamp);
      const sourceEvidence =
        sourceQuote || sourceSpeaker || sourceTimestamp
          ? [
              {
                snippet: sourceQuote || title,
                speaker: sourceSpeaker,
                timestamp: sourceTimestamp,
              },
            ]
          : undefined;

      return {
        title,
        description,
        assigneeName,
        dueAt,
        priority: priority as TaskType["priority"],
        status,
        sourceEvidence,
      };
    })
    .filter(Boolean);

  return normalizeAiTasks(mapped, "Meeting action");
};

const finalizeTasks = (tasks: TaskType[]) => {
  const ACTION_VERBS = [
    "send",
    "share",
    "schedule",
    "book",
    "draft",
    "prepare",
    "review",
    "finalize",
    "create",
    "build",
    "update",
    "deliver",
    "launch",
    "design",
    "implement",
    "test",
    "deploy",
    "investigate",
    "research",
    "confirm",
    "collect",
    "analyze",
    "follow",
    "align",
    "decide",
    "approve",
    "provide",
    "fix",
    "resolve",
    "set",
    "verify",
    "coordinate",
    "check",
    "sync",
    "log",
  ];

  const isActionTitle = (task: TaskType) => {
    const title = task.title;
    const normalized = title.trim().toLowerCase();
    if (isPlaceholderTitle(normalized)) return false;
    if (task.status && task.status !== "todo") return true;
    if (task.dueAt) return true;
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    return ACTION_VERBS.includes(words[0]);
  };

  const seen = new Set<string>();
  const filtered: TaskType[] = [];
  const maxTasks = 20;
  for (const task of tasks) {
    if (!task.title || !isActionTitle(task)) continue;
    const key = normalizeTitleKey(task.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    filtered.push(task);
    if (filtered.length >= maxTasks) break;
  }
  if (filtered.length) return filtered;

  const loose: TaskType[] = [];
  for (const task of tasks) {
    const title = task.title?.trim();
    if (!title || isPlaceholderTitle(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    const words = title.split(/\s+/).filter(Boolean);
    const hasSignal = Boolean(task.dueAt) || (task.status && task.status !== "todo");
    if (!hasSignal && words.length < 3) continue;
    seen.add(key);
    loose.push(task);
    if (loose.length >= maxTasks) break;
  }
  return loose;
};

const applyCompletionReviewFlags = (tasks: TaskType[]): TaskType[] => {
  const apply = (items: TaskType[]): TaskType[] =>
    items.map((task) => {
      const nextSubtasks = task.subtasks ? apply(task.subtasks) : task.subtasks;
      if (task.status === "done") {
        return {
          ...task,
          completionSuggested: task.completionSuggested ?? true,
          completionEvidence: task.completionEvidence ?? task.sourceEvidence,
          subtasks: nextSubtasks,
        };
      }
      return { ...task, subtasks: nextSubtasks };
    });
  return apply(tasks);
};

const analyzeMeetingFlow = ai.defineFlow(
  {
    name: "analyzeMeetingFlow",
    inputSchema: AnalyzeMeetingInputSchema,
    outputSchema: AnalyzeMeetingOutputSchema,
  },
  async (input: AnalyzeMeetingInput) => {
    const transcriptText = getString(input.transcript) || "";
    const requestedDetailLevel = input.requestedDetailLevel || "medium";
    const currentDate = new Date().toISOString().slice(0, 10);
    const openItemsTrigger = OPEN_ITEMS_TRIGGER_REGEX.test(transcriptText);
    let routerProvider: string | undefined;
    let confidence: number | undefined;
    let reasoning: string | undefined;
    let meetingType: MeetingType = "GENERAL_INTERNAL";

    if (openItemsTrigger) {
      meetingType = "GENERAL_INTERNAL";
      confidence = 0.95;
      reasoning = "Detected open-items review pattern; bypassed router.";
    } else {
      const routerPreview = toTranscriptPreview(transcriptText, 2000);
      const heuristicRoute = inferMeetingType(routerPreview);
      meetingType = heuristicRoute.type;
      confidence = heuristicRoute.confidence;
      reasoning = heuristicRoute.reasoning;

      if (!heuristicRoute.usedHeuristic) {
        const routerInput = {
          transcript: routerPreview,
          currentDate,
        };
        const { output: routerOutput, text: routerText, provider } =
          await runPromptWithFallback(routerPrompt, routerInput, undefined, {
            endpoint: "analyzeMeeting.router",
          });
        routerProvider = provider;
        const routerRaw = extractJsonValue(routerOutput, routerText);
        const routerObj = getObject(routerRaw) || {};
        const rawType = getString(routerObj.meeting_type) as MeetingType | undefined;
        const routerConfidence = getNumber(routerObj.confidence);
        const routerReasoning = getString(routerObj.reasoning);
        if (rawType && MeetingTypeSchema.safeParse(rawType).success) {
          meetingType = rawType;
        }
        confidence = routerConfidence ?? confidence;
        reasoning = routerReasoning || reasoning;
      }
    }

    if (confidence !== undefined && confidence < 0.7) {
      meetingType = "GENERAL_INTERNAL";
    }

    const specialistInput = {
      transcript: transcriptText,
      currentDate,
    };

    let specialistRaw: Record<string, unknown> = {};
    let specialistProvider: string | undefined;
    let actionItems: TaskType[] = [];
    let meetingSummary: string | undefined;
    let meetingMetadata: AnalyzeMeetingOutput["meetingMetadata"] = {
      type: meetingType,
      confidence: confidence ?? 0.5,
      reasoning,
    };

    const runSpecialist = async (prompt: typeof salesPrompt) => {
      const { output, text, provider } = await runPromptWithFallback(
        prompt,
        specialistInput,
        undefined,
        {
          endpoint: "analyzeMeeting.specialist",
        }
      );
      specialistProvider = provider;
      const raw = extractJsonValue(output, text);
      return (getObject(raw) || {}) as Record<string, unknown>;
    };

    if (openItemsTrigger) {
      specialistRaw = await runSpecialist(openItemsPrompt);
      actionItems = buildActionItems(getArray(specialistRaw.action_items));
      meetingSummary = getString(specialistRaw.summary);
    } else if (meetingType === "SALES_DISCOVERY") {
      specialistRaw = await runSpecialist(salesPrompt);
      actionItems = buildActionItems(getArray(specialistRaw.action_items));
      const dealIntelligence = getObject(specialistRaw.deal_intelligence);
      meetingMetadata = {
        ...meetingMetadata,
        dealIntelligence: dealIntelligence
          ? {
              painPoints: getArray(dealIntelligence.pain_points)
                .map((item) => getString(item))
                .filter(Boolean) as string[],
              economicBuyer: getString(dealIntelligence.economic_buyer),
              timeline: getString(dealIntelligence.timeline),
            }
          : undefined,
      };
      meetingSummary = getString(specialistRaw.summary);
    } else if (meetingType === "ENGINEERING_SCRUM") {
      specialistRaw = await runSpecialist(engineeringPrompt);
      actionItems = buildActionItems(getArray(specialistRaw.action_items));
      meetingMetadata = {
        ...meetingMetadata,
        sprintHealth: getString(specialistRaw.sprint_health) as
          | "ON_TRACK"
          | "AT_RISK"
          | undefined,
        blockers: getArray(specialistRaw.blockers)
          .map((item) => getString(item))
          .filter(Boolean) as string[],
      };
      meetingSummary = getString(specialistRaw.summary);
    } else {
      specialistRaw = await runSpecialist(generalPrompt);
      actionItems = buildActionItems(getArray(specialistRaw.action_items));
      meetingSummary = getString(specialistRaw.summary);
    }

    if (!actionItems.length) {
      actionItems = extractTranscriptTasks(transcriptText);
    }

    let auditorProvider: string | undefined;
    let auditedTasks = actionItems;
    const shouldRunAuditor =
      !openItemsTrigger && (confidence === undefined || confidence < 0.78);
    if (shouldRunAuditor) {
      const actionItemsJson = JSON.stringify(actionItems);
      const { output: auditOutput, text: auditText, provider } =
        await runPromptWithFallback(
          auditorPrompt,
          {
            transcript: transcriptText,
            currentDate,
            actionItemsJson,
          },
          undefined,
          {
            endpoint: "analyzeMeeting.auditor",
          }
        );
      auditorProvider = provider;
      const auditRaw = extractJsonValue(auditOutput, auditText);
      const auditObj = getObject(auditRaw) || {};
      const auditedItems = buildActionItems(getArray(auditObj.action_items));
      auditedTasks = auditedItems.length ? auditedItems : actionItems;
    }

    const rawTasks = auditedTasks.length ? auditedTasks : actionItems;
    const lightTasks = finalizeTasks(rawTasks);
    const lightWithEvidence = applyCompletionReviewFlags(
      attachEvidenceToTasks(lightTasks, transcriptText)
    );

    const rewriteTasksSafely = async (tasks: TaskType[]) => {
      try {
        return await rewriteTaskTitles(tasks, transcriptText);
      } catch (error) {
        console.error("Failed to rewrite meeting task titles:", error);
        return tasks;
      }
    };

    const rewrittenLight = await rewriteTasksSafely(lightWithEvidence);
    const transcriptAttendees = extractTranscriptAttendees(transcriptText);
    const transcriptEmails = new Set(extractTranscriptEmails(transcriptText));
    const transcriptMentionNames = extractTranscriptMentionNames(
      transcriptText,
      transcriptAttendees.map((person) => person.name)
    );
    const normalizeName = (name: string): string => normalizePersonNameKey(name);
    const transcriptSpeakerNameSet = new Set(
      transcriptAttendees.map((person) => normalizeName(person.name)).filter(Boolean)
    );
    const hasTranscriptSpeakers = transcriptSpeakerNameSet.size > 0;
    const transcriptLower = transcriptText.toLowerCase();
    const nameAppearsInTranscript = (name: string) =>
      Boolean(name && transcriptLower.includes(name.toLowerCase()));

    const transcriptMentionNameSet = new Set(
      transcriptMentionNames.map((name) => normalizeName(name)).filter(Boolean)
    );
    const aiMentionNameSet = new Set(
      getArray(specialistRaw.mentionedPeople)
        .map((person) => {
          const obj = getObject(person);
          return obj ? normalizeName(getString(obj.name) || "") : "";
        })
        .filter(Boolean)
    );
    const validMentionNameSet = transcriptMentionNameSet.size
      ? transcriptMentionNameSet
      : new Set(
          Array.from(aiMentionNameSet).filter((name) => name && transcriptLower.includes(name))
        );
    const validNameSet = new Set(
      [...transcriptSpeakerNameSet, ...validMentionNameSet].filter(Boolean)
    );

    const ensureTaskDescriptions = (tasks: TaskType[]): TaskType[] =>
      tasks.map((task) => ({
        ...task,
        description: (() => {
          const description = task.description?.trim();
          const sourceSnippet = task.sourceEvidence?.[0]?.snippet?.trim();
          const normalizedDescription = description?.toLowerCase() || "";
          const normalizedSource = sourceSnippet?.toLowerCase() || "";
          const normalizedTitle = task.title?.trim().toLowerCase() || "";
          const shouldReplace =
            !description ||
            description.length < 8 ||
            (normalizedSource && normalizedDescription === normalizedSource) ||
            (normalizedTitle && normalizedDescription === normalizedTitle);
          return shouldReplace ? `Complete: ${task.title}.` : description;
        })(),
        subtasks: task.subtasks ? ensureTaskDescriptions(task.subtasks) : task.subtasks,
      }));

    const enrichTasks = (tasks: TaskType[]): TaskType[] =>
      applyTaskMetadata(
        ensureTaskDescriptions(
          sanitizeTaskDescriptions(
            sanitizeTaskAssignees(
              assignAssigneesFromTranscript(tasks, transcriptText),
              validNameSet
            )
          )
        )
      );

    const finalLight = enrichTasks(rewrittenLight);
    const expandedWithEvidence = applyCompletionReviewFlags(
      attachEvidenceToTasks(rawTasks, transcriptText)
    );
    const finalExpanded = rawTasks.length
      ? enrichTasks(expandedWithEvidence)
      : finalLight;

    const taskProvider = auditorProvider || specialistProvider || routerProvider;
    const tagProvider = (tasks: TaskType[]) =>
      annotateTasksWithProvider(tasks, taskProvider as any);
    const taggedLight = tagProvider(finalLight);
    const taggedExpanded = tagProvider(finalExpanded);
    const resolvedLight = taggedLight.length
      ? taggedLight
      : taggedExpanded.length
        ? taggedExpanded
        : [];
    const resolvedExpanded = taggedExpanded.length ? taggedExpanded : resolvedLight;

    const mergePeople = (
      primary: Array<{ name: string; email?: string; title?: string }>,
      fallback: Array<{ name: string; email?: string; title?: string }>
    ) => {
      const merged = new Map<string, { name: string; email?: string; title?: string }>();
      for (const person of [...fallback, ...primary]) {
        const key = normalizeName(person.name);
        if (!key) continue;
        if (!merged.has(key)) {
          merged.set(key, { ...person });
        } else {
          const existing = merged.get(key)!;
          merged.set(key, {
            name: existing.name || person.name,
            email: existing.email || person.email,
            title: existing.title || person.title,
          });
        }
      }
      return Array.from(merged.values());
    };

    const attendees = mergePeople([], transcriptAttendees as any)
      .filter((person) => {
        const key = normalizeName(person.name);
        if (!key) return false;
        return hasTranscriptSpeakers
          ? transcriptSpeakerNameSet.has(key)
          : nameAppearsInTranscript(person.name);
      })
      .map((person) => {
        const email = person.email?.toLowerCase();
        const emailAllowed = email ? transcriptEmails.has(email) : false;
        return {
          ...person,
          email: emailAllowed ? person.email : undefined,
        };
      });

    const tasksForAssigneeScan =
      requestedDetailLevel === "detailed"
        ? resolvedExpanded
        : requestedDetailLevel === "medium"
          ? resolvedExpanded
          : resolvedLight;

    const assigneeNames = new Set(
      tasksForAssigneeScan
        .map((task) => task.assigneeName)
        .filter((name): name is string => Boolean(name))
        .map((name) => normalizeName(name))
        .filter(Boolean)
    );

    const attendeeNameSet = new Set(
      attendees.map((person) => normalizeName(person.name)).filter(Boolean)
    );
    const mentionedFromTasks = Array.from(assigneeNames)
      .filter((name) => validMentionNameSet.has(name) && !attendeeNameSet.has(name))
      .map((name) => ({
        name: name
          .split(/\s+/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
      }));

    const mentionedPeople = mergePeople([], mentionedFromTasks as any).filter((person) => {
      const nameKey = normalizeName(person.name);
      if (!nameKey) return false;
      if (validMentionNameSet.has(nameKey)) return true;
      return nameAppearsInTranscript(person.name);
    });

    const normalized: AnalyzeMeetingOutput = {
      chatResponseText:
        "I've classified the meeting and extracted the verified action items.",
      sessionTitle:
        getString(specialistRaw.title) ||
        getString(specialistRaw.session_title) ||
        undefined,
      allTaskLevels: {
        light: resolvedLight,
        medium: resolvedExpanded,
        detailed: resolvedExpanded,
      },
      attendees: attendees.length ? attendees : [],
      mentionedPeople: mentionedPeople.length ? mentionedPeople : [],
      meetingSummary: meetingSummary,
      meetingMetadata,
    };

    return AnalyzeMeetingOutputSchema.parse(normalized);
  }
);

export async function analyzeMeeting(
  input: AnalyzeMeetingInput
): Promise<AnalyzeMeetingOutput> {
  return await analyzeMeetingFlow(input);
}
