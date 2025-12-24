// src/app/auth/trello/callback/page.tsx
"use client";

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '@/lib/firebase/config';
import { useAuth } from '@/contexts/AuthContext';


function TrelloCallbackContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();

  useEffect(() => {
    // This effect runs inside the popup window.
    const oauthToken = searchParams.get('oauth_token');
    const oauthVerifier = searchParams.get('oauth_verifier');

    if (!window.opener) {
        // This page should only be opened as a popup.
        // You can show an error or close it.
        window.close();
        return;
    }

    if (oauthToken && oauthVerifier && user) {
        const exchangeTokens = async () => {
            try {
                const { app } = getFirebaseServices();
                if (!app) {
                    throw new Error("Firebase is not initialized.");
                }
                const functions = getFunctions(app, 'us-central1');
                const trelloGetAccessTokenFn = httpsCallable(functions, 'trelloGetAccessToken');

                await trelloGetAccessTokenFn({ oauth_token: oauthToken, oauth_verifier: oauthVerifier });

                // Send success message to parent window and close self
                window.opener.postMessage({ type: 'trelloAuthSuccess' }, window.location.origin);

            } catch (error: any) {
                console.error("Error exchanging Trello tokens:", error);
                const errorMessage = error.details?.message || "Could not connect your Trello account.";
                
                // Send error message to parent window
                window.opener.postMessage({ type: 'trelloAuthError', message: errorMessage }, window.location.origin);
            } finally {
                // Always close the popup
                window.close();
            }
        };

        exchangeTokens();

    } else if (user === null) {
         // If the user context isn't loaded yet, just wait.
         // This prevents errors on initial load of the popup.
    } else {
        // Handle cases where tokens are missing
        window.opener.postMessage({ type: 'trelloAuthError', message: 'Trello authorization was incomplete. Please try again.' }, window.location.origin);
        window.close();
    }

  }, [searchParams, user]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-lg text-muted-foreground">Finalizing Trello Connection...</p>
      <p className="text-sm text-muted-foreground">Please wait, this window will close automatically.</p>
    </div>
  );
}


export default function TrelloCallbackPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <p className="text-lg text-muted-foreground">Loading...</p>
            </div>
        }>
            <TrelloCallbackContent />
        </Suspense>
    );
}
