'use server';

/**
 * @fileOverview This file defines a Genkit flow for processing pasted text content.
 * It intelligently determines if the content is a meeting transcript or general text
 * and routes it to the appropriate AI flow for processing.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import {
  ProcessPastedContentInputSchema,
  type ProcessPastedContentInput,
  ProcessPastedContentOutputSchema,
  type ProcessPastedContentOutput,
  AnalyzeMeetingInputSchema,
  type AnalyzeMeetingOutput,
  ExtractTasksFromMessageInputSchema,
  type ExtractTasksFromMessageOutput,
} from './schemas';
import { analyzeMeeting } from './analyze-meeting-flow';
import { extractTasksFromMessage } from './extract-tasks-flow';
import { sanitizeTaskForFirestore } from '@/lib/data';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const TRANSCRIPT_TIMESTAMP_REGEX =
  /(^|\n)\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}:\d{2}(?::\d{2})?)\b/m;

const hasTranscriptTimestamp = (text: string): boolean =>
  TRANSCRIPT_TIMESTAMP_REGEX.test(text);


const contentClassifierPrompt = ai.definePrompt({
    name: 'contentClassifierPrompt',
    input: { schema: z.object({ pastedText: z.string() }) },
    output: { schema: z.object({ contentType: z.enum(['meeting_transcript', 'general_text']) }) },
    prompt: `
    Analyze the following text and classify it as either a 'meeting_transcript' or 'general_text'.

    - A 'meeting_transcript' typically contains dialogue, speaker labels (like "Name:", "Speaker 1:"), timestamps (e.g., "00:03", "12:45"), action items, or mentions of syncing up.
    - 'general_text' is anything else, like a list of ideas, a project brief, an article, or a single topic.

    Text to classify:
    """
    {{{pastedText}}}
    """
    `,
});

// The exported function will now return a more complex object
export async function processPastedContent(
  input: ProcessPastedContentInput
): Promise<{
  tasks: ExtractedTaskSchema[];
  people: ProcessPastedContentOutput['people'];
  titleSuggestion: string;
  isMeeting: boolean;
  allTaskLevels?: ProcessPastedContentOutput['allTaskLevels'];
  meeting?: Omit<
    Meeting,
    'id' | 'userId' | 'createdAt' | 'lastActivityAt' | 'chatSessionId' | 'planningSessionId'
  >;
}> {
  const result = await processPastedContentFlow(input);

  if (result.isMeeting && result.meeting) {
    const meetingTasks = (result.meeting.extractedTasks || []).map((t: ExtractedTaskSchema) =>
      sanitizeTaskForFirestore(t as ExtractedTaskSchema)
    );
    return {
      tasks: meetingTasks,
      people: result.meeting.attendees,
      titleSuggestion: result.meeting.title,
      isMeeting: true,
      allTaskLevels: result.allTaskLevels,
      meeting: {
        ...result.meeting,
        extractedTasks: meetingTasks,
        allTaskLevels: result.allTaskLevels,
      },
    };
  }

  // Fallback for non-meeting styles
  const generalTasks = (result.tasks || []).map((t: ExtractedTaskSchema) =>
    sanitizeTaskForFirestore(t as ExtractedTaskSchema)
  );
  return {
    tasks: generalTasks,
    people: result.people || [],
    titleSuggestion: result.titleSuggestion,
    isMeeting: false,
    allTaskLevels: result.allTaskLevels,
  };
}

const processPastedContentFlow = ai.defineFlow(
    {
        name: 'processPastedContentFlow',
        inputSchema: ProcessPastedContentInputSchema,
        outputSchema: ProcessPastedContentOutputSchema,
    },
    async (input: ProcessPastedContentInput): Promise<ProcessPastedContentOutput> => {
        
        const hasTimestamp = hasTranscriptTimestamp(input.pastedText);
        const classification = hasTimestamp
            ? { contentType: 'meeting_transcript' as const }
            : (await runPromptWithFallback(contentClassifierPrompt, { pastedText: input.pastedText })).output as { contentType?: 'meeting_transcript' | 'general_text' } | undefined;
        
        const isMeeting = hasTimestamp || classification?.contentType === 'meeting_transcript';

        if (isMeeting) {
            const analysisResult: AnalyzeMeetingOutput = await analyzeMeeting({
                transcript: input.pastedText,
                requestedDetailLevel: input.requestedDetailLevel,
            });

            const primaryTasks = analysisResult.allTaskLevels[input.requestedDetailLevel] || [];
            
            const attendees = (analysisResult.attendees || []).map((p: NonNullable<AnalyzeMeetingOutput['attendees']>[number]) => ({ ...p, role: 'attendee' as const }));
            const mentioned = (analysisResult.mentionedPeople || []).map((p: NonNullable<AnalyzeMeetingOutput['attendees']>[number]) => ({ ...p, role: 'mentioned' as const }));
            const combinedPeople = [...attendees, ...mentioned];
            const uniquePeople = Array.from(new Map(combinedPeople.map(p => [p.name.toLowerCase(), p])).values());

            const meetingTitle = analysisResult.sessionTitle || `Meeting: ${input.pastedText.substring(0, 50)}...`;

            return {
                isMeeting: true,
                titleSuggestion: meetingTitle,
                people: uniquePeople,
                tasks: primaryTasks,
                allTaskLevels: analysisResult.allTaskLevels,
                meeting: {
                    originalTranscript: input.pastedText,
                    summary: analysisResult.meetingSummary || analysisResult.chatResponseText || '',
                    attendees: uniquePeople,
                    extractedTasks: primaryTasks,
                    title: meetingTitle,
                    allTaskLevels: analysisResult.allTaskLevels,
                    keyMoments: analysisResult.keyMoments,
                    overallSentiment: analysisResult.overallSentiment,
                    speakerActivity: analysisResult.speakerActivity,
                }
            };
        } else {
            // For general text, use the dedicated task extraction flow
            const generalResult: ExtractTasksFromMessageOutput = await extractTasksFromMessage({
                message: input.pastedText,
                isFirstMessage: true,
                requestedDetailLevel: input.requestedDetailLevel,
            });
             return {
                isMeeting: false,
                tasks: generalResult.tasks,
                people: [],
                titleSuggestion: generalResult.sessionTitle || 'New Plan from Paste',
                allTaskLevels: generalResult.allTaskLevels,
            };
        }
    }
);
