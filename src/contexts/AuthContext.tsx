// src/contexts/AuthContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { signIn, signOut, useSession } from "next-auth/react";
import type { Person } from '@/types/person';

export interface Workspace {
  id: string;
  name: string;
}

export interface WorkspaceMembershipSummary {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "suspended" | "left";
  isActive: boolean;
  joinedAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkspaceAdminAccess {
  tasks: boolean;
  people: boolean;
  projects: boolean;
  chatSessions: boolean;
  boards: boolean;
  integrations: boolean;
}

export interface WorkspaceIntegrationProviderSummary {
  connected: boolean;
  connectedByUserId: string | null;
  connectedByEmail: string | null;
  connectedByCurrentUser: boolean;
}

export interface WorkspaceIntegrationsSummary {
  slack: WorkspaceIntegrationProviderSummary;
  google: WorkspaceIntegrationProviderSummary;
  fathom: WorkspaceIntegrationProviderSummary;
}

export interface AppUser extends Person {
  uid: string;
  plan?: string;
  orgId?: string;
  tz?: string;
  firefliesWebhookToken?: string | null;
  workspace?: Workspace;
  activeWorkspaceId?: string | null;
  workspaceMemberships?: WorkspaceMembershipSummary[];
  onboardingCompleted?: boolean;
  slackTeamId?: string | null;
  fathomWebhookToken?: string | null;
  fathomConnected?: boolean;
  fathomUserId?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  taskGranularityPreference?: 'light' | 'medium' | 'detailed';
  autoApproveCompletedTasks?: boolean;
  completionMatchThreshold?: number;
  slackAutoShareEnabled?: boolean;
  slackAutoShareChannelId?: string | null;
  googleConnected?: boolean;
  googleEmail?: string | null;
  activeWorkspaceRole?: "owner" | "admin" | "member" | null;
  activeWorkspaceAdminAccess?: WorkspaceAdminAccess | null;
  workspaceIntegrations?: WorkspaceIntegrationsSummary;
}

type UserProfileUpdate = Partial<
  Omit<
    AppUser,
    | "id"
    | "uid"
    | "email"
    | "createdAt"
    | "plan"
    | "orgId"
    | "tz"
    | "firefliesWebhookToken"
  >
> & {
  workspace?: {
    id?: string;
    name: string;
    settings?: {
      adminAccess?: Partial<WorkspaceAdminAccess>;
    };
  };
};

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email?: string, password?: string) => Promise<void>;
  signup: (email?: string, password?: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (data: UserProfileUpdate, avoidGlobalLoading?: boolean) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const ACTIVE_WORKSPACE_STORAGE_KEY = "taskwise.activeWorkspaceId";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fetchUserProfile = async () => {
    if (status !== "authenticated") {
      setUser(null);
      return;
    }
    const response = await fetch("/api/users/me", { cache: "no-store" });
    if (!response.ok) {
      setUser(null);
      return;
    }
    const profile = await response.json();
    setUser(profile as AppUser);
  };

  const refreshUserProfile = async () => {
    if (status === "authenticated") {
      await fetchUserProfile();
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    const nextWorkspaceId = workspaceId.trim();
    if (!nextWorkspaceId) {
      throw new Error("Workspace ID is required.");
    }
    if (!user) {
      throw new Error("Unauthorized");
    }

    const previousUser = user;
    const membership = user.workspaceMemberships?.find(
      (item) => item.workspaceId === nextWorkspaceId
    );
    if (membership) {
      setUser((current) =>
        current
          ? {
              ...current,
              activeWorkspaceId: nextWorkspaceId,
              workspace: {
                id: membership.workspaceId,
                name: membership.workspaceName,
              },
            }
          : current
      );
    }

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: nextWorkspaceId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not switch workspace.");
      }

      const activeWorkspaceId = payload?.activeWorkspaceId || nextWorkspaceId;
      const workspace = payload?.workspace;
      setUser((current) =>
        current
          ? {
              ...current,
              activeWorkspaceId,
              workspace: workspace?.id
                ? { id: workspace.id, name: workspace.name || current.workspace?.name || "Workspace" }
                : current.workspace,
            }
          : current
      );
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId);
      }
      await fetchUserProfile();
    } catch (error) {
      setUser(previousUser);
      throw error;
    }
  };

  useEffect(() => {
    let isActive = true;
    const run = async () => {
      if (status === "loading") {
        setLoading(true);
        return;
      }
      if (status === "authenticated") {
        try {
          const response = await fetch("/api/users/me", { cache: "no-store" });
          if (!response.ok) {
            if (isActive) setUser(null);
          } else {
            const profile = await response.json();
            if (isActive) setUser(profile as AppUser);
          }
        } catch (error) {
          console.error("Error loading user profile:", error);
          if (isActive) setUser(null);
        } finally {
          if (isActive) setLoading(false);
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    };
    run();
    return () => {
      isActive = false;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_WORKSPACE_STORAGE_KEY) return;
      const incomingWorkspaceId = typeof event.newValue === "string" ? event.newValue : null;
      if (!incomingWorkspaceId) return;
      if (incomingWorkspaceId === (user?.activeWorkspaceId || user?.workspace?.id || null)) {
        return;
      }
      void fetchUserProfile();
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [status, user?.activeWorkspaceId, user?.workspace?.id]);

  // This separate effect handles redirection based on the final, stable state of `user` and `loading`.
  useEffect(() => {
    // Do not redirect while the initial auth check is running.
    if (loading) {
      return;
    }

    const isAuthPage = pathname === '/login' || pathname === '/signup';
    const isInvitePage = pathname?.startsWith('/invite/');
    const isPublicPage =
      pathname === '/' ||
      pathname === '/privacy' ||
      pathname === '/terms' ||
      isInvitePage;

    if (user && isAuthPage) {
      const callbackUrl = searchParams?.get('callbackUrl');
      const safeCallbackUrl =
        callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
          ? callbackUrl
          : null;
      router.push(safeCallbackUrl || '/meetings');
    } else if (!user && !isAuthPage && !isPublicPage) {
      // Keep the homepage public; redirect to login only for protected pages.
      router.push('/login');
    }
  }, [user, loading, pathname, router, searchParams]);

  const login = async (email?: string, password?: string) => {
    if (!email || !password) throw new Error("Email and password are required.");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      throw new Error(result.error);
    }
  };

  const signup = async (email?: string, password?: string, displayName?: string) => {
    if (!email || !password) throw new Error("Email and password are required.");
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Sign up failed.");
    }
    await login(email, password);
  };

  const logout = async () => {
    try {
      await signOut({ redirect: false });
      setUser(null);
      // The redirection is now handled by the useEffect hook above
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const updateUserProfile = async (data: UserProfileUpdate, avoidGlobalLoading = false) => {
    if (!avoidGlobalLoading) {
      setLoading(true);
    }
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Profile update failed.");
      }
      const updated = await response.json();
      setUser(updated as AppUser);
    } catch (error) {
      console.error("Error updating user profile:", error);
      throw error;
    } finally {
      if (!avoidGlobalLoading) {
        setLoading(false);
      }
    }
  };

  const completeOnboarding = async () => {
    if (!user) return;
    try {
      setUser(prevUser => prevUser ? { ...prevUser, onboardingCompleted: true } : null);
      await updateUserProfile({ onboardingCompleted: true }, true);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      setUser(prevUser => prevUser ? { ...prevUser, onboardingCompleted: false } : null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        updateUserProfile,
        completeOnboarding,
        refreshUserProfile,
        switchWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
