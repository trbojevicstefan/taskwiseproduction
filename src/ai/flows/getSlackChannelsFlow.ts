// src/ai/flows/getSlackChannelsFlow.ts
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';

export const getSlackChannelsFlow = ai.defineFlow(
  {
    name: 'getSlackChannelsFlow',
    inputSchema: z.void(),
    outputSchema: z.any(),
  },
  async () => {
    // This flow is now just a placeholder.
    // The actual logic has been moved to a standard Firebase Cloud Function
    // in `src/functions/slack.ts` to align with the project's deployment strategy.
    // This is to prevent 404 errors when the client tries to call a Genkit flow endpoint
    // that isn't being served by a dedicated Genkit backend.

    // Returning mock data to ensure the flow is valid, but it should not be called by the client.
    return {
      channels: [
        { id: 'C12345', name: 'general' },
        { id: 'C67890', name: 'random' },
      ],
    };
  }
);
