// src/ai/flows/rewrite-task-titles.ts
'use server';

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { extractJsonValue } from './parse-json-output';
import { isPlaceholderTitle, isValidTitle } from '@/lib/ai-utils';
import type { TaskType } from './schemas';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const RewriteTaskTitlesInputSchema = z.object({
  contextText: z.string().optional(),
  tasks: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      assigneeName: z.string().optional(),
      dueAt: z.string().optional(),
      evidence: z.string().optional(),
    })
  ),
});

const RewriteTaskTitlesOutputSchema = z.object({
  items: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      description: z.string().optional(),
    })
  ),
});

type RewriteTaskItem = z.infer<typeof RewriteTaskTitlesInputSchema.shape.tasks>[number];

const rewriteTaskTitlesPrompt = ai.definePrompt({
  name: 'rewriteTaskTitlesPrompt',
  input: { schema: RewriteTaskTitlesInputSchema },
  output: { format: 'json' },
  prompt: `
You are an expert task editor. Rewrite each task title to be concise, action-oriented, and unambiguous.

Rules:
- Do NOT add or remove tasks. Return the same number of items with the same "path" values.
- Do NOT invent information that isn't supported by the provided context or evidence.
- Use imperative verb + object (e.g., "Send DPA clause to legal", "Schedule design review").
- Keep descriptions short and helpful. If the input description is already good, you can keep it.
- If a task is already clear, return it unchanged.
- Do NOT replace concrete steps with generic meta tasks like "learn", "review", "clarify", or "figure out".

{{#if contextText}}
Context:
"""
{{{contextText}}}
"""
{{/if}}

Tasks to rewrite (JSON):
{{{json tasks}}}

Return JSON with shape:
{
  "items": [
    { "path": "0", "title": "...", "description": "..." }
  ]
}
  `,
});

const flattenTasks = (tasks: TaskType[], prefix = ''): RewriteTaskItem[] => {
  const items: RewriteTaskItem[] = [];
  tasks.forEach((task, index) => {
    const path = prefix ? `${prefix}.${index}` : `${index}`;
    const evidence = task.sourceEvidence?.[0]?.snippet;
    items.push({
      path,
      title: task.title,
      description: task.description || undefined,
      assigneeName: task.assigneeName || undefined,
      dueAt: task.dueAt || undefined,
      evidence: evidence && evidence.length > 0 ? evidence.slice(0, 220) : undefined,
    });
    if (task.subtasks && task.subtasks.length > 0) {
      items.push(...flattenTasks(task.subtasks, path));
    }
  });
  return items;
};

const applyRewrites = (
  tasks: TaskType[],
  updates: Map<string, { title?: string; description?: string }>,
  prefix = ''
): TaskType[] => {
  return tasks.map((task, index) => {
    const path = prefix ? `${prefix}.${index}` : `${index}`;
    const update = updates.get(path);
    const nextTitle =
      update?.title && isValidTitle(update.title) && !isPlaceholderTitle(update.title)
        ? update.title.trim()
        : task.title;
    const nextDescription =
      update?.description && update.description.trim().length > 0
        ? update.description.trim()
        : task.description;
    return {
      ...task,
      title: nextTitle,
      description: nextDescription,
      subtasks: task.subtasks ? applyRewrites(task.subtasks, updates, path) : task.subtasks,
    };
  });
};

export async function rewriteTaskTitles(
  tasks: TaskType[],
  contextText?: string
): Promise<TaskType[]> {
  if (!tasks.length) return tasks;
  const flattened = flattenTasks(tasks);
  if (!flattened.length) return tasks;

  const { output, text } = await runPromptWithFallback(rewriteTaskTitlesPrompt, {
    contextText,
    tasks: flattened,
  });
  const raw = extractJsonValue(output, text);
  const parsed = RewriteTaskTitlesOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return tasks;
  }

  const updates = new Map<string, { title?: string; description?: string }>();
  parsed.data.items.forEach((item) => {
    updates.set(item.path, {
      title: item.title,
      description: item.description,
    });
  });

  return applyRewrites(tasks, updates);
}
