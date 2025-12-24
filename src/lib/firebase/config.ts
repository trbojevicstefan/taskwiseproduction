// src/lib/firebase/config.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// This file provides a robust way to get Firebase services,
// ensuring that Firebase is initialized only once and only on the client-side.

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if all required config values are present and not placeholder strings
const areAllVarsDefined =
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    !firebaseConfig.apiKey.includes("YOUR_");

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (typeof window !== "undefined" && !getApps().length && areAllVarsDefined) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    } catch (e) {
        console.error("Firebase initialization error:", e);
        console.error("Please ensure your Firebase project is set up correctly and that the environment variables in your deployment configuration match your Firebase project's web app configuration.");
    }
} else if (getApps().length > 0) {
    app = getApp();
    auth = getAuth(app);
    db = getFirestore(app);
}

// This is the function that other parts of the app will call.
export const getFirebaseServices = () => {
    // This check is mainly for server-side rendering scenarios, where these services aren't available.
    if (typeof window === "undefined") {
        return { app: null, auth: null, db: null };
    }

    // If app is not initialized, it's because of missing env vars.
    if (!getApps().length) {
       if(!areAllVarsDefined){
           console.error("Firebase configuration is missing or incomplete. Check your deployment environment variables.");
       } else {
           // This case should ideally not be hit if the top-level logic is correct.
           app = initializeApp(firebaseConfig);
           auth = getAuth(app);
           db = getFirestore(app);
       }
    }

    return { app, auth, db };
};