
import { config } from 'dotenv';
config();

import '@/ai/flows/extract-tasks-flow.ts';

import '@/ai/flows/analyze-meeting-flow.ts';
import '@/ai/flows/refine-tasks-flow.ts';
import '@/ai/flows/transcript-qa-flow.ts';

import '@/ai/flows/summarize-chat-session.ts';
import '@/ai/flows/merge-tasks-flow.ts'; 
import '@/ai/flows/generate-research-brief-flow.ts'; 
import '@/ai/flows/simplify-task-branch-flow.ts';
import '@/ai/flows/generate-task-assistance-flow.ts';
import '@/ai/flows/process-pasted-content.ts';
import '@/ai/flows/generate-mind-map-flow.ts';
// This file is being removed as its logic is converted to a standard Firebase Function
// import '@/ai/flows/shareToSlackFlow.ts';
import '@/ai/flows/getSlackChannelsFlow.ts';
