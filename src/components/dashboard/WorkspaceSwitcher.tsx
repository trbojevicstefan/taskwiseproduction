"use client";

import { useMemo, useState, useEffect } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { buildWorkspaceRoute } from "@/components/dashboard/workspace-route";

export const WorkspaceSwitcher = () => {
  const { user, switchWorkspace } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);

  const memberships = useMemo(
    () =>
      (user?.workspaceMemberships || [])
        .filter((membership) => membership.status === "active")
        .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName)),
    [user?.workspaceMemberships]
  );

  const activeWorkspaceId = user?.activeWorkspaceId || user?.workspace?.id || null;
  const activeWorkspaceName =
    user?.workspace?.name ||
    memberships.find((membership) => membership.workspaceId === activeWorkspaceId)?.workspaceName ||
    "Workspace";

  useEffect(() => {
    if (!activeWorkspaceId || !pathname?.startsWith("/workspaces/")) return;
    const segments = pathname.split("/");
    const routeWorkspaceId = segments.length >= 3 ? segments[2] : null;
    if (!routeWorkspaceId || routeWorkspaceId === activeWorkspaceId) return;
    const nextPath = buildWorkspaceRoute(pathname, activeWorkspaceId);
    const query = searchParams?.toString() || "";
    router.replace(query ? `${nextPath}?${query}` : nextPath);
  }, [activeWorkspaceId, pathname, router, searchParams]);

  const onSwitchWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspaceId || pendingWorkspaceId) return;

    setPendingWorkspaceId(workspaceId);
    try {
      await switchWorkspace(workspaceId);
      const nextPath = buildWorkspaceRoute(pathname, workspaceId);
      const query = searchParams?.toString() || "";
      router.replace(query ? `${nextPath}?${query}` : nextPath);
      router.refresh();
      toast({
        title: "Workspace switched",
        description: "Your active workspace has been updated.",
      });
    } catch (error) {
      toast({
        title: "Switch failed",
        description:
          error instanceof Error ? error.message : "Could not switch workspace.",
        variant: "destructive",
      });
    } finally {
      setPendingWorkspaceId(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[220px] justify-between gap-2">
          <span className="truncate">{activeWorkspaceName}</span>
          {pendingWorkspaceId ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.length ? (
          memberships.map((membership) => {
            const selected = membership.workspaceId === activeWorkspaceId;
            return (
              <DropdownMenuItem
                key={membership.membershipId}
                onClick={() => onSwitchWorkspace(membership.workspaceId)}
                disabled={Boolean(pendingWorkspaceId)}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="truncate">{membership.workspaceName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{membership.role}</p>
                </div>
                {selected ? <Check className="h-4 w-4" /> : null}
              </DropdownMenuItem>
            );
          })
        ) : (
          <DropdownMenuItem disabled>No active workspaces</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default WorkspaceSwitcher;
