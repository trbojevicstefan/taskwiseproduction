// src/contexts/IntegrationsContext.tsx
"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

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
  const [googleTokenInfo] = useState<ClientSideGoogleTokenInfo | null>(null);
  const [trelloToken] = useState<TrelloTokenInfo | null>(null);
  const [slackInstallation, setSlackInstallation] = useState<SlackInstallation | null>(null);
  const [isLoadingSlackConnection, setIsLoadingSlackConnection] = useState(true);
  const [isLoadingFathomConnection, setIsLoadingFathomConnection] = useState(true);

  const warnDisabled = useCallback(() => {
    toast({
      title: "Integrations Disabled",
      description: "Integrations are paused during the Mongo migration.",
      variant: "destructive",
    });
  }, [toast]);

  const connectGoogleTasks = async () => warnDisabled();
  const disconnectGoogleTasks = async () => warnDisabled();
  const getValidGoogleAccessToken = async () => null;
  const connectTrello = () => warnDisabled();
  const disconnectTrello = async () => warnDisabled();
  const connectSlack = () => {
    window.location.href = "/api/slack/oauth/start";
  };
  const disconnectSlack = async () => {
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
      isGoogleTasksConnected: false,
      isLoadingGoogleConnection: false,
      connectGoogleTasks,
      disconnectGoogleTasks,
      getValidGoogleAccessToken,
      triggerTokenFetch,
      isTrelloConnected: false,
      isLoadingTrelloConnection: false,
      trelloToken,
      connectTrello,
      disconnectTrello,
      isSlackConnected: Boolean(user?.slackTeamId),
      isLoadingSlackConnection,
      slackInstallation,
      connectSlack,
      disconnectSlack,
      isFathomConnected: Boolean(user?.fathomConnected),
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
