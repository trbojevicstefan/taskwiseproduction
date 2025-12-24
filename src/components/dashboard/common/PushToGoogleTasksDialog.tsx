// src/components/dashboard/common/PushToGoogleTasksDialog.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, PlusCircle, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { getTaskLists, createTaskList, pushTasksToGoogle, type GoogleTaskList } from '@/lib/googleTasksAPI';
import type { ExtractedTaskSchema } from '@/types/chat';

interface PushToGoogleTasksDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: ExtractedTaskSchema[];
}

export default function PushToGoogleTasksDialog({ isOpen, onClose, tasks }: PushToGoogleTasksDialogProps) {
  const { getValidGoogleAccessToken, isGoogleTasksConnected } = useIntegrations();
  const [taskLists, setTaskLists] = useState<GoogleTaskList[]>([]);
  const [selectedTaskListId, setSelectedTaskListId] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [showNewListForm, setShowNewListForm] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchLists = async () => {
      if (isOpen && isGoogleTasksConnected) {
        setIsFetching(true);
        const accessToken = await getValidGoogleAccessToken();
        if (!accessToken) {
          toast({ title: 'Authentication Error', description: 'Could not get Google access token.', variant: 'destructive' });
          setIsFetching(false);
          return;
        }
        try {
          const lists = await getTaskLists(accessToken);
          setTaskLists(lists);
          if (lists.length > 0) {
            setSelectedTaskListId(lists[0].id);
          } else {
            setShowNewListForm(true); // If no lists, prompt to create one
          }
        } catch (error) {
          console.error(error);
          toast({ title: 'Error', description: 'Failed to fetch Google Task lists.', variant: 'destructive' });
        } finally {
          setIsFetching(false);
        }
      }
    };
    fetchLists();
  }, [isOpen, isGoogleTasksConnected, getValidGoogleAccessToken, toast]);

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    setIsCreatingList(true);
    const accessToken = await getValidGoogleAccessToken();
    if (!accessToken) {
      toast({ title: 'Authentication Error', variant: 'destructive' });
      setIsCreatingList(false);
      return;
    }
    try {
      const newLlist = await createTaskList(accessToken, newListName);
      setTaskLists(prev => [newLlist, ...prev]);
      setSelectedTaskListId(newLlist.id);
      setNewListName('');
      setShowNewListForm(false);
      toast({ title: 'Success', description: `Task list "${newLlist.title}" created.` });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to create new task list.', variant: 'destructive' });
    } finally {
      setIsCreatingList(false);
    }
  };

  const handlePush = async () => {
    if (!selectedTaskListId) {
      toast({ title: 'No List Selected', variant: 'destructive' });
      return;
    }
    setIsPushing(true);
    toast({ title: 'Pushing to Google Tasks...' });
    
    const accessToken = await getValidGoogleAccessToken();
    if (!accessToken) {
      toast({ title: 'Authentication Error', variant: 'destructive' });
      setIsPushing(false);
      return;
    }

    try {
      const { success, createdCount } = await pushTasksToGoogle(accessToken, selectedTaskListId, tasks);
      if (success) {
        toast({ title: 'Success!', description: `${createdCount} tasks and subtasks were pushed to Google Tasks.` });
        onClose();
      } else {
        throw new Error('Push operation failed silently.');
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error Pushing Tasks', description: error.message || 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to Google Tasks</DialogTitle>
          <DialogDescription>
            Select a Google Task list to send {tasks.length} task branch(es) to.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-list">Task List</Label>
            <Select
              value={selectedTaskListId || ''}
              onValueChange={setSelectedTaskListId}
              disabled={isFetching || showNewListForm}
            >
              <SelectTrigger id="task-list">
                <SelectValue placeholder={isFetching ? "Loading lists..." : "Select a list"} />
              </SelectTrigger>
              <SelectContent>
                {taskLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>{list.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showNewListForm ? (
            <div className="space-y-2 p-4 border rounded-md">
              <Label htmlFor="new-list-name">New Task List Name</Label>
              <div className="flex gap-2">
                <Input
                  id="new-list-name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g., 'Project Phoenix'"
                />
                <Button onClick={handleCreateList} disabled={isCreatingList || !newListName.trim()}>
                  {isCreatingList ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowNewListForm(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create New List
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPushing}>Cancel</Button>
          <Button onClick={handlePush} disabled={isFetching || isPushing || !selectedTaskListId}>
            {isPushing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Push Tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
