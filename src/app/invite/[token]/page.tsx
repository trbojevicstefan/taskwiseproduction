"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type AcceptState = "idle" | "loading" | "success" | "error";

export default function WorkspaceInvitePage({
  params,
}: {
  params: { token: string } | Promise<{ token: string }>;
}) {
  const { user, loading, refreshUserProfile } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<AcceptState>("idle");
  const [message, setMessage] = useState<string>("");
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const hasAttempted = useRef(false);
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    Promise.resolve(params).then((resolved) => {
      setToken(resolved.token || "");
    });
  }, [params]);

  const callbackUrl = useMemo(
    () => (token ? `/invite/${encodeURIComponent(token)}` : "/meetings"),
    [token]
  );

  useEffect(() => {
    if (!token || loading || !user || hasAttempted.current) {
      return;
    }
    hasAttempted.current = true;

    const run = async () => {
      setState("loading");
      setMessage("");
      try {
        const response = await fetch(
          `/api/workspace-invitations/${encodeURIComponent(token)}/accept`,
          { method: "POST" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not accept invitation.");
        }

        const workspace = payload?.workspace || {};
        setWorkspaceName(workspace.name || "Workspace");
        setState("success");
        setMessage("Invitation accepted. You are now in the invited workspace.");
        await refreshUserProfile();
      } catch (error) {
        const nextMessage =
          error instanceof Error ? error.message : "Could not accept invitation.";
        setState("error");
        setMessage(nextMessage);
      }
    };

    void run();
  }, [token, loading, user, refreshUserProfile]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>The invitation token is missing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/meetings")}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="py-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Workspace Invitation
            </CardTitle>
            <CardDescription>
              Sign in or create an account to accept this invitation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                Sign In to Accept
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                Create Account to Accept
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "error" ? (
              <AlertCircle className="h-5 w-5 text-red-500" />
            ) : state === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            Workspace Invitation
          </CardTitle>
          <CardDescription>
            {state === "loading" || state === "idle"
              ? "Accepting invitation..."
              : state === "success"
                ? `Joined ${workspaceName || "workspace"} successfully.`
                : "Could not accept this invitation."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          <div className="flex gap-2">
            <Button onClick={() => router.push("/meetings")}>Go to Dashboard</Button>
            {state === "error" ? (
              <Button
                variant="outline"
                onClick={() => {
                  hasAttempted.current = false;
                  setState("idle");
                  setMessage("");
                }}
              >
                Try Again
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

