// src/functions/google.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Updated scopes to include Calendar, Meet, and Drive for the ingestion pipeline
const GOOGLE_API_SCOPES = [
    "https://www.googleapis.com/auth/tasks", // Original scope for Google Tasks
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/calendar.readonly", // For reading calendar events
    "https://www.googleapis.com/auth/meetings.space.readonly", // For reading Meet artifacts
    "https://www.googleapis.com/auth/drive.readonly", // For downloading artifacts from Drive
].join(" ");


export const getGoogleAuthUrl = onCall({ secrets: ["GOOGLEOAUTH_CLIENT_ID"], cors: true }, (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const userId = request.auth.uid;
    const { redirectUri, origin } = request.data;
    
    if (!redirectUri || !origin) {
        logger.error("Request received without a redirectUri or origin for Google Auth.");
        throw new HttpsError("invalid-argument", "Server configuration error: Missing redirect URI or origin.");
    }
    
    const state = Buffer.from(JSON.stringify({ userId, origin, redirectUri })).toString('base64');
    
    const googleClientId = process.env.GOOGLEOAUTH_CLIENT_ID;
    if (!googleClientId) {
        logger.error("Google Client ID is not configured.");
        throw new HttpsError("internal", "Server configuration error.");
    }

    const params = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_API_SCOPES, // Use the updated, broader scopes
        access_type: 'offline',
        prompt: 'consent',
        state: state,
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return { authUrl };
});


export const googleAuthCallback = onCall({ secrets: ["GOOGLEOAUTH_CLIENT_ID", "GOOGLEOAUTH_CLIENT_SECRET"], cors: true }, async (request) => {
    const { code, state: encodedState } = request.data;
    
    if (!code || typeof code !== 'string') {
        throw new HttpsError("invalid-argument", "Missing or invalid 'code' parameter.");
    }
     if (!encodedState || typeof encodedState !== 'string') {
        throw new HttpsError("invalid-argument", "Missing or invalid 'state' parameter.");
    }

    let decodedState;
    try {
        decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf-8'));
    } catch (error) {
        logger.error("Failed to decode state parameter:", error);
        throw new HttpsError("invalid-argument", "Invalid state parameter.");
    }

    const { userId, origin, redirectUri } = decodedState;

    if (!userId || !origin || !redirectUri) {
        logger.error("Decoded state is missing userId, origin, or redirectUri.");
        throw new HttpsError("invalid-argument", "Invalid state payload.");
    }
    
    const clientId = process.env.GOOGLEOAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLEOAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        logger.error("Google OAuth client ID or secret is not configured.");
        throw new HttpsError("internal", "Server configuration error.");
    }

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
    });

    try {
        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });

        const tokens: any = await response.json();
        if (!response.ok || tokens.error) {
            logger.error("Error exchanging auth code for tokens:", tokens.error_description);
            throw new HttpsError("permission-denied", `Failed to exchange auth code: ${tokens.error_description || 'Unknown error'}`);
        }

        const userIntegrationsRef = db.collection(`users/${userId}/integrations`).doc('googleTasks');
        await userIntegrationsRef.set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiryDate: admin.firestore.Timestamp.fromMillis(Date.now() + tokens.expires_in * 1000),
            scope: tokens.scope,
            tokenType: tokens.token_type,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            userId,
        }, { merge: true });

        logger.info(`Successfully stored Google tokens for user ${userId}.`);
        return { success: true };
    } catch (error: any) {
        logger.error("Exception in googleAuthCallback:", error);
        if (error instanceof HttpsError) {
          throw error;
        }
        throw new HttpsError("internal", "An unexpected error occurred during Google authentication callback.");
    }
});


/**
 * Revokes Google user tokens.
 */
export const revokeGoogleUserTokens = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const userId = request.auth.uid;
    const integrationRef = db.collection(`users/${userId}/integrations`).doc('googleTasks');
    const docSnap = await integrationRef.get();

    if (!docSnap.exists) {
        logger.info(`No Google tokens to revoke for user ${userId}.`);
        return { status: "success", message: "No active connection to disconnect." };
    }

    const { refreshToken } = docSnap.data() as any;

    if (refreshToken) {
        try {
            await fetch(`${GOOGLE_REVOKE_URL}?token=${refreshToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            logger.info(`Successfully revoked Google refresh token for user ${userId}.`);
        } catch (error) {
            // Log the error but proceed with deleting our record anyway.
            logger.error(`Failed to revoke Google token for user ${userId}, but proceeding with deletion.`, error);
        }
    }

    await integrationRef.delete();
    return { status: "success", message: "Successfully disconnected from Google." };
});


/**
 * Refreshes an expired Google access token using the stored refresh token.
 */
export const refreshGoogleAccessToken = onCall({ secrets: ["GOOGLEOAUTH_CLIENT_ID", "GOOGLEOAUTH_CLIENT_SECRET"], cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }

    const userId = request.auth.uid;
    const integrationRef = db.collection(`users/${userId}/integrations`).doc('googleTasks');
    const docSnap = await integrationRef.get();

    if (!docSnap.exists || !docSnap.data()?.refreshToken) {
        throw new HttpsError("failed-precondition", "No refresh token available. Please re-authenticate.");
    }

    const { refreshToken } = docSnap.data() as any;
    const clientId = process.env.GOOGLEOAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLEOAUTH_CLIENT_SECRET;

    const body = new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });

    try {
        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });

        const tokens: any = await response.json();

        if (!response.ok || tokens.error) {
            logger.error("Error refreshing access token:", tokens.error_description);
            // If refresh fails, it might be revoked. Clean up.
            await integrationRef.delete();
            throw new HttpsError("permission-denied", "Failed to refresh token. Please re-authenticate.");
        }

        await integrationRef.update({
            accessToken: tokens.access_token,
            expiryDate: admin.firestore.Timestamp.fromMillis(Date.now() + tokens.expires_in * 1000),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info(`Successfully refreshed Google access token for user ${userId}.`);
        return { status: "success", message: "Token refreshed." };

    } catch (error: any) {
        logger.error("Exception in refreshGoogleAccessToken:", error);
        if (error instanceof HttpsError) {
          throw error;
        }
        throw new HttpsError("internal", "An unexpected error occurred while refreshing the token.");
    }
});
