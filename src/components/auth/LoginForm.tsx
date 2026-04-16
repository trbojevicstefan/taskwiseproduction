// src/components/auth/LoginForm.tsx
"use client";

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isGoogleProviderAvailable, setIsGoogleProviderAvailable] = useState<boolean | null>(null);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") || "/meetings";
  const authErrorCode = searchParams?.get("error") || null;

  useEffect(() => {
    let active = true;

    const loadProviders = async () => {
      try {
        const response = await fetch("/api/auth/providers", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        setIsGoogleProviderAvailable(Boolean(payload?.google));
      } catch {
        if (!active) return;
        setIsGoogleProviderAvailable(false);
      }
    };

    void loadProviders();
    return () => {
      active = false;
    };
  }, []);

  const oauthErrorMessage = useMemo(() => {
    if (!authErrorCode) return null;

    const code = authErrorCode.trim();
    if (!code) return null;

    if (code === "google") {
      return "Google login is not available. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local and restart the dev server.";
    }
    if (code === "OAuthSignin") {
      return "Google OAuth could not start. Verify Google OAuth app settings and local callback URL.";
    }
    if (code === "OAuthCallback") {
      return "Google OAuth callback failed. Ensure Google Cloud allows http://localhost:9002/api/auth/callback/google and NEXTAUTH_URL matches your local URL.";
    }
    if (code === "Callback") {
      return "Auth callback failed. Verify MongoDB connectivity and OAuth callback settings, then retry.";
    }
    if (code === "AccessDenied") {
      return "Google login was canceled or denied.";
    }
    if (code === "Configuration") {
      return "Auth configuration error. Verify NEXTAUTH_URL, NEXTAUTH_SECRET, and Google OAuth credentials.";
    }
    return `Google login failed (${code}).`;
  }, [authErrorCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      // AuthProvider handles redirection
    } catch (err) {
      setError("Failed to login. Please check your credentials.");
      console.error(err);
    }
  };

  return (
    <Card className="w-full shadow-2xl bg-black/30 border-white/10 text-white backdrop-blur-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back!</CardTitle>
        <CardDescription className="text-white/70">Enter your credentials to access your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="bg-white/5 border-white/20 focus:ring-primary"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="bg-white/5 border-white/20 focus:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white shadow-lg hover:opacity-90 transition-opacity" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Login"}
          </Button>
        </form>
        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            className="w-full border-white/20 text-white hover:bg-white/10"
            disabled={loading || isGoogleProviderAvailable === false}
            onClick={() => signIn("google", { callbackUrl })}
          >
            {isGoogleProviderAvailable === false
              ? "Google Login Not Configured"
              : "Continue with Google"}
          </Button>
          {oauthErrorMessage ? (
            <p className="mt-2 text-xs text-red-300">{oauthErrorMessage}</p>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-white/60">
          Don't have an account?{' '}
          <Link
            href={
              callbackUrl
                ? `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`
                : "/signup"
            }
            className="font-medium text-primary hover:text-primary/80"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
