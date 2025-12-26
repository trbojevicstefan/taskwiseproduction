// src/ai/flows/schemas.ts
import { z } from 'zod';
import { TASK_TYPE_VALUES } from '@/lib/task-types';

// --- Base Schemas ---

// This schema is what the AI is expected to produce. 
// The `id` is made optional here because the AI is not expected to generate UUIDs.
// The client application will assign stable UUIDs after receiving the data.
export const BaseTaskSchema = z.object({
  id: z.string().optional().describe('The unique client-side identifier for the task.'),
  title: z.string().describe('The meaningful and descriptive title of the task.'),
  description: z.string().optional().describe('A more detailed description of the item.'),
  priority: z.enum(['high', 'medium', 'low']).default('medium').describe('The priority of the item.'),
  taskType: z.enum(TASK_TYPE_VALUES).optional().describe('A high-level category for grouping tasks.'),
  dueAt: z.string().optional().describe('The due date and time in ISO 8601 format.'),
  assigneeName: z.string().optional().describe("The name of the person this task is assigned to."),
  aiProvider: z.enum(['gemini', 'openai']).optional().describe('The AI provider used to generate this task, if applicable.'),
  sourceEvidence: z.array(z.object({
    snippet: z.string().describe('The transcript or input snippet that supports this task.'),
    speaker: z.string().optional().describe('The speaker tied to the snippet, if known.'),
    timestamp: z.string().optional().describe('Timestamp for the snippet, if available.'),
  })).optional().describe('Supporting evidence for why this task exists.'),
});

export type TaskType = z.infer<typeof BaseTaskSchema> & {
  subtasks?: TaskType[];
};

export const TaskSchema: z.ZodType<TaskType> = BaseTaskSchema.extend({
  subtasks: z.array(z.lazy(() => TaskSchema)).optional(),
});

export const PersonSchema = z.object({
    name: z.string().describe("The full name of the person identified."),
    email: z.string().optional().describe("The person's email address, if mentioned."),
    title: z.string().optional().describe("The person's job title or role, if mentioned."),
});
export type PersonSchemaType = z.infer<typeof PersonSchema>;


// --- AnalyzeMeetingFlow Schemas ---

export const MeetingTypeSchema = z.enum([
  "SALES_DISCOVERY",
  "ENGINEERING_SCRUM",
  "GENERAL_INTERNAL",
]);

export const MeetingMetadataSchema = z.object({
  type: MeetingTypeSchema,
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  dealIntelligence: z
    .object({
      painPoints: z.array(z.string()).optional(),
      economicBuyer: z.string().optional(),
      timeline: z.string().optional(),
    })
    .optional(),
  sprintHealth: z.enum(["ON_TRACK", "AT_RISK"]).optional(),
  blockers: z.array(z.string()).optional(),
});

export const AnalyzeMeetingInputSchema = z.object({
  transcript: z.string().describe('The full transcript of the source meeting.'),
  requestedDetailLevel: z.enum(['light', 'medium', 'detailed']).default('medium'),
});
export type AnalyzeMeetingInput = z.infer<typeof AnalyzeMeetingInputSchema>;

export const AnalyzeMeetingOutputSchema = z.object({
  chatResponseText: z.string().describe('A concise textual response summarizing the action taken.'),
  sessionTitle: z.string().optional().describe('A short, descriptive title for the session based on the meeting content.'),
  
  allTaskLevels: z.object({
    light: z.array(TaskSchema).describe("A 'light' version with only high-level macro tasks. Task descriptions should be more detailed if only a few tasks are generated."),
    medium: z.array(TaskSchema).describe("A 'medium' detail version with main tasks and one level of important sub-tasks."),
    detailed: z.array(TaskSchema).describe("A 'detailed' version with a deep, hierarchical breakdown and multiple levels of granular sub-tasks."),
  }),
  
  attendees: z.array(PersonSchema).optional().describe("An array of people who actively participated (i.e., have dialogue) in the transcript."),
  mentionedPeople: z.array(PersonSchema).optional().describe("An array of people who were mentioned by name in the transcript but did not speak."),

  meetingSummary: z.string().optional().describe("A concise summary of the meeting's key points, decisions, and outcomes."),
  keyMoments: z.array(z.object({
      timestamp: z.string().describe("The timestamp from the transcript (e.g., '03:12') where the moment occurred."),
      description: z.string().describe("A brief description of the key moment, decision, or action item.")
  })).optional().describe("A list of key moments identified from the meeting transcript."),
  overallSentiment: z.number().optional().describe("Overall sentiment of the meeting from 0.0 (very negative) to 1.0 (very positive)."),
  speakerActivity: z.array(z.object({ name: z.string(), wordCount: z.number() })).optional().describe("An array of speakers and their total word count."),
  meetingMetadata: MeetingMetadataSchema.optional().describe("Structured meeting classification details."),
});
export type AnalyzeMeetingOutput = z.infer<typeof AnalyzeMeetingOutputSchema>;


// --- ExtractTasksFromMessageFlow Schemas ---

export const ExtractTasksFromMessageInputSchema = z.object({
  message: z.string().describe('The chat message to extract tasks from.'),
  isFirstMessage: z.boolean().optional().describe('Set to true if this is the first message of a new session, to trigger title generation.'),
  requestedDetailLevel: z.enum(['light', 'medium', 'detailed']).default('medium'),
  existingTasks: z.array(TaskSchema).optional().describe('An optional list of existing tasks. If provided, the AI should modify this list based on the user\'s message.'),
});
export type ExtractTasksFromMessageInput = z.infer<typeof ExtractTasksFromMessageInputSchema>;


export const ExtractTasksFromMessageOutputSchema = z.object({
  chatResponseText: z.string().describe('A concise textual response for the chat interface.'),
  sessionTitle: z.string().optional().describe('A short, descriptive title for the session (only if `isFirstMessage` was true).'),
  
  tasks: z.array(TaskSchema),
  
  allTaskLevels: z.object({
    light: z.array(TaskSchema),
    medium: z.array(TaskSchema),
    detailed: z.array(TaskSchema),
  }).optional(),
});
export type ExtractTasksFromMessageOutput = z.infer<typeof ExtractTasksFromMessageOutputSchema>;


// --- Orchestrator Schemas (extract-tasks.ts) ---

export const OrchestratorInputSchema = z.object({
  message: z.string().describe('The user\'s chat message or command.'),
  isFirstMessage: z.boolean().optional().describe('Set to true for the first message of a new session.'),
  requestedDetailLevel: z.enum(['light', 'medium', 'detailed']).default('medium').describe("The desired level of task breakdown detail."),
  
  contextTaskTitle: z.string().optional().describe('The title of an existing task to break down further.'),
  contextTaskDescription: z.string().optional().describe('The description of an existing task to break down further.'),
  
  existingTasks: z.array(TaskSchema).optional().describe('The full, current list of tasks in the session.'),
  
  sourceMeetingTranscript: z.string().optional().describe('The full transcript of a source meeting.'),
  
  selectedTasks: z.array(TaskSchema).optional().describe('A specific subset of tasks the user has selected for an operation.'),
});
export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;

export const OrchestratorOutputSchema = z.object({
  chatResponseText: z.string().describe('A concise textual response for the chat interface.'),
  sessionTitle: z.string().optional().describe('A short, descriptive title for the session.'),
  
  tasks: z.array(TaskSchema).describe("The complete, final, and updated list of tasks for the session."),
  
  people: z.array(PersonSchema.extend({ role: z.enum(['attendee', 'mentioned'])})).optional().describe("A unified array of unique people identified, with a role indicating their participation."),
  meetingSummary: z.string().optional().describe("A concise summary of a meeting."),
  keyMoments: z.array(z.object({ timestamp: z.string(), description: z.string() })).optional(),
  overallSentiment: z.number().optional(),
  speakerActivity: z.array(z.object({ name: z.string(), wordCount: z.number() })).optional(),
  meetingMetadata: MeetingMetadataSchema.optional(),

  allTaskLevels: z.object({
    light: z.array(TaskSchema),
    medium: z.array(TaskSchema),
    detailed: z.array(TaskSchema),
  }).optional(),

  qaAnswer: z.object({
      answerText: z.string(),
      sources: z.array(z.object({ timestamp: z.string(), snippet: z.string() })).optional(),
  }).optional(),
});
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;


// --- RefineTasksFlow Schemas ---

export const RefineTasksInputSchema = z.object({
  instruction: z.string().describe("The user's instruction, e.g., 'Break this down' or 'Merge these'."),
  
  fullTaskList: z.array(TaskSchema).describe("The entire current list of tasks for context."),

  contextTask: TaskSchema.optional().describe("A single task to be refined or broken down."),
  tasksToRefine: z.array(TaskSchema).optional().describe("A specific subset of tasks to be modified (e.g., merged, reworded)."),
});
export type RefineTasksInput = z.infer<typeof RefineTasksInputSchema>;


export const RefineTasksOutputSchema = z.object({
  chatResponseText: z.string().describe('A concise textual response for the chat interface.'),
  updatedTasks: z.array(TaskSchema).describe('The complete, final, and updated list of tasks after applying the refinement.'),
});
export type RefineTasksOutput = z.infer<typeof RefineTasksOutputSchema>;


// --- TranscriptQAFlow Schemas ---

export const TranscriptQAInputSchema = z.object({
  question: z.string().describe("The user's question about the transcript."),
  transcript: z.string().describe("The full meeting transcript to be queried."),
  tasks: z.array(TaskSchema).optional().describe("The current list of tasks for additional context."),
});
export type TranscriptQAInput = z.infer<typeof TranscriptQAInputSchema>;


export const TranscriptQAOutputSchema = z.object({
  answerText: z.string().describe("A direct, synthesized answer to the user's question."),
  sources: z.array(z.object({
    timestamp: z.string().describe("The timestamp from the transcript that supports the answer."),
    snippet: z.string().describe("The exact text snippet from the transcript."),
  })).optional().describe("A list of transcript excerpts that ground the answer."),
});
export type TranscriptQAOutput = z.infer<typeof TranscriptQAOutputSchema>;

// --- ProcessPastedContentFlow Schemas ---
export const ProcessPastedContentInputSchema = z.object({
    pastedText: z.string().describe('The text content pasted by the user.'),
    requestedDetailLevel: z.enum(['light', 'medium', 'detailed']).default('medium').describe("The user's desired level of task breakdown detail."),
});
export type ProcessPastedContentInput = z.infer<typeof ProcessPastedContentInputSchema>;

export const ProcessPastedContentOutputSchema = z.object({
  isMeeting: z.boolean().describe('Indicates if the content was processed as a meeting transcript.'),
  tasks: z.array(TaskSchema).optional().describe('The tasks extracted from general text.'),
  people: z.array(PersonSchema.extend({ role: z.enum(['attendee', 'mentioned'])})).optional().describe("A unified array of unique people identified, with a role indicating their participation."),
  titleSuggestion: z.string().describe('A suggested title for the new session/plan based on the content.'),
  meeting: z.object({
      originalTranscript: z.string(),
      summary: z.string().describe("A concise summary of the meeting's key points, decisions, and outcomes."),
      attendees: z.array(PersonSchema.extend({ role: z.enum(['attendee', 'mentioned'])})),
      extractedTasks: z.array(TaskSchema),
      title: z.string(),
      meetingMetadata: MeetingMetadataSchema.optional(),
      allTaskLevels: z.object({
        light: z.array(TaskSchema),
        medium: z.array(TaskSchema),
        detailed: z.array(TaskSchema),
      }).optional(),
      keyMoments: AnalyzeMeetingOutputSchema.shape.keyMoments,
      overallSentiment: AnalyzeMeetingOutputSchema.shape.overallSentiment,
      speakerActivity: AnalyzeMeetingOutputSchema.shape.speakerActivity,
  }).optional().describe('A structured meeting object, returned ONLY if the content is identified as a meeting transcript.'),
  allTaskLevels: z.object({
    light: z.array(TaskSchema),
    medium: z.array(TaskSchema),
    detailed: z.array(TaskSchema),
  }).optional(),
});
export type ProcessPastedContentOutput = z.infer<typeof ProcessPastedContentOutputSchema>;


// --- ShareToSlackFlow Schemas ---

type SlackTask = {
  id: string;
  title: string;
  description?: string | null;
  priority: 'high' | 'medium' | 'low';
  dueAt?: string | Date | null;
  assignee?: {
    uid: string | null;
    name: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null;
  subtasks?: SlackTask[] | null;
};

const SlackTaskSchema: z.ZodType<SlackTask> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  dueAt: z.union([z.string(), z.date()]).optional().nullable(),
  assignee: z.object({
    uid: z.string().nullable(),
    name: z.string().nullable(),
    email: z.string().optional().nullable(),
    photoURL: z.string().optional().nullable(),
  }).optional().nullable(),
  subtasks: z.lazy(() => z.array(SlackTaskSchema)).optional().nullable(),
});

export const ShareToSlackInputSchema = z.object({
  tasks: z.array(SlackTaskSchema).describe('The list of tasks to be shared.'),
  channelId: z.string().describe('The ID of the Slack channel to post the message to.'),
  customMessage: z.string().optional().describe('An optional introductory message from the user.'),
  sourceTitle: z.string().describe('The title of the session or plan the tasks are from.'),
});
export type ShareToSlackInput = z.infer<typeof ShareToSlackInputSchema>;

export const ShareToSlackOutputSchema = z.object({
  success: z.boolean(),
  message: z.string().describe('A summary of the result, e.g., "Message posted successfully."'),
  error: z.string().optional().describe('An error message if the operation failed.'),
});
export type ShareToSlackOutput = z.infer<typeof ShareToSlackOutputSchema>;
