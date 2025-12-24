// src/functions/trello.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();

const REQUEST_TOKEN_URL = "https://trello.com/1/OAuthGetRequestToken";
const ACCESS_TOKEN_URL = "https://trello.com/1/OAuthGetAccessToken";
const AUTHORIZE_URL = "https://trello.com/1/OAuthAuthorizeToken";
const API_BASE_URL = "https://api.trello.com/1";


const getTrelloSecrets = () => {
    const trelloApiKey = process.env.TRELLO_API_KEY;
    const trelloApiSecret = process.env.TRELLO_API_SECRET;
    if (!trelloApiKey || !trelloApiSecret) {
        logger.error("Trello API Key or Secret is not configured.");
        throw new HttpsError("internal", "Server configuration error for Trello integration.");
    }
    return { trelloApiKey, trelloApiSecret };
};

const getTrelloUserTokens = async (userId: string) => {
    const integrationRef = db.collection(`users/${userId}/integrations`).doc('trello');
    const docSnap = await integrationRef.get();
    if (!docSnap.exists) {
        throw new HttpsError("failed-precondition", "Trello integration not found for this user. Please connect Trello in settings.");
    }
    return docSnap.data() as { accessToken: string; tokenSecret: string };
};

// 1) Get request token
export const trelloGetRequestToken = onCall({ secrets: ["TRELLO_API_KEY", "TRELLO_API_SECRET"], cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const userId = request.auth.uid;
    const clientOrigin = request.data.origin;
    if (!clientOrigin) {
        throw new HttpsError("invalid-argument", "The 'origin' must be provided in the request body.");
    }

    const callbackUrl = `${clientOrigin}/auth/trello/callback`;
    const { trelloApiKey, trelloApiSecret } = getTrelloSecrets();

    const params = new URLSearchParams({
        oauth_consumer_key: trelloApiKey,
        oauth_signature_method: "PLAINTEXT",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: Math.random().toString(36).slice(2),
        oauth_version: "1.0",
        oauth_callback: callbackUrl,
        oauth_signature: `${trelloApiSecret}&`,
    });

    try {
        const response = await fetch(`${REQUEST_TOKEN_URL}?${params.toString()}`, { method: "POST" });
        const text = await response.text();
        const responseParams = new URLSearchParams(text);

        const oauth_token = responseParams.get("oauth_token");
        const oauth_token_secret = responseParams.get("oauth_token_secret");
        if (!oauth_token || !oauth_token_secret) throw new Error("Failed to get request token from Trello.");

        await db.collection(`users/${userId}/integrations`).doc("trelloTemp").set({
            requestTokenSecret: oauth_token_secret,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const authUrl = `${AUTHORIZE_URL}?oauth_token=${oauth_token}&name=TaskWiseAI&scope=read,write&expiration=never`;
        return { authUrl };
    } catch (error: any) {
        logger.error("Error getting Trello request token:", error);
        throw new HttpsError("internal", "Could not initiate Trello connection.");
    }
});


// 2. Exchange the request token for a long-lived access token
export const trelloGetAccessToken = onCall({ secrets: ["TRELLO_API_KEY", "TRELLO_API_SECRET"], cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }

    const { oauth_token, oauth_verifier } = request.data;
    if (!oauth_token || !oauth_verifier) {
        throw new HttpsError("invalid-argument", "Missing oauth_token or oauth_verifier.");
    }
    
    const userId = request.auth.uid;
    const tempRef = db.collection(`users/${userId}/integrations`).doc('trelloTemp');
    const tempDoc = await tempRef.get();

    if (!tempDoc.exists) {
        throw new HttpsError("not-found", "Trello authentication session expired or not found. Please try again.");
    }

    const { requestTokenSecret } = tempDoc.data() as any;
    const { trelloApiKey, trelloApiSecret } = getTrelloSecrets();

    const params = new URLSearchParams({
        oauth_consumer_key: trelloApiKey,
        oauth_token: oauth_token,
        oauth_verifier: oauth_verifier,
        oauth_signature_method: "PLAINTEXT",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: Math.random().toString(36).substring(2, 15),
        oauth_version: "1.0",
        oauth_signature: `${trelloApiSecret}&${requestTokenSecret}`,
    });

    try {
        const response = await fetch(`${ACCESS_TOKEN_URL}?${params.toString()}`, { method: 'POST' });
        const text = await response.text();
        const responseParams = new URLSearchParams(text);

        const accessToken = responseParams.get("oauth_token");
        const tokenSecret = responseParams.get("oauth_token_secret");

        if (!accessToken || !tokenSecret) {
            throw new Error("Failed to exchange tokens with Trello.");
        }

        const batch = db.batch();
        const integrationRef = db.collection(`users/${userId}/integrations`).doc('trello');
        batch.set(integrationRef, {
            accessToken,
            tokenSecret,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.delete(tempRef);
        await batch.commit();
        
        logger.info(`Successfully stored Trello access token for user ${userId}.`);
        return { success: true, message: "Trello connected successfully." };

    } catch (error: any) {
        logger.error("Error getting Trello access token:", error);
        throw new HttpsError("internal", "Could not finalize Trello connection.");
    }
});


// 3. Revoke Trello access by deleting the token
export const trelloRevokeToken = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const userId = request.auth.uid;
    const integrationRef = db.collection(`users/${userId}/integrations`).doc('trello');

    try {
        await integrationRef.delete();
        logger.info(`Successfully revoked Trello access for user ${userId}.`);
        return { success: true, message: "Trello has been disconnected." };
    } catch (error: any) {
        logger.error("Error revoking Trello token:", error);
        throw new HttpsError("internal", "Could not disconnect Trello.");
    }
});

// 4. Fetch user's boards
export const trelloGetBoards = onCall({ secrets: ["TRELLO_API_KEY", "TRELLO_API_SECRET"], cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const userId = request.auth.uid;
    const { trelloApiKey, trelloApiSecret } = getTrelloSecrets();
    const { accessToken, tokenSecret } = await getTrelloUserTokens(userId);

    const params = new URLSearchParams({
        oauth_consumer_key: trelloApiKey,
        oauth_token: accessToken,
        oauth_signature_method: "PLAINTEXT",
        oauth_signature: `${trelloApiSecret}&${tokenSecret}`,
        fields: "name,id,url"
    });

    try {
        const response = await fetch(`${API_BASE_URL}/members/me/boards?${params.toString()}`);
        if (!response.ok) {
             const errorText = await response.text();
             logger.error("Trello API Error fetching boards:", errorText);
             throw new HttpsError("internal", "Failed to fetch boards from Trello.");
        }
        const boards = await response.json();
        return { boards };
    } catch (error: any) {
        logger.error("Exception fetching Trello boards:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "An unexpected error occurred while fetching Trello boards.");
    }
});

// 5. Fetch lists for a specific board
export const trelloGetListsForBoard = onCall({ secrets: ["TRELLO_API_KEY", "TRELLO_API_SECRET"], cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const { boardId } = request.data;
    if (!boardId) throw new HttpsError("invalid-argument", "A boardId must be provided.");

    const userId = request.auth.uid;
    const { trelloApiKey, trelloApiSecret } = getTrelloSecrets();
    const { accessToken, tokenSecret } = await getTrelloUserTokens(userId);

    const params = new URLSearchParams({
        oauth_consumer_key: trelloApiKey,
        oauth_token: accessToken,
        oauth_signature_method: "PLAINTEXT",
        oauth_signature: `${trelloApiSecret}&${tokenSecret}`,
        fields: "name,id",
    });

    try {
        const response = await fetch(`${API_BASE_URL}/boards/${boardId}/lists?${params.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            logger.error("Trello API Error fetching lists:", errorText);
            throw new HttpsError("internal", "Failed to fetch lists from Trello.");
        }
        const lists = await response.json();
        return { lists };
    } catch (error: any) {
        logger.error(`Exception fetching Trello lists for board ${boardId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "An unexpected error occurred while fetching Trello lists.");
    }
});

// 6. Create a card
export const trelloCreateCard = onCall({ secrets: ["TRELLO_API_KEY", "TRELLO_API_SECRET"], cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const { listId, name, desc, subtasks } = request.data;
    if (!listId || !name) throw new HttpsError("invalid-argument", "listId and name are required.");
    
    const userId = request.auth.uid;
    const { trelloApiKey, trelloApiSecret } = getTrelloSecrets();
    const { accessToken, tokenSecret } = await getTrelloUserTokens(userId);

    const cardParams = new URLSearchParams({
        idList: listId,
        name,
        desc,
        oauth_consumer_key: trelloApiKey,
        oauth_token: accessToken,
        oauth_signature_method: "PLAINTEXT",
        oauth_signature: `${trelloApiSecret}&${tokenSecret}`,
    });

    try {
        const response = await fetch(`${API_BASE_URL}/cards`, {
            method: 'POST',
            body: cardParams
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger.error("Trello API Error creating card:", errorText);
            throw new HttpsError("internal", "Failed to create card in Trello.");
        }
        const card = await response.json() as { id: string };

        // If there are subtasks, create a checklist
        if (subtasks && subtasks.length > 0) {
            const checklistParams = new URLSearchParams({
                idCard: card.id,
                name: "Subtasks",
                oauth_consumer_key: trelloApiKey,
                oauth_token: accessToken,
                oauth_signature_method: "PLAINTEXT",
                oauth_signature: `${trelloApiSecret}&${tokenSecret}`,
            });

            const checklistResponse = await fetch(`${API_BASE_URL}/checklists`, {
                method: 'POST',
                body: checklistParams
            });
            const checklist = await checklistResponse.json() as { id: string };

            // Add each subtask as a checklist item
            for (const subtask of subtasks) {
                const checkItemParams = new URLSearchParams({
                    name: subtask.title,
                    pos: 'bottom',
                    oauth_consumer_key: trelloApiKey,
                    oauth_token: accessToken,
                    oauth_signature_method: "PLAINTEXT",
                    oauth_signature: `${trelloApiSecret}&${tokenSecret}`,
                });
                await fetch(`${API_BASE_URL}/checklists/${checklist.id}/checkItems`, {
                    method: 'POST',
                    body: checkItemParams,
                });
            }
        }
        return { success: true, cardId: card.id };

    } catch (error: any) {
        logger.error("Exception creating Trello card:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "An unexpected error occurred while creating Trello card.");
    }
});
