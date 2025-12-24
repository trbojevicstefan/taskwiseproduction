/**
 * @fileOverview A general-purpose webhook to receive text data and create a new Meeting record.
 * This is an HTTP-triggered Cloud Function, updated to V2.
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { processPastedContent } from "../ai/flows/process-pasted-content";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const generalWebhook = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const token = req.query.token as string;
  if (!token) {
    logger.warn("Request received without a token.");
    res.status(401).send("Unauthorized: Missing token.");
    return;
  }

  const text = req.body.text;
  if (!text) {
    logger.warn("Payload received without a 'text' field.");
    res.status(400).send("Bad Request: Missing 'text' field in body.");
    return;
  }

  try {
    const usersRef = db.collection("users");
    const userQuery = await usersRef.where("firefliesWebhookToken", "==", token).limit(1).get();

    if (userQuery.empty) {
      logger.warn(`No user found for token: ${token}`);
      res.status(403).send("Forbidden: Invalid token.");
      return;
    }

    const user = userQuery.docs[0];
    const userId = user.id;
    logger.info(`Request authenticated for user ID: ${userId}`);

    // UNIFIED LOGIC: Call the same AI flow as the main app.
    // The `processPastedContent` function will classify the text and return a structured object.
    const result = await processPastedContent({ pastedText: text, requestedDetailLevel: 'medium' });

    if (result.isMeeting && result.meeting) {
        // Create the meeting object in Firestore.
        const meetingRef = await db.collection(`users/${userId}/meetings`).add({
            ...result.meeting,
            userId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info(`Webhook created meeting with ID: ${meetingRef.id}`);
        // We will not create the associated chat/plan sessions here,
        // that can be done lazily when the user first opens the meeting.
        res.status(200).json({ success: true, message: "Meeting processed successfully.", meetingId: meetingRef.id });

    } else {
        // Handle as a general text paste, creating a new Chat Session.
        const chatRef = await db.collection(`users/${userId}/chatSessions`).add({
            userId: userId,
            title: result.titleSuggestion,
            messages: [{ id: `msg-${Date.now()}`, text, sender: 'user', timestamp: Date.now(), name: 'Webhook' }],
            suggestedTasks: result.tasks,
            people: result.people,
            allTaskLevels: result.allTaskLevels,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Webhook created chat session with ID: ${chatRef.id}`);
        res.status(200).json({ success: true, message: "General text processed into a new chat session.", sessionId: chatRef.id });
    }

  } catch (error) {
    logger.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error.");
  }
});
