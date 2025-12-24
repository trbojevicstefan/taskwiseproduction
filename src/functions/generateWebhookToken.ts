// src/functions/generateWebhookToken.ts
/**
 * @fileOverview A callable Cloud Function to generate a unique webhook token for a user.
 * This has been upgraded to a 2nd Generation function to align with the project's configuration.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const generateWebhookToken = onCall(async (request) => {
  // Check authentication
  if (!request.auth) {
    logger.error("Request is not authenticated.");
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  const userId = request.auth.uid;
  const newToken = uuidv4();

  try {
    const userRef = db.collection("users").doc(userId);
    await userRef.update({ firefliesWebhookToken: newToken });

    logger.info(`Generated new webhook token for user ${userId}.`);
    
    // Send the new token back to the client.
    return { token: newToken };

  } catch (error) {
    logger.error(`Error generating token for user ${userId}:`, error);
    throw new HttpsError(
      "internal",
      "An error occurred while generating the token."
    );
  }
});
