// src/contexts/IntegrationsContext.tsx
"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { signIn } from "next-auth/react";
import { GOOGLE_INTEGRATION_USER_COOKIE } from "@/lib/integration-cookies";

export interface ClientSideGoogleTokenInfo {
  accessToken: string;
  expiryDate: string;
  scope?: string;
  tokenType?: string;
  lastUpdated?: string;
  userId: string;
}

export interface TrelloTokenInfo {
  accessToken: string;
  tokenSecret: string;
  lastUpdated: string;
}

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  botUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

interface IntegrationsContextType {
  googleTokenInfo: ClientSideGoogleTokenInfo | null;
  isGoogleTasksConnected: boolean;
  isLoadingGoogleConnection: boolean;
  connectGoogleTasks: () => Promise<void>;
  disconnectGoogleTasks: () => Promise<void>;
  getValidGoogleAccessToken: () => Promise<string | null>;
  triggerTokenFetch: () => Promise<void>;
  isTrelloConnected: boolean;
  isLoadingTrelloConnection: boolean;
  trelloToken: TrelloTokenInfo | null;
  connectTrello: () => void;
  disconnectTrello: () => Promise<void>;
  isSlackConnected: boolean;
  isLoadingSlackConnection: boolean;
  slackInstallation: SlackInstallation | null;
  connectSlack: () => void;
  disconnectSlack: () => Promise<void>;
  isFathomConnected: boolean;
  isLoadingFathomConnection: boolean;
  connectFathom: () => void;
  disconnectFathom: () => Promise<void>;
}

const IntegrationsContext = createContext<IntegrationsContextType | undefined>(undefined);

export const IntegrationsProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { user, loading, refreshUserProfile } = useAuth();
  const [googleTokenInfo, setGoogleTokenInfo] = useState<ClientSideGoogleTokenInfo | null>(null);
  const [trelloToken] = useState<TrelloTokenInfo | null>(null);
  const [slackInstallation, setSlackInstallation] = useState<SlackInstallation | null>(null);
  const [isLoadingSlackConnection, setIsLoadingSlackConnection] = useState(true);
  const [isLoadingFathomConnection, setIsLoadingFathomConnection] = useState(true);
  const [isLoadingGoogleConnection, setIsLoadingGoogleConnection] = useState(true);
  const workspaceSlack = user?.workspaceIntegrations?.slack;
  const workspaceGoogle = user?.workspaceIntegrations?.google;
  const workspaceFathom = user?.workspaceIntegrations?.fathom;
  const slackManagedByWorkspace =
    Boolean(workspaceSlack?.connected) && !workspaceSlack?.connectedByCurrentUser;
  const googleManagedByWorkspace =
    Boolean(workspaceGoogle?.connected) && !workspaceGoogle?.connectedByCurrentUser;
  const fathomManagedByWorkspace =
    Boolean(workspaceFathom?.connected) && !workspaceFathom?.connectedByCurrentUser;

  const warnDisabled = useCallback(() => {
    toast({
      title: "Integrations Disabled",
      description: "Integrations are paused during the Mongo migration.",
      variant: "destructive",
    });
  }, [toast]);

  const connectGoogleTasks = async () => {
    if (!user?.uid) {
      toast({
        title: "Sign-in Required",
        description: "Please sign in before connecting Google.",
        variant: "destructive",
      });
      return;
    }
    const cookieParts = [
      `${GOOGLE_INTEGRATION_USER_COOKIE}=${encodeURIComponent(user.uid)}`,
      "Path=/",
      "Max-Age=600",
      "SameSite=Lax",
    ];
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
      cookieParts.push("Secure");
    }
    document.cookie = cookieParts.join("; ");
    await signIn("google-integration", { callbackUrl: "/settings?google_success=true" });
  };

  const disconnectGoogleTasks = async () => {
    if (googleManagedByWorkspace && !user?.googleConnected) {
      toast({
        title: "Managed by Workspace",
        description: "Google integration is connected by another workspace admin.",
      });
      return;
    }
    try {
      await fetch("/api/google/revoke", { method: "POST" });
      await refreshUserProfile();
      setGoogleTokenInfo(null);
    } catch (error) {
      console.error("Failed to disconnect Google:", error);
      toast({
        title: "Google Disconnect Failed",
        description: "Could not disconnect Google. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getValidGoogleAccessToken = useCallback(async () => {
    try {
      const response = await fetch("/api/google/token");
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      if (!data?.accessToken) {
        return null;
      }
      setGoogleTokenInfo((prev) => ({
        accessToken: data.accessToken,
        expiryDate: prev?.expiryDate || new Date().toISOString(),
        scope: prev?.scope,
        tokenType: prev?.tokenType,
        lastUpdated: new Date().toISOString(),
        userId: user?.uid || "",
      }));
      return data.accessToken as string;
    } catch (error) {
      console.error("Failed to fetch Google access token:", error);
      return null;
    }
  }, [user?.uid]);
  const connectTrello = () => warnDisabled();
  const disconnectTrello = async () => warnDisabled();
  const connectSlack = () => {
    window.location.href = "/api/slack/oauth/start";
  };
  const disconnectSlack = async () => {
    if (slackManagedByWorkspace && !user?.slackTeamId) {
      toast({
        title: "Managed by Workspace",
        description: "Slack integration is connected by another workspace admin.",
      });
      return;
    }
    try {
      await fetch("/api/slack/revoke", { method: "POST" });
      await refreshUserProfile();
      setSlackInstallation(null);
    } catch (error) {
      console.error("Failed to disconnect Slack:", error);
      toast({
        title: "Slack Disconnect Failed",
        description: "Could not disconnect Slack. Please try again.",
        variant: "destructive",
      });
    }
  };

  const connectFathom = () => {
    window.location.href = "/api/fathom/oauth/start";
  };

  const disconnectFathom = async () => {
    if (fathomManagedByWorkspace && !user?.fathomConnected) {
      toast({
        title: "Managed by Workspace",
        description: "Fathom integration is connected by another workspace admin.",
      });
      return;
    }
    try {
      await fetch("/api/fathom/revoke", { method: "POST" });
      await refreshUserProfile();
    } catch (error) {
      console.error("Failed to disconnect Fathom:", error);
      toast({
        title: "Fathom Disconnect Failed",
        description: "Could not disconnect Fathom. Please try again.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    setIsLoadingSlackConnection(loading);
    setIsLoadingFathomConnection(loading);
    setIsLoadingGoogleConnection(loading);
    if (!loading && user?.slackTeamId) {
      setSlackInstallation({
        teamId: user.slackTeamId,
        teamName: "",
        botUserId: "",
        accessToken: "",
        refreshToken: "",
        expiresAt: 0,
        scope: "",
      });
    }
    if (!loading && !user?.slackTeamId) {
      setSlackInstallation(null);
    }
  }, [loading, user?.slackTeamId]);

  const triggerTokenFetch = async () => {
    await refreshUserProfile();
  };

  return (
    <IntegrationsContext.Provider value={{
      googleTokenInfo,
      isGoogleTasksConnected: Boolean(user?.googleConnected || workspaceGoogle?.connected),
      isLoadingGoogleConnection,
      connectGoogleTasks,
      disconnectGoogleTasks,
      getValidGoogleAccessToken,
      triggerTokenFetch,
      isTrelloConnected: false,
      isLoadingTrelloConnection: false,
      trelloToken,
      connectTrello,
      disconnectTrello,
      isSlackConnected: Boolean(user?.slackTeamId || workspaceSlack?.connected),
      isLoadingSlackConnection,
      slackInstallation,
      connectSlack,
      disconnectSlack,
      isFathomConnected: Boolean(user?.fathomConnected || workspaceFathom?.connected),
      isLoadingFathomConnection,
      connectFathom,
      disconnectFathom,
    }}>
      {children}
    </IntegrationsContext.Provider>
  );
};

export const useIntegrations = () => {
  const context = useContext(IntegrationsContext);
  if (context === undefined) {
    throw new Error('useIntegrations must be used within an IntegrationsProvider');
  }
  return context;
};
