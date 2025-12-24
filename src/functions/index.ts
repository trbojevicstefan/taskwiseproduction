
// src/functions/index.ts
import * as admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2/options";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Set the region for all functions in this file
setGlobalOptions({ region: "us-central1" });


// Export functions from their own files
export { generalWebhook } from "./generalWebhook";
export { generateWebhookToken } from "./generateWebhookToken";
export { getSlackAuthUrl, slackOauthCallback, slackRevokeTokens, fetchSlackChannels, shareTasksToSlack } from "./slack";
export { getGoogleAuthUrl, googleAuthCallback, revokeGoogleUserTokens, refreshGoogleAccessToken } from "./google";
export { trelloGetRequestToken, trelloGetAccessToken, trelloRevokeToken, trelloGetBoards, trelloGetListsForBoard, trelloCreateCard } from "./trello";
