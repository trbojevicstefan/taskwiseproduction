// src/components/dashboard/common/PushToTrelloDialog.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { TrelloBoard, TrelloList } from '@/lib/trelloAPI';

interface PushToTrelloDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: ExtractedTaskSchema[];
}

const extractErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    const message = payload?.message || payload?.error || payload?.details;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to generic message.
  }
  return fallback;
};

export default function PushToTrelloDialog({ isOpen, onClose, tasks }: PushToTrelloDialogProps) {
  const { isTrelloConnected } = useIntegrations();
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isFetchingBoards, setIsFetchingBoards] = useState(false);
  const [isFetchingLists, setIsFetchingLists] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const { toast } = useToast();

  const buildCardDescription = (task: ExtractedTaskSchema) => {
    const sections: string[] = [];
    if (task.description) sections.push(task.description);
    if (task.researchBrief) {
      sections.push(`AI Research Brief:\n${task.researchBrief}`);
    }
    if (task.aiAssistanceText) {
      sections.push(`AI Assistance:\n${task.aiAssistanceText}`);
    }
    return sections.join('\n\n');
  };

  const fetchBoards = useCallback(async () => {
    if (!isTrelloConnected) return;
    setIsFetchingBoards(true);
    try {
      const response = await fetch("/api/trello/boards");
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, "Failed to fetch Trello boards.")
        );
      }
      const payload = await response.json();
      const fetchedBoards = Array.isArray(payload?.boards) ? payload.boards : [];
      setBoards(fetchedBoards);
      if (fetchedBoards.length > 0) {
        setSelectedBoardId(fetchedBoards[0].id);
      }
    } catch (error: any) {
      console.error("Error fetching Trello boards:", error);
      toast({ title: 'Error', description: error.message || 'Failed to fetch Trello boards.', variant: 'destructive' });
    } finally {
      setIsFetchingBoards(false);
    }
  }, [isTrelloConnected, toast]);

  useEffect(() => {
    if (isOpen) {
      fetchBoards();
    }
  }, [isOpen, fetchBoards]);

  useEffect(() => {
    const fetchLists = async () => {
      if (selectedBoardId) {
        setIsFetchingLists(true);
        setLists([]);
        setSelectedListId(null);
        try {
            const params = new URLSearchParams({ boardId: selectedBoardId });
            const response = await fetch(`/api/trello/lists?${params.toString()}`);
            if (!response.ok) {
              throw new Error(
                await extractErrorMessage(response, "Failed to fetch Trello lists.")
              );
            }
            const payload = await response.json();
            const fetchedLists = Array.isArray(payload?.lists) ? payload.lists : [];
            setLists(fetchedLists);
            if (fetchedLists.length > 0) {
              setSelectedListId(fetchedLists[0].id);
            }
        } catch (error: any) {
            console.error("Error fetching Trello lists:", error);
            toast({ title: 'Error', description: error.message || 'Failed to fetch Trello lists.', variant: 'destructive' });
        } finally {
            setIsFetchingLists(false);
        }
      }
    };
    fetchLists();
  }, [selectedBoardId, toast]);

  const handlePush = async () => {
    if (!selectedListId) {
      toast({ title: 'No List Selected', variant: 'destructive' });
      return;
    }
    setIsPushing(true);
    toast({ title: 'Pushing to Trello...' });
    
    try {
        // Create one card for each root task. Subtasks become checklist items.
        for (const task of tasks) {
            const response = await fetch("/api/trello/cards", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                listId: selectedListId,
                name: task.title,
                desc: buildCardDescription(task),
                subtasks: task.subtasks || [],
              }),
            });
            if (!response.ok) {
              throw new Error(
                await extractErrorMessage(response, "Failed to create a Trello card.")
              );
            }
        }
      
      toast({ title: 'Success!', description: `${tasks.length} card(s) were pushed to Trello.` });
      onClose();
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error Pushing to Trello', description: error.message || 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setIsPushing(false);
    }
  };
  
  const handleDialogClose = () => {
    onClose();
    // Reset state when closing
    setTimeout(() => {
        setBoards([]);
        setLists([]);
        setSelectedBoardId(null);
        setSelectedListId(null);
    }, 300);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to Trello</DialogTitle>
          <DialogDescription>
            Select a Trello board and list to send {tasks.length} task(s) to.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trello-board">Board</Label>
            <Select value={selectedBoardId || ''} onValueChange={setSelectedBoardId} disabled={isFetchingBoards}>
              <SelectTrigger id="trello-board">
                <SelectValue placeholder={isFetchingBoards ? "Loading boards..." : "Select a board"} />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board: any) => (
                  <SelectItem key={board.id} value={board.id}>{board.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trello-list">List</Label>
            <Select value={selectedListId || ''} onValueChange={setSelectedListId} disabled={isFetchingLists || !selectedBoardId}>
              <SelectTrigger id="trello-list">
                <SelectValue placeholder={isFetchingLists ? "Loading lists..." : "Select a list"} />
              </SelectTrigger>
              <SelectContent>
                {lists.map((list: any) => (
                  <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleDialogClose} disabled={isPushing}>Cancel</Button>
          <Button onClick={handlePush} disabled={isFetchingBoards || isFetchingLists || isPushing || !selectedListId}>
            {isPushing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Push to Trello
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

