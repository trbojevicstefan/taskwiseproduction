// src/components/dashboard/planning/TaskDetailDialog.tsx
"use client";

import React, { useState, useEffect } from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Sparkles, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { generateTaskAssistance, type GenerateTaskAssistanceOutput } from '@/ai/flows/generate-task-assistance-flow';
import { generateResearchBrief, type GenerateResearchBriefOutput } from '@/ai/flows/generate-research-brief-flow';
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';

interface TaskDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  task: DisplayTask | null;
  onSave: (updatedTask: DisplayTask, options?: { close?: boolean }) => void;
}

export default function TaskDetailDialog({ isOpen, onClose, task, onSave }: TaskDetailDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<DisplayTask['priority']>('medium');
  const [status, setStatus] = useState<DisplayTask['status']>('todo');
  const [dueAt, setDueAt] = useState<Date | undefined>(undefined);
  const [researchBrief, setResearchBrief] = useState<string | null>(null);
  const [aiAssistanceText, setAiAssistanceText] = useState<string | null>(null);
  const [comments, setComments] = useState<DisplayTask['comments']>([]);
  const [newComment, setNewComment] = useState('');
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isGeneratingAssistance, setIsGeneratingAssistance] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setStatus(task.status || 'todo');
      setDueAt(task.dueAt ? (typeof task.dueAt === 'string' ? parseISO(task.dueAt) : new Date(task.dueAt)) : undefined);
      setResearchBrief(task.researchBrief || null);
      setAiAssistanceText(task.aiAssistanceText || null);
      setComments(task.comments || []);
      setNewComment('');
    } else {
      // Reset state when there's no task (e.g., dialog closes)
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setDueAt(undefined);
      setResearchBrief(null);
      setAiAssistanceText(null);
      setComments([]);
      setNewComment('');
    }
  }, [task, isOpen]);

  const buildUpdatedTask = (overrides: Partial<DisplayTask> = {}): DisplayTask => ({
    ...(task as DisplayTask),
    title,
    description,
    priority,
    status,
    dueAt: dueAt ? dueAt.toISOString() : null,
    researchBrief,
    aiAssistanceText,
    comments,
    ...overrides,
  });

  const handleGenerateBrief = async () => {
    if (!task) return;
    setIsGeneratingBrief(true);
    toast({ title: "Generating Research Brief...", description: "Please wait a moment." });
    try {
      const result: GenerateResearchBriefOutput = await generateResearchBrief({
        taskTitle: title,
        taskDescription: description,
      });
      setResearchBrief(result.researchBrief);
      onSave(buildUpdatedTask({ researchBrief: result.researchBrief }), { close: false });
      toast({ title: "Brief Generated!", description: "AI Research Brief is now available." });
    } catch (error) {
      console.error("Error generating research brief:", error);
      setResearchBrief("Failed to generate brief. Please try again.");
      toast({ title: "AI Error", description: "Could not generate research brief.", variant: "destructive" });
    } finally {
      setIsGeneratingBrief(false);
    }
  };
  
  const handleGenerateAssistance = async () => {
    if (!task) return;
    setIsGeneratingAssistance(true);
    setAiAssistanceText(''); // Clear previous assistance
    toast({ title: "Generating AI Assistance...", description: "Please wait a moment." });
    try {
      const result: GenerateTaskAssistanceOutput = await generateTaskAssistance({
        taskTitle: title,
        taskDescription: description,
      });
      setAiAssistanceText(result.assistanceMarkdown);
      onSave(buildUpdatedTask({ aiAssistanceText: result.assistanceMarkdown }), { close: false });
      toast({ title: "AI Assistance Ready!", description: "Suggestions are available in the 'AI Assistance' section." });
    } catch (error) {
      console.error("Error generating task assistance:", error);
      setAiAssistanceText("Failed to get assistance. Please try again.");
      toast({ title: "AI Error", description: "Could not get task assistance.", variant: "destructive" });
    } finally {
      setIsGeneratingAssistance(false);
    }
  };

  const handleSaveChanges = () => {
    if (!task) return;
    onSave(buildUpdatedTask());
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const nextComment = {
      id: globalThis.crypto?.randomUUID?.() || `comment_${Date.now()}`,
      text: newComment.trim(),
      createdAt: Date.now(),
      authorName: user?.displayName || user?.name || "You",
      authorId: user?.uid || null,
    };
    const nextComments = [...(comments || []), nextComment];
    setComments(nextComments);
    setNewComment('');
    onSave(buildUpdatedTask({ comments: nextComments }), { close: false });
  };
  
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
          <DialogDescription>
            View, edit, and enhance your task with AI-powered tools.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0">
          {/* Left Column for main content */}
          <ScrollArea className="md:col-span-2 pr-4 -mr-4">
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-6"
              >
                  <div className="space-y-2">
                      <Label htmlFor="title">Title</Label>
                      <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[100px]" placeholder="Add a more detailed description..."/>
                  </div>
                  <div className="space-y-3">
                      <Label>Comments</Label>
                      <div className="space-y-3">
                        {(comments || []).length === 0 && (
                          <p className="text-xs text-muted-foreground">No comments yet.</p>
                        )}
                        {(comments || []).map((comment) => (
                          <div key={comment.id} className="rounded-md border bg-muted/30 p-3 text-xs">
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span className="font-semibold text-foreground">
                                {comment.authorName || "Contributor"}
                              </span>
                              <span>{format(new Date(comment.createdAt), "MMM d, h:mm a")}</span>
                            </div>
                            <p className="mt-2 text-foreground whitespace-pre-wrap">{comment.text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Add a comment..."
                          className="min-h-[80px]"
                        />
                        <div className="flex justify-end">
                          <Button type="button" size="sm" onClick={handleAddComment} disabled={!newComment.trim()}>
                            Add Comment
                          </Button>
                        </div>
                      </div>
                  </div>
                  {task?.sourceEvidence && task.sourceEvidence.length > 0 && (
                    <div className="space-y-2">
                      <Label>Source Evidence</Label>
                      <div className="space-y-2">
                        {task.sourceEvidence.map((evidence, index) => (
                          <div key={`${task.id}-evidence-${index}`} className="rounded-md border bg-muted/30 p-3 text-xs">
                            <p className="font-semibold">
                              {evidence.speaker || "Speaker"}
                              {evidence.timestamp ? ` - ${evidence.timestamp}` : ""}
                            </p>
                            <p className="text-muted-foreground mt-1">{evidence.snippet}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-3">
                      <div className="flex justify-between items-center">
                          <Label htmlFor="ai-research-brief">AI Research Brief</Label>
                          <Button size="sm" variant="ghost" onClick={handleGenerateBrief} disabled={isGeneratingBrief}>
                              {isGeneratingBrief ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/> }
                              <span className="ml-2">Generate Brief</span>
                          </Button>
                      </div>
                      <Textarea id="ai-research-brief" value={researchBrief || ""} onChange={(e) => setResearchBrief(e.target.value)} className="min-h-[150px] bg-muted/30" placeholder="AI-generated research brief will appear here..."/>
                  </div>
                  <div className="space-y-3">
                       <div className="flex justify-between items-center">
                          <Label htmlFor="ai-assistance">AI Task Assistance</Label>
                           <Button size="sm" variant="ghost" onClick={handleGenerateAssistance} disabled={isGeneratingAssistance}>
                              {isGeneratingAssistance ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/> }
                             <span className="ml-2">Get Assistance</span>
                          </Button>
                      </div>
                      <Textarea id="ai-assistance" value={aiAssistanceText || ""} onChange={(e) => setAiAssistanceText(e.target.value)} className="min-h-[150px] bg-muted/30" placeholder="AI-generated task assistance, obstacles, and strategies will appear here..."/>
                  </div>
              </motion.div>
          </ScrollArea>

          {/* Right Column for metadata */}
          <motion.div 
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
              <div className="p-4 rounded-lg bg-card border space-y-4">
                  <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select value={status || "todo"} onValueChange={(value: DisplayTask['status']) => setStatus(value)}>
                          <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                          <SelectContent>
                              <SelectItem value="todo">To do</SelectItem>
                              <SelectItem value="inprogress">In progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="recurring">Recurring</SelectItem>
                          </SelectContent>
                      </Select>
                  </div>
                   <div className="space-y-2">
                      <Label htmlFor="priority">Priority</Label>
                      <Select value={priority} onValueChange={(value: DisplayTask['priority']) => setPriority(value)}>
                          <SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger>
                          <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="dueAt">Due Date</Label>
                      <Popover>
                          <PopoverTrigger asChild>
                          <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !dueAt && "text-muted-foreground")}>
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {dueAt ? format(dueAt, "PPP") : <span>Pick a date</span>}
                          </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={dueAt} onSelect={setDueAt} initialFocus /></PopoverContent>
                      </Popover>
                  </div>
              </div>
          </motion.div>
        </div>
        <DialogFooter className="mt-auto pt-4 border-t">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSaveChanges}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    
