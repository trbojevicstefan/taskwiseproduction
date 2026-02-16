'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating a hierarchical mind map or flowchart from a given topic.
 * It's designed to create a single root node with nested sub-topics, suitable for the "Explore" page visualization.
 *
 */
import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { filterTaskRecursive, normalizeAiTasks } from '@/lib/ai-utils';
import { extractJsonValue } from './parse-json-output';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const GenerateMindMapInputSchema = z.object({
  topic: z.string().describe('The central topic or user message to generate a mind map for.'),
});

const BaseTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().describe('The meaningful and descriptive title of the topic or item. Avoid generic placeholders like "Sub-task 1". Ensure the title is not empty.'),
  description: z.string().optional().describe('A more detailed description of the item.'),
  priority: z.enum(['high', 'medium', 'low']).default('medium').describe('The priority of the item.'),
  dueAt: z.string().optional().describe('The due date and time for the item in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ), if mentioned.'),
});

type TaskType = {
  id?: string;
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  dueAt?: string;
  subtasks?: TaskType[];
};

const TaskSchema: z.ZodType<TaskType> = z.lazy(() =>
  BaseTaskSchema.extend({
    subtasks: z
      .array(TaskSchema)
      .optional()
      .describe(
        "A list of sub-topics or sub-items related to this main topic. Only create sub-items if they represent distinct, meaningful steps."
      ),
  })
);

const GenerateMindMapOutputSchema = z.object({
  rootTask: TaskSchema.describe('The single root node of the mind map, containing the entire nested structure of topics and sub-items.'),
});

export type GenerateMindMapOutput = z.infer<typeof GenerateMindMapOutputSchema>;
export type GenerateMindMapInput = z.infer<typeof GenerateMindMapInputSchema>;


export async function generateMindMap(input: GenerateMindMapInput): Promise<GenerateMindMapOutput> {
  return generateMindMapFlow(input);
}


const generateMindMapPrompt = ai.definePrompt({
  name: 'generateMindMapPrompt',
  input: {schema: GenerateMindMapInputSchema},
  output: { format: 'json' },
  prompt: `
You are an expert project planner and concept visualizer AI. Your goal is to analyze a user's input topic and structure it as a hierarchical mind map or flowchart, similar to a classic mind map diagram.

**Output Structure:**
Your primary output MUST be a single root JSON object named \`rootTask\`. This object will represent the main topic of the user's input. This root node will contain nested sub-topics (in a \`subtasks\` array), which can themselves contain further nested items. This creates a tree structure suitable for a flowchart.

**Instructions for Mind Map Generation:**
1.  **Identify the Main Topic:** From the user's message, determine the single, central idea or project title. This will be the title of your \`rootTask\`.
2.  **Define Key Sub-Topics:** Break down the main topic into its primary components or phases. These will be the direct children (subtasks) of the root node. Aim for 3-5 main branches if possible.
3.  **Enforce Deep Hierarchy:** For each sub-topic, break it down further into more detailed steps, actions, or concepts. Continue breaking these down recursively to create a deep and granular chart, aiming for at least 4-5 levels of depth where the topic's complexity allows. The more detailed the breakdown, the better.
4.  **Extract Details:** For every node (topic, sub-topic, or item), extract:
    *   \`title\`: A clear, descriptive, and meaningful title. AVOID generic titles like "Step 1", "Detail C", or list markers like "1.", "a)".
    *   \`description\` (optional): A brief explanation.
    *   \`priority\` (optional, default 'medium'): 'high', 'medium', or 'low'.
    *   \`dueAt\` (optional): Any specified due dates.
5.  **Task Output:** The entire nested structure must be contained within the single \`rootTask\` object.

Your output MUST be a valid JSON object adhering to the GenerateMindMapOutputSchema.

Current User's Message/Topic (Generate a mind map with a single root topic):
{{{topic}}}
`,
});


const generateMindMapFlow = ai.defineFlow(
  {
    name: 'generateMindMapFlow',
    inputSchema: GenerateMindMapInputSchema,
    outputSchema: GenerateMindMapOutputSchema,
  },
  async (input: GenerateMindMapInput): Promise<GenerateMindMapOutput> => {
    const { output, text } = await runPromptWithFallback(generateMindMapPrompt, input);
    const raw = extractJsonValue(output, text);
    const rawObject =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const rootTask = normalizeAiTasks([rawObject.rootTask], 'Root topic')[0];

    if (rootTask) {
        const filteredRoot = filterTaskRecursive(rootTask as any);
        if (filteredRoot) {
            return { rootTask: filteredRoot as TaskType };
        }
    }

    // Fallback or throw error if the root task itself is invalid or AI fails
    throw new Error("AI failed to generate a valid mind map structure.");
  }
);
