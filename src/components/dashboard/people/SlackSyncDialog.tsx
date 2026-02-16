"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Slack, Loader2, Users } from "lucide-react";
import { useIntegrations } from "@/contexts/IntegrationsContext";
import { useToast } from "@/hooks/use-toast";
import { pollJobUntilDone } from "@/lib/job-client";
import { cn } from "@/lib/utils";

type SlackSyncUser = {
  id: string;
  name: string;
  realName: string;
  email?: string;
  image?: string;
};

type SlackSyncDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSynced?: (result: { created: number; updated: number }) => void;
};

const getInitials = (name: string | null | undefined) => {
  if (!name) return "U";
  return name.split(" ").map((part: any) => part[0]).join("").toUpperCase().substring(0, 2);
};

export default function SlackSyncDialog({ isOpen, onClose, onSynced }: SlackSyncDialogProps) {
  const { isSlackConnected } = useIntegrations();
  const { toast } = useToast();
  const [isFetchingSlackUsers, setIsFetchingSlackUsers] = useState(false);
  const [isSyncingSlack, setIsSyncingSlack] = useState(false);
  const [slackUsers, setSlackUsers] = useState<SlackSyncUser[]>([]);
  const [slackUserSearch, setSlackUserSearch] = useState("");
  const [selectedSlackUserIds, setSelectedSlackUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setSlackUserSearch("");
      setSlackUsers([]);
      setSelectedSlackUserIds(new Set());
      setIsFetchingSlackUsers(false);
      setIsSyncingSlack(false);
      return;
    }

    if (!isSlackConnected) {
      toast({
        title: "Slack not connected",
        description: "Connect Slack in Settings before syncing.",
        variant: "destructive",
      });
      onClose();
      return;
    }

    const fetchSlackUsers = async () => {
      setIsFetchingSlackUsers(true);
      try {
        const response = await fetch("/api/slack/users");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Could not load Slack users.");
        }
        const fetchedUsers = (data.users || [])
          .filter((member: SlackSyncUser) => Boolean(member.email))
          .sort((a: SlackSyncUser, b: SlackSyncUser) => {
            const nameA = (a.realName || a.name || "").toLowerCase();
            const nameB = (b.realName || b.name || "").toLowerCase();
            return nameA.localeCompare(nameB);
          });
        setSlackUsers(fetchedUsers);
        setSelectedSlackUserIds(new Set(fetchedUsers.map((member: SlackSyncUser) => member.id)));
      } catch (error: any) {
        console.error("Failed to fetch Slack users:", error);
        toast({
          title: "Error Fetching Slack Users",
          description: error.message || "Could not load Slack users.",
          variant: "destructive",
        });
        setSlackUsers([]);
        setSelectedSlackUserIds(new Set());
      } finally {
        setIsFetchingSlackUsers(false);
      }
    };

    fetchSlackUsers();
  }, [isOpen, isSlackConnected, onClose, toast]);

  const filteredSlackUsers = useMemo(() => {
    const term = slackUserSearch.trim().toLowerCase();
    if (!term) return slackUsers;
    return slackUsers.filter((user: any) =>
      [user.realName, user.name, user.email].some((value: any) =>
        value?.toLowerCase().includes(term)
      )
    );
  }, [slackUserSearch, slackUsers]);

  const isAllVisibleSlackSelected =
    filteredSlackUsers.length > 0 &&
    filteredSlackUsers.every((user) => selectedSlackUserIds.has(user.id));

  const setSlackUserSelection = (userId: string, isSelected: boolean) => {
    setSelectedSlackUserIds((prev) => {
      const next = new Set(prev);
      if (isSelected) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const handleSelectAllSlackVisible = (checked: boolean) => {
    setSelectedSlackUserIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        filteredSlackUsers.forEach((user: any) => next.add(user.id));
      } else {
        filteredSlackUsers.forEach((user: any) => next.delete(user.id));
      }
      return next;
    });
  };

  const handleConfirmSlackSync = async () => {
    if (!selectedSlackUserIds.size) {
      toast({
        title: "No users selected",
        description: "Choose at least one Slack user to sync.",
        variant: "destructive",
      });
      return;
    }
    setIsSyncingSlack(true);
    try {
      const response = await fetch("/api/slack/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedIds: Array.from(selectedSlackUserIds),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Slack sync failed.");
      }
      const result = data.jobId
        ? ((await pollJobUntilDone(data.jobId)).result as { created?: number; updated?: number } | null)
        : (data as { created?: number; updated?: number });
      const created = result?.created || 0;
      const updated = result?.updated || 0;
      toast({
        title: "Slack users synced",
        description: `Added ${created} and updated ${updated} people.`,
      });
      onSynced?.({ created, updated });
      onClose();
    } catch (error: any) {
      toast({
        title: "Slack sync failed",
        description: error.message || "Could not sync Slack users.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingSlack(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSyncingSlack) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl z-[260]" overlayClassName="z-[250]">
        <DialogHeader>
          <DialogTitle>Sync Slack Users</DialogTitle>
          <DialogDescription>
            Choose which Slack users to add or update in your people directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={isAllVisibleSlackSelected}
                onCheckedChange={(checked) => handleSelectAllSlackVisible(Boolean(checked))}
                disabled={filteredSlackUsers.length === 0}
              />
              <span>{slackUserSearch.trim() ? "Select visible" : "Select all"}</span>
              {slackUsers.length > 0 && (
                <Badge variant="secondary">
                  {selectedSlackUserIds.size} / {slackUsers.length} selected
                </Badge>
              )}
            </div>
            <Input
              placeholder="Search Slack users..."
              value={slackUserSearch}
              onChange={(event) => setSlackUserSearch(event.target.value)}
              className="sm:max-w-xs"
            />
          </div>
          <div className="rounded-lg border bg-muted/20">
            <ScrollArea className="h-[360px]">
              <div className="p-3 space-y-2">
                {isFetchingSlackUsers ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading Slack users...
                  </div>
                ) : slackUsers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
                    <Users className="h-8 w-8 mb-2" />
                    <p>No Slack users with email found.</p>
                  </div>
                ) : filteredSlackUsers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
                    <Users className="h-8 w-8 mb-2" />
                    <p>No Slack users match this search.</p>
                  </div>
                ) : (
                  filteredSlackUsers.map((member: any) => {
                    const displayName = member.realName || member.name;
                    const isSelected = selectedSlackUserIds.has(member.id);
                    return (
                      <div
                        key={member.id}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border bg-background px-3 py-2 transition hover:border-primary/40",
                          isSelected && "border-primary bg-primary/5 shadow-sm"
                        )}
                      >
                        <Checkbox
                          id={`slack-sync-${member.id}`}
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            setSlackUserSelection(member.id, Boolean(checked))
                          }
                        />
                        <label
                          htmlFor={`slack-sync-${member.id}`}
                          className="flex flex-1 items-center gap-3 cursor-pointer"
                        >
                          <Avatar className="h-10 w-10 border">
                            <AvatarImage
                              src={
                                member.image ||
                                `https://api.dicebear.com/8.x/initials/svg?seed=${displayName}`
                              }
                              alt={displayName}
                            />
                            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{displayName}</p>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          </div>
                        </label>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
          <p className="text-xs text-muted-foreground">
            Only Slack users with an email are available to sync.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSyncingSlack}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmSlackSync}
            disabled={isSyncingSlack || isFetchingSlackUsers || selectedSlackUserIds.size === 0}
          >
            {isSyncingSlack ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Slack className="mr-2 h-4 w-4" />
            )}
            Sync Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

