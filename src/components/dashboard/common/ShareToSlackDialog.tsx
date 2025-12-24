// src/components/dashboard/common/ShareToSlackDialog.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ExtractedTaskSchema } from '@/types/chat';

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackUser {
  id: string;
  name: string;
  realName: string;
  email?: string;
}

interface ShareToSlackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: ExtractedTaskSchema[];
  sessionTitle: string;
}

export default function ShareToSlackDialog({ isOpen, onClose, tasks, sessionTitle }: ShareToSlackDialogProps) {
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [destinationType, setDestinationType] = useState<'channel' | 'person'>('channel');
  const [customMessage, setCustomMessage] = useState('');
  const [includeBriefs, setIncludeBriefs] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingChannels, setIsFetchingChannels] = useState(false);
  const [isFetchingUsers, setIsFetchingUsers] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      const fetchChannels = async () => {
        setIsFetchingChannels(true);
        try {
          const response = await fetch("/api/slack/channels");
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Could not load your Slack channels.");
          }
          const fetchedChannels = data.channels || [];

          setChannels(fetchedChannels);
          if (fetchedChannels.length > 0) {
            setSelectedChannel(fetchedChannels[0].id);
          }
        } catch (error: any) {
          console.error("Failed to fetch Slack channels:", error);
          toast({
            title: "Error Fetching Channels",
            description: error.message || "Could not load your Slack channels.",
            variant: "destructive",
          });
        } finally {
          setIsFetchingChannels(false);
        }
      };
      const fetchUsers = async () => {
        setIsFetchingUsers(true);
        try {
          const response = await fetch("/api/slack/users");
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Could not load Slack users.");
          }
          const fetchedUsers = data.users || [];
          setUsers(fetchedUsers);
          if (fetchedUsers.length > 0) {
            setSelectedUser(fetchedUsers[0].id);
          }
        } catch (error: any) {
          console.error("Failed to fetch Slack users:", error);
          toast({
            title: "Error Fetching Users",
            description: error.message || "Could not load Slack users.",
            variant: "destructive",
          });
        } finally {
          setIsFetchingUsers(false);
        }
      };
      fetchChannels();
      fetchUsers();
    }
  }, [isOpen, toast]);

  const handleShare = async () => {
    if (destinationType === "channel" && !selectedChannel) {
      toast({ title: "No channel selected", variant: "destructive" });
      return;
    }
    if (destinationType === "person" && !selectedUser) {
      toast({ title: "No person selected", variant: "destructive" });
      return;
    }
    if (tasks.length === 0) {
      toast({ title: "No tasks to share", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    toast({ title: "Sharing to Slack..." });

    try {
        const response = await fetch("/api/slack/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tasks,
            channelId: destinationType === "channel" ? selectedChannel : undefined,
            userId: destinationType === "person" ? selectedUser : undefined,
            customMessage,
            sourceTitle: sessionTitle,
            includeAiContent: includeBriefs,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unknown error occurred.");
        }
        if (destinationType === "channel") {
          const channelName = channels.find((c) => c.id === selectedChannel)?.name;
          toast({
            title: "Shared to Slack!",
            description: channelName
              ? `Tasks were posted to #${channelName}.`
              : "Tasks were posted to Slack.",
          });
        } else {
          const userName = users.find((u) => u.id === selectedUser)?.realName;
          toast({
            title: "Shared to Slack!",
            description: userName
              ? `Tasks were sent to ${userName}.`
              : "Tasks were sent via Slack.",
          });
        }
        onClose();
    } catch (error: any) {
      console.error("Failed to share to Slack:", error);
      toast({
        title: "Error Sharing to Slack",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Tasks to Slack</DialogTitle>
          <DialogDescription>
            Select a channel and add an optional message to share {tasks.length} task(s).
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slack-destination">Share to</Label>
            <Select
              value={destinationType}
              onValueChange={(value) => setDestinationType(value as 'channel' | 'person')}
            >
              <SelectTrigger id="slack-destination">
                <SelectValue placeholder="Select destination..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="channel">Slack Channel</SelectItem>
                <SelectItem value="person">Slack Person (DM)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="slack-channel">
              {destinationType === "channel" ? "Channel" : "Person"}
            </Label>
            {destinationType === "channel" ? (
              <Select
                value={selectedChannel || ''}
                onValueChange={setSelectedChannel}
                disabled={isFetchingChannels}
              >
                <SelectTrigger id="slack-channel">
                  <SelectValue placeholder={isFetchingChannels ? "Loading channels..." : "Select a channel..."} />
                </SelectTrigger>
                <SelectContent>
                  {isFetchingChannels ? (
                      <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
                      </div>
                  ) : (
                      channels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          # {channel.name}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={selectedUser || ''}
                onValueChange={setSelectedUser}
                disabled={isFetchingUsers}
              >
                <SelectTrigger id="slack-user">
                  <SelectValue placeholder={isFetchingUsers ? "Loading people..." : "Select a person..."} />
                </SelectTrigger>
                <SelectContent>
                  {isFetchingUsers ? (
                      <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
                      </div>
                  ) : (
                      users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.realName} {user.email ? `(${user.email})` : ""}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-message">Optional Message</Label>
            <Textarea
              id="custom-message"
              placeholder="Add some context for your team..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-briefs"
              checked={includeBriefs}
              onCheckedChange={(checked) => setIncludeBriefs(Boolean(checked))}
            />
            <Label htmlFor="include-briefs" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Include AI Briefs & Assistance
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleShare}
            disabled={
              isLoading ||
              (destinationType === "channel" && (isFetchingChannels || !selectedChannel)) ||
              (destinationType === "person" && (isFetchingUsers || !selectedUser))
            }
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
