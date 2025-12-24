// src/functions/slack.ts

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

// Ensure Firebase Admin is initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Retrieves a valid Slack access token for a given team, refreshing it if it has expired.
 * @param teamId The ID of the Slack team.
 * @returns A promise that resolves to a valid access token.
 * @throws An HttpsError if the installation is not found or token cannot be refreshed.
 */
const getValidSlackToken = async (teamId: string): Promise<string> => {
    const installationRef = db.collection('slackInstallations').doc(teamId);
    const installationDoc = await installationRef.get();

    if (!installationDoc.exists) {
        throw new HttpsError("not-found", "Slack installation data not found for this team.");
    }

    const installationData = installationDoc.data() as any;
    const now = Date.now();

    // Check if the token is expired (with a 60-second buffer)
    if (installationData.expiresAt && now >= installationData.expiresAt - 60000) {
        logger.info(`Slack token for team ${teamId} has expired. Refreshing...`);
        if (!installationData.refreshToken) {
            throw new HttpsError("failed-precondition", "Missing refresh token for Slack. Please reinstall the app.");
        }

        const secrets = process.env;
        if (!secrets.SLACK_CLIENT_ID || !secrets.SLACK_CLIENT_SECRET) {
            throw new HttpsError("internal", "Slack client credentials are not configured on the server.");
        }
        
        const refreshParams = new URLSearchParams({
            client_id: secrets.SLACK_CLIENT_ID,
            client_secret: secrets.SLACK_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: installationData.refreshToken,
        });

        const response = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: refreshParams,
        });

        const refreshData: any = await response.json();

        if (!refreshData.ok) {
            logger.error(`Failed to refresh Slack token for team ${teamId}:`, refreshData.error);
            // This error often means the refresh token is also invalid, requiring re-authentication.
            if (refreshData.error === 'invalid_refresh_token') {
                 await installationRef.delete(); // Clean up invalid installation
                 throw new HttpsError("permission-denied", "Slack connection has expired. Please reconnect from settings.");
            }
            throw new HttpsError("internal", `Failed to refresh Slack token: ${refreshData.error}`);
        }
        
        // Update Firestore with the new token data
        const newInstallationData = {
            ...installationData,
            accessToken: refreshData.access_token,
            refreshToken: refreshData.refresh_token, // Slack sends a new refresh token
            expiresAt: Date.now() + (refreshData.expires_in * 1000),
        };
        await installationRef.set(newInstallationData, { merge: true });
        
        logger.info(`Successfully refreshed Slack token for team ${teamId}.`);
        return newInstallationData.accessToken;
    }
    
    return installationData.accessToken;
};


// 1. Function to get the Slack authorization URL (Callable)
export const getSlackAuthUrl = onCall({ secrets: ["SLACK_CLIENT_ID"], cors: true }, async (req) => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const userId = req.auth.uid;
  
  // Hardcode the redirect URI to the single, correct Cloud Function URL
  const callbackUrl = `https://us-central1-taskwiseai-v0.cloudfunctions.net/slackOauthCallback`;

  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  
  if (!process.env.SLACK_CLIENT_ID) {
    logger.error("SLACK_CLIENT_ID environment variable not set.");
    throw new HttpsError("internal", "Server configuration error (missing client ID).");
  }

  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: ['chat:write', 'im:write', 'users:read', 'users:read.email', 'chat:write.public', 'channels:read', 'groups:read'].join(','),
    user_scope: '',
    redirect_uri: callbackUrl,
    state: state,
  });

  const authUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  
  return { authUrl };
});

// 2. Handle the OAuth callback from Slack (Callable)
export const slackOauthCallback = onCall({ secrets: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], cors: true }, async (request) => {
    const { code, state: encodedState } = request.data;

    if (!encodedState) {
      throw new HttpsError("invalid-argument", "The 'state' parameter is missing.");
    }
    const { userId } = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf-8'));

    if (!userId) {
       throw new HttpsError("invalid-argument", "The 'state' parameter is invalid.");
    }

    const callbackUrl = `https://us-central1-taskwiseai-v0.cloudfunctions.net/slackOauthCallback`;

    if (!code || typeof code !== 'string') {
        throw new HttpsError("invalid-argument", "Missing 'code' parameter.");
    }
    if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
        logger.error("Slack Client ID or Secret is not configured.");
        throw new HttpsError("internal", "Server configuration error.");
    }
  
    const body = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: code,
      redirect_uri: callbackUrl,
    });
  
    try {
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const data: any = await response.json();
  
      if (!data.ok) {
        logger.error("Slack OAuth Error:", data.error);
        throw new HttpsError("internal", `Failed to exchange code: ${data.error}`);
      }
  
      const teamId = data.team?.id;
      if (!teamId) {
        throw new HttpsError("internal", "No Team ID returned from Slack.");
      }
      
      const installationData = {
        teamId: teamId,
        teamName: data.team?.name,
        botUserId: data.bot_user_id,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
        scope: data.scope,
      };
  
      const installationRef = db.collection('slackInstallations').doc(teamId);
      const userRef = db.collection('users').doc(userId);
  
      const batch = db.batch();
      batch.set(installationRef, installationData, { merge: true });
      batch.update(userRef, { slackTeamId: teamId });
      await batch.commit();
  
      logger.info(`Successfully installed and associated Slack app for team: ${teamId} with user: ${userId}`);
      return { status: "success" };

    } catch (error) {
      logger.error("Error during Slack OAuth callback:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "An unexpected error occurred during Slack authentication.");
    }
});

// 3. Function to revoke Slack tokens
export const slackRevokeTokens = onCall({ secrets: ["SLACK_CLIENT_SECRET"] , cors: true }, async (req) => {
    const { teamId } = req.data;
    if (!req.auth) {
        throw new HttpsError("unauthenticated", "User must be authenticated to revoke tokens.");
    }
    if (!teamId) {
      throw new HttpsError("invalid-argument", "The function must be called with a 'teamId'.");
    }
  
    const userId = req.auth.uid;
    const userRef = db.collection('users').doc(userId);
  
    try {
      const userDoc = await userRef.get();
      if(userDoc.data()?.slackTeamId === teamId) {
        await userRef.update({ slackTeamId: admin.firestore.FieldValue.delete() });
      }
  
      // The installation document in `slackInstallations` is left intact in case other users from the same workspace are using the app.
      // A more complex cleanup (e.g., with cron jobs) could remove unused installations later.
      // For now, simply unlinking the user is the main goal.
  
      logger.info(`Successfully disassociated Slack for user: ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error revoking tokens for user ${userId}:`, error);
      throw new HttpsError("internal", "Could not revoke Slack tokens.");
    }
});


// 4. Function to fetch Slack channels
export const fetchSlackChannels = onCall({ secrets: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
      }
    
      const userId = request.auth.uid;
    
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
          throw new HttpsError("not-found", "User profile not found.");
        }
        const userData = userDoc.data();
        const teamId = userData?.slackTeamId;
    
        if (!teamId) {
          throw new HttpsError("failed-precondition", "User is not connected to a Slack team.");
        }

        const accessToken = await getValidSlackToken(teamId);
    
        const response = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
    
        const result: any = await response.json();
    
        if (!result.ok) {
          logger.error("Slack API error fetching channels:", result.error);
          throw new HttpsError("internal", `Slack API error: ${result.error}`);
        }
        
        const channels = result.channels
          .filter((c: any) => (c.is_channel || c.is_group) && !c.is_archived)
          .map((c: any) => ({
            id: c.id,
            name: c.name,
          }));
    
        return { channels };
    
      } catch (error: any) {
        logger.error('Error fetching Slack channels callable function:', error);
        if (error instanceof HttpsError) {
          throw error;
        }
        throw new HttpsError("internal", "An unexpected error occurred while fetching Slack channels.");
      }
});

// Helper to convert standard Markdown to Slack's mrkdwn
const toSlackMarkdown = (text: string): string => {
    return text
        .replace(/\*\*(.*?)\*\*/g, '*$1*') // Bold
        .replace(/### (.*?)\n/g, '*$1*\n') // H3
        .replace(/## (.*?)\n/g, '*$1*\n')  // H2
        .replace(/# (.*?)\n/g, '*$1*\n')   // H1
        .replace(/•/g, '•') // Keep bullets
        .replace(/^- /gm, '• ') // Convert markdown list to bullet
        .replace(/^\d+\. /gm, '• '); // Convert numbered list to bullet
};


// Helper function to format tasks into Slack's Block Kit format
const formatTasksToSlackBlocks = (tasks: any[], sourceTitle: string, customMessage?: string, includeAiContent?: boolean): any[] => {
    const blocks: any[] = [];
    if (customMessage) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: customMessage } });
    }
    blocks.push({ type: 'header', text: { type: 'plain_text', text: `Action Items from: ${sourceTitle}`, emoji: true } });
    blocks.push({ type: 'divider' });

    const generateTaskBlocks = (taskList: any[], level = 0) => {
        taskList.forEach(task => {
            const indent = ' '.repeat(level * 4);
            let taskText = `${indent}• *${task.title}*`;
            
            const details: string[] = [];
            if (task.priority && task.priority !== 'medium') { details.push(`_Priority: ${task.priority}_`); }
            if (task.assignee?.name) { details.push(`*Owner:* ${task.assignee.name}`); }
            if (task.dueAt) { const date = new Date(task.dueAt); if (!isNaN(date.getTime())) { details.push(`_Due: ${date.toLocaleDateString()}_`); } }
            if (details.length > 0) { taskText += `\n>${details.join(' | ')}`; }
            
            blocks.push({ type: 'section', text: { type: 'mrkdwn', text: taskText } });

            // Add description and AI content in separate, better-formatted blocks
            if (task.description) {
                blocks.push({
                    type: 'context',
                    elements: [
                        { type: 'mrkdwn', text: `*Description:* ${task.description}` }
                    ]
                });
            }

            if (includeAiContent) {
                if (task.researchBrief) {
                    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✨ AI Research Brief*\n${toSlackMarkdown(task.researchBrief)}` } });
                    blocks.push({ type: 'divider' });
                }
                if (task.aiAssistanceText) {
                    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✨ AI Assistance*\n${toSlackMarkdown(task.aiAssistanceText)}` } });
                    blocks.push({ type: 'divider' });
                }
            }

            if (task.subtasks) { generateTaskBlocks(task.subtasks, level + 1); }
        });
    };

    generateTaskBlocks(tasks);
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Shared from *TaskWiseAI*` }] });

    // Slack has a limit of 50 blocks per message
    return blocks.slice(0, 50);
};


// 5. Function to share tasks to Slack
export const shareTasksToSlack = onCall({ secrets: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be authenticated to share tasks.");
    }
    const userId = request.auth.uid;
    const { tasks, channelId, customMessage, sourceTitle, includeAiContent } = request.data;

    if (!tasks || !channelId || !sourceTitle) {
        throw new HttpsError("invalid-argument", "Missing required data: tasks, channelId, sourceTitle.");
    }

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) { throw new HttpsError("not-found", "User profile not found."); }

        const teamId = userDoc.data()?.slackTeamId;
        if (!teamId) { throw new HttpsError("failed-precondition", "User is not connected to a Slack team."); }

        const accessToken = await getValidSlackToken(teamId);

        const blocks = formatTasksToSlackBlocks(tasks, sourceTitle, customMessage, includeAiContent);

        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ channel: channelId, blocks, text: `Action Items from: ${sourceTitle}` }),
        });

        const result: any = await response.json();

        if (!result.ok) {
            logger.error('Slack API Error posting message:', result.error, 'Blocks sent:', JSON.stringify(blocks, null, 2));
            throw new HttpsError("internal", `Failed to post to Slack: ${result.error}`);
        }

        return { success: true, message: "Tasks successfully posted to Slack." };

    } catch (error: any) {
        logger.error('Error in shareTasksToSlack function:', error);
        if (error instanceof HttpsError) { throw error; }
        throw new HttpsError("internal", "An unexpected error occurred while sharing to Slack.");
    }
});
