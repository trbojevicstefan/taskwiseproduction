// src/contexts/AuthContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { signIn, signOut, useSession } from "next-auth/react";
import type { Person } from '@/types/person';

export interface Workspace {
  name: string;
}

export interface AppUser extends Person {
  uid: string;
  plan?: string;
  orgId?: string;
  tz?: string;
  firefliesWebhookToken?: string | null;
  workspace?: Workspace;
  onboardingCompleted?: boolean;
  slackTeamId?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  taskGranularityPreference?: 'light' | 'medium' | 'detailed';
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email?: string, password?: string) => Promise<void>;
  signup: (email?: string, password?: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (data: Partial<Omit<AppUser, 'id' | 'uid' | 'email' | 'createdAt' | 'plan' | 'orgId' | 'tz' | 'firefliesWebhookToken'>>, avoidGlobalLoading?: boolean) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

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

  // This separate effect handles redirection based on the final, stable state of `user` and `loading`.
  useEffect(() => {
    // Do not redirect while the initial auth check is running.
    if (loading) {
      return;
    }

    const isAuthPage = pathname === '/login' || pathname === '/signup';
    const isHomePage = pathname === '/';

    if (user && (isAuthPage || isHomePage)) {
      // If user is logged in and on an auth or home page, redirect them away.
      router.push('/meetings');
    } else if (!user && !isAuthPage) {
      // If user is not logged in and not on an auth page, redirect to login.
      router.push('/login');
    }
  }, [user, loading, pathname, router]);

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

  const updateUserProfile = async (data: Partial<Omit<AppUser, 'id' | 'uid' | 'email'>>, avoidGlobalLoading = false) => {
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
    <AuthContext.Provider value={{ user, loading, login, signup, logout, updateUserProfile, completeOnboarding, refreshUserProfile }}>
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
