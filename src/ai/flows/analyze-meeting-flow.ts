
// src/ai/flows/analyze-meeting-flow.ts
'use server';
/**
 * @fileOverview This flow is dedicated to performing a deep analysis of a meeting transcript.
 * It's responsible for extracting tasks, summarizing the meeting,
 * identifying attendees vs. mentioned people, and analyzing sentiment.
 */

import { ai } from '@/ai/genkit';
import { 
  AnalyzeMeetingInputSchema,
  type AnalyzeMeetingInput,
  AnalyzeMeetingOutputSchema,
  type AnalyzeMeetingOutput,
  type TaskType,
} from './schemas';
import { extractJsonValue } from './parse-json-output';
import { alignTasksToLight, annotateTasksWithProvider, applyTaskMetadata, hasMeaningfulTasks, normalizeAiTasks } from '@/lib/ai-utils';
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
} from '@/lib/transcript-utils';
import { rewriteTaskTitles } from './rewrite-task-titles';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

// --- GENKIT PROMPT ---

const analyzeMeetingPrompt = ai.definePrompt({
  name: 'analyzeMeetingPrompt',
  input: { schema: AnalyzeMeetingInputSchema },
  output: { format: 'json' },
  prompt: `
You are a Principal Analyst & Strategist. Your sole purpose is to perform a deep and comprehensive analysis of the provided meeting transcript.

**Full Meeting Transcript:**
\`\`\`
{{{transcript}}}
\`\`\`

**Your Instructions:**

1.  **Full Meeting Analysis:** You MUST perform a complete analysis of the transcript.
    *   **Generate Task Levels:** Create three complete, hierarchical task lists and place them in the \`allTaskLevels\` object. This is a mandatory step.
        *   \`allTaskLevels.light\`: Generate only top-level, high-level macro tasks. These should be the most critical action items.
        *   \`allTaskLevels.medium\`: Use the SAME top-level tasks as \`light\`, but add one level of meaningful subtasks.
        *   \`allTaskLevels.detailed\`: Use the SAME top-level tasks as \`light\`, but break subtasks down one level deeper where discussed.
        *   **CRITICAL:** Do NOT use placeholder titles like "Action item", "Task 1", or "Step 2". Every task title must include a clear verb and object (e.g., "Send DPA clause to legal").
        *   **CRITICAL:** Do NOT invent tasks or pad the list to hit a quota. Only include tasks explicitly mentioned in the transcript.
        *   **Granularity Targets (guidelines only):** Light should have 3-7 tasks. Medium should have 5-12 tasks with 1 level of subtasks. Detailed should have 10-20 tasks across two levels of subtasks.
    *   **Identify People (CRITICAL):**
        *   \`attendees\`: Identify all individuals who have dialogue (i.e., they spoke) in the transcript.
        *   \`mentionedPeople\`: Identify all individuals who are mentioned by name but DO NOT have any dialogue in the transcript.
        *   **Task Assignment:** If tasks are clearly linked to individuals in the transcript, set the \`assigneeName\` field in ALL task lists.
        *   **CRITICAL:** Do NOT invent email addresses if they are not explicitly mentioned in the transcript.
    *   **Key Moments & Summary**: Identify key moments and list them in the \`keyMoments\` field. Provide a concise, insightful summary in the \`meetingSummary\` field.
    *   **Sentiment & Activity**: Analyze the transcript for overall sentiment and return it as a score from 0.0 to 1.0 in \`overallSentiment\`. Also, calculate the word count for each speaker and return it in \`speakerActivity\`.
    *   **Meeting Title**: Examine the transcript for an explicit title (e.g., "Meeting: Q3 Planning"). If found, use it for the \`sessionTitle\`. If not, create a concise, descriptive title based on the content.

2.  **CRITICAL**: Do not invent information. All outputs must be grounded in the provided transcript. Ensure all fields in the output schema are populated. Do not return empty arrays for tasks unless there are absolutely no tasks.
3.  **Chat Response**: Formulate a concise \`chatResponseText\` that confirms the action taken (e.g., "I've summarized the meeting and extracted the action items.").
4.  **Output Requirement:** Your final output MUST be a single, valid JSON object that strictly adheres to the provided output schema.
  `,
});

// --- GENKIT FLOW ---

const analyzeMeetingFlow = ai.defineFlow(
  {
    name: 'analyzeMeetingFlow',
    inputSchema: AnalyzeMeetingInputSchema,
    outputSchema: AnalyzeMeetingOutputSchema,
  },
  async (input: AnalyzeMeetingInput) => {
    const { output, text, provider } = await runPromptWithFallback(analyzeMeetingPrompt, input);
    const raw = extractJsonValue(output, text);
    const rawObject =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const getString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    const getNumber = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const getObject = (value: unknown): Record<string, unknown> | null =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const getArray = (value: unknown): unknown[] =>
      Array.isArray(value) ? value : [];

    const attendeesFromAi = getArray(rawObject.attendees)
      .map((person) => {
        const obj = getObject(person);
        if (!obj) return null;
        const name = getString(obj.name);
        if (!name) return null;
        const email = getString(obj.email);
        const title = getString(obj.title);
        return {
          name,
          email,
          title,
        };
      })
      .filter(Boolean);

    const mentionedFromAi = getArray(rawObject.mentionedPeople)
      .map((person) => {
        const obj = getObject(person);
        if (!obj) return null;
        const name = getString(obj.name);
        if (!name) return null;
        const email = getString(obj.email);
        const title = getString(obj.title);
        return {
          name,
          email,
          title,
        };
      })
      .filter(Boolean);

    const allTaskLevelsObject = getObject(rawObject.allTaskLevels) || {};
    const aiLightTasks = normalizeAiTasks(allTaskLevelsObject.light, "Meeting action");
    const aiMediumTasks = normalizeAiTasks(allTaskLevelsObject.medium, "Meeting action");
    const aiDetailedTasks = normalizeAiTasks(allTaskLevelsObject.detailed, "Meeting action");

    const transcriptText = getString(input.transcript) || "";
    const transcriptTasks = extractTranscriptTasks(transcriptText);
    const mergeTasks = (primary: TaskType[], fallback: TaskType[]) => {
      if (!primary.length) return fallback;
      if (!hasMeaningfulTasks(primary) && fallback.length) return fallback;
      const existing = new Set(primary.map((task) => task.title.toLowerCase()));
      const extras = fallback.filter(
        (task) => !existing.has(task.title.toLowerCase())
      );
      return primary.concat(extras);
    };

    const lightTasks = mergeTasks(aiLightTasks, transcriptTasks);
    const mediumTasks = mergeTasks(aiMediumTasks, transcriptTasks);
    const detailedTasks = mergeTasks(aiDetailedTasks, transcriptTasks);

    const lightWithEvidence = attachEvidenceToTasks(lightTasks, transcriptText);
    const mediumWithEvidence = attachEvidenceToTasks(mediumTasks, transcriptText);
    const detailedWithEvidence = attachEvidenceToTasks(detailedTasks, transcriptText);

    const hasTranscript = Boolean(transcriptText);

    const rewriteTasksSafely = async (tasks: TaskType[]) => {
      try {
        return await rewriteTaskTitles(tasks, transcriptText);
      } catch (error) {
        console.error("Failed to rewrite meeting task titles:", error);
        return tasks;
      }
    };

    const rewrittenLight = await rewriteTasksSafely(lightWithEvidence);
    const rewrittenMedium = await rewriteTasksSafely(mediumWithEvidence);
    const rewrittenDetailed = await rewriteTasksSafely(detailedWithEvidence);

    const alignedMedium = alignTasksToLight(rewrittenLight, rewrittenMedium);
    const alignedDetailed = alignTasksToLight(rewrittenLight, rewrittenDetailed);
    const defaultTasks = hasTranscript
      ? normalizeAiTasks(
          [{ title: "Review meeting transcript and confirm action items" }],
          "Meeting action"
        )
      : [];
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
    const aiSpeakerNameSet = new Set(
      (attendeesFromAi as Array<{ name: string }>).map((person) => normalizeName(person.name)).filter(Boolean)
    );
    const speakerNameSet =
      transcriptSpeakerNameSet.size ? transcriptSpeakerNameSet : aiSpeakerNameSet;
    const transcriptMentionNameSet = new Set(
      transcriptMentionNames.map((name) => normalizeName(name)).filter(Boolean)
    );
    const aiMentionNameSet = new Set(
      (mentionedFromAi as Array<{ name: string }>).map((person) => normalizeName(person.name)).filter(Boolean)
    );
    const validMentionNameSet =
      transcriptMentionNameSet.size ? transcriptMentionNameSet : aiMentionNameSet;
    const validNameSet = new Set(
      [...speakerNameSet, ...validMentionNameSet].filter(Boolean)
    );

    const finalLight = applyTaskMetadata(
      sanitizeTaskDescriptions(
        sanitizeTaskAssignees(
          assignAssigneesFromTranscript(rewrittenLight, transcriptText),
          validNameSet
        )
      )
    );
    const finalMedium = applyTaskMetadata(
      sanitizeTaskDescriptions(
        sanitizeTaskAssignees(
          assignAssigneesFromTranscript(alignedMedium, transcriptText),
          validNameSet
        )
      )
    );
    const finalDetailed = applyTaskMetadata(
      sanitizeTaskDescriptions(
        sanitizeTaskAssignees(
          assignAssigneesFromTranscript(alignedDetailed, transcriptText),
          validNameSet
        )
      )
    );

    const countTasksDeep = (tasks: TaskType[]): number =>
      tasks.reduce(
        (sum, task) => sum + 1 + (task.subtasks ? countTasksDeep(task.subtasks) : 0),
        0
      );
    const ensureMoreDetailed = (candidate: TaskType[], fallback: TaskType[]): TaskType[] =>
      countTasksDeep(candidate) >= countTasksDeep(fallback) ? candidate : fallback;
    const normalizedLight = finalLight;
    const normalizedMedium = ensureMoreDetailed(finalMedium, normalizedLight);
    const normalizedDetailed = ensureMoreDetailed(finalDetailed, normalizedMedium);

    const tagProvider = (tasks: TaskType[]) =>
      annotateTasksWithProvider(tasks, provider);
    const taggedLight = tagProvider(normalizedLight);
    const taggedMedium = tagProvider(normalizedMedium);
    const taggedDetailed = tagProvider(normalizedDetailed);
    const taggedDefaultTasks = tagProvider(defaultTasks);

    const fallbackTasks =
      taggedLight.length || taggedMedium.length || taggedDetailed.length
        ? taggedLight.length
          ? taggedLight
          : taggedMedium.length
            ? taggedMedium
            : taggedDetailed
        : taggedDefaultTasks;

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

    const attendees = mergePeople(attendeesFromAi as any, transcriptAttendees as any)
      .filter((person) => speakerNameSet.has(normalizeName(person.name)))
      .map((person) => {
        const email = person.email?.toLowerCase();
        const emailAllowed = email ? transcriptEmails.has(email) : false;
        return {
          ...person,
          email: emailAllowed ? person.email : undefined,
        };
      });

    const assigneeNames = new Set(
      [...taggedLight, ...taggedMedium, ...taggedDetailed]
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

    const mentionedFromAiFiltered = (mentionedFromAi as any).filter(
      (person: { name: string; email?: string }) => {
        const nameKey = normalizeName(person.name);
        const email = person.email?.toLowerCase();
        const emailAllowed = email ? transcriptEmails.has(email) : false;
        return (nameKey && validMentionNameSet.has(nameKey)) || emailAllowed;
      }
    );

    const mentionedPeople = mergePeople(mentionedFromAiFiltered, mentionedFromTasks as any).filter(
      (person) => {
        const nameKey = normalizeName(person.name);
        return nameKey && validMentionNameSet.has(nameKey);
      }
    );

    const keyMoments = getArray(rawObject.keyMoments)
      .map((moment) => {
        const obj = getObject(moment);
        if (!obj) return null;
        const timestamp = getString(obj.timestamp);
        const description = getString(obj.description);
        if (!timestamp || !description) return null;
        return { timestamp, description };
      })
      .filter(Boolean);

    const speakerActivity = getArray(rawObject.speakerActivity)
      .map((speaker) => {
        const obj = getObject(speaker);
        if (!obj) return null;
        const name = getString(obj.name);
        const wordCount = getNumber(obj.wordCount);
        if (!name || wordCount === undefined) return null;
        return { name, wordCount };
      })
      .filter(Boolean);

    const overallSentimentRaw = getNumber(rawObject.overallSentiment);
    const overallSentiment =
      overallSentimentRaw !== undefined
        ? Math.min(1, Math.max(0, overallSentimentRaw))
        : undefined;

    const normalized: AnalyzeMeetingOutput = {
      chatResponseText:
        getString(rawObject.chatResponseText) ||
        "I've summarized the meeting and extracted the action items.",
      sessionTitle: getString(rawObject.sessionTitle),
      allTaskLevels: {
        light: taggedLight.length ? taggedLight : fallbackTasks,
        medium: taggedMedium.length ? taggedMedium : fallbackTasks,
        detailed: taggedDetailed.length ? taggedDetailed : fallbackTasks,
      },
      attendees: attendees.length ? attendees : [],
      mentionedPeople: mentionedPeople.length ? mentionedPeople : [],
      meetingSummary: getString(rawObject.meetingSummary),
      keyMoments: keyMoments.length ? keyMoments : undefined,
      overallSentiment,
      speakerActivity: speakerActivity.length ? speakerActivity : undefined,
    };

    return AnalyzeMeetingOutputSchema.parse(normalized);
  }
);

/**
 * Wrapper function to be called from the orchestrator.
 */
export async function analyzeMeeting(input: AnalyzeMeetingInput): Promise<AnalyzeMeetingOutput> {
  return await analyzeMeetingFlow(input);
}
