
// src/ai/flows/extract-tasks.test.ts
import { processChatForTasks, type ExtractTasksFromChatOutput } from './extract-tasks';

// This test suite focuses ONLY on the `processChatForTasks` pure function.
// It does not involve any Genkit or AI calls, making it fast and reliable.
describe('processChatForTasks', () => {

  it('should process a simple, valid AI response and return tasks', async () => {
    // This is a direct simulation of what the AI would return.
    const mockAiOutput: ExtractTasksFromChatOutput = {
      chatResponseText: 'I have created a task for you.',
      sessionTitle: 'New Task Session',
      tasks: [
        {
          title: 'Buy milk',
          description: 'Get a gallon of whole milk.',
          priority: 'medium',
        },
      ],
      people: [],
    };

    // The function under test.
    const result = await processChatForTasks(mockAiOutput);

    // Assertions to ensure the function processed the data correctly.
    expect(result.chatResponseText).toBe('I have created a task for you.');
    expect(result.sessionTitle).toBe('New Task Session');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe('Buy milk');
    expect(result.people).toEqual([]);
  });

  it('should filter out tasks with invalid titles from the AI response', async () => {
    // Set up a mock AI response with a mix of valid and invalid tasks.
    const mockAiOutputWithInvalidTasks: ExtractTasksFromChatOutput = {
      chatResponseText: 'I processed your request.',
      tasks: [
        { title: 'Valid Task', priority: 'medium' },
        { title: '', priority: 'medium' }, // Invalid empty title
        { title: ' ', priority: 'medium' }, // Invalid whitespace title
        { title: '1.', priority: 'medium' }, // Invalid simple list marker
        { title: 'a)', priority: 'medium' }, // Invalid simple list marker
        { title: 'Another valid one', priority: 'medium' },
      ],
      people: [],
    };

    // The function under test.
    const result = await processChatForTasks(mockAiOutputWithInvalidTasks);

    // Assertions: Check that the invalid tasks were filtered out by our business logic.
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].title).toBe('Valid Task');
    expect(result.tasks[1].title).toBe('Another valid one');
  });

  it('should handle nested subtasks and filter invalid ones recursively', async () => {
    const mockAiOutputWithNestedInvalid: ExtractTasksFromChatOutput = {
        chatResponseText: 'Processed nested tasks.',
        tasks: [
            {
                title: 'Parent Task 1',
                priority: 'high',
                subtasks: [
                    { title: 'Valid Subtask 1.1', priority: 'medium' },
                    { title: '2)', priority: 'low' }, // Invalid subtask
                    { title: 'Valid Subtask 1.2', priority: 'medium', subtasks: [
                        { title: '  ', priority: 'high' } // Invalid nested subtask
                    ]},
                ]
            },
            { title: 'Parent Task 2', priority: 'medium' }
        ],
        people: [],
    };

    const result = await processChatForTasks(mockAiOutputWithNestedInvalid);

    expect(result.tasks).toHaveLength(2);
    // Check Parent 1
    expect(result.tasks[0].subtasks).toBeDefined();
    expect(result.tasks[0].subtasks).toHaveLength(2);
    expect(result.tasks[0].subtasks?.[0].title).toBe('Valid Subtask 1.1');
    // Check the subtask that had its own invalid subtask
    expect(result.tasks[0].subtasks?.[1].title).toBe('Valid Subtask 1.2');
    expect(result.tasks[0].subtasks?.[1].subtasks).toBeDefined();
    expect(result.tasks[0].subtasks?.[1].subtasks).toHaveLength(0); // The invalid one should be gone
    // Check Parent 2
    expect(result.tasks[1].title).toBe('Parent Task 2');
    expect(result.tasks[1].subtasks).toBeUndefined();
  });

  it('should return a default message if AI output is null or undefined', async () => {
    const result = await processChatForTasks(null);
    expect(result.chatResponseText).toBe("I processed your request, but couldn't generate a specific summary.");
    expect(result.tasks).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.sessionTitle).toBeUndefined();
  });
});
