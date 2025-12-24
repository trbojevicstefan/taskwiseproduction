import {genkit} from 'genkit';
// NOTE: Make sure your package is '@genkit-ai/googleai' OR '@genkit-ai/google-genai'
import {googleAI} from '@genkit-ai/googleai';

export const ai = genkit({
  plugins: [
    googleAI(),
  ],
  logLevel: 'debug',
  // 🚀 UPDATED to the most cost-effective, stable model name
  model: process.env.GENKIT_DEFAULT_MODEL || 'googleai/gemini-2.5-flash-lite',
  temperature: 0.2,
  maxOutputTokens: 8192,
});
