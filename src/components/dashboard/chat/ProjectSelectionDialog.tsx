// src/components/dashboard/chat/ProjectSelectionDialog.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import React, { useState, useEffect } from 'react';
import { Separator } from "@/components/ui/separator";
import { PlusCircle, Loader2 } from "lucide-react";

export interface Project {
  id: string;
  name: string;
  // Add other relevant project fields if necessary, e.g., userId, createdAt
  userId?: string;
  createdAt?: any;
}

interface ProjectSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (project: Project) => void;
  projects: Project[];
  task: DisplayTask | DisplayTask[] | null; // Represents the task(s) to be added
  onProjectCreated?: (newProjectName: string) => Promise<Project | undefined>; // Changed to return Promise<Project>
  selectedTaskIds?: Set<string>; 
  isLoadingProjects?: boolean;
}

export default function ProjectSelectionDialog({
  isOpen,
  onClose,
  onSelectProject,
  projects,
  task,
  onProjectCreated,
  selectedTaskIds,
  isLoadingProjects,
}: ProjectSelectionDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  useEffect(() => {
    // Reset selected project when dialog opens or projects list changes
    if (isOpen) {
        if (projects.length > 0 && !projects.find(p => p.id === selectedProjectId)) {
            setSelectedProjectId(projects[0].id);
        } else if (projects.length === 0 && !showNewProjectForm) {
            // If no projects exist, automatically show the create form
            setShowNewProjectForm(true);
            setSelectedProjectId(undefined); // Ensure no project is selected
        } else if (projects.length > 0 && !selectedProjectId) {
            // If projects exist but none are selected, select the first one
            setSelectedProjectId(projects[0].id);
        }
    }
  }, [isOpen, projects, showNewProjectForm, selectedProjectId]); // Added selectedProjectId to re-evaluate if it gets cleared


  const handleConfirm = () => {
    if (selectedProjectId) {
      const selectedProject = projects.find(p => p.id === selectedProjectId);
      if (selectedProject) {
        onSelectProject(selectedProject);
      }
    }
    setShowNewProjectForm(false);
    setNewProjectName("");
  };

  const handleCreateNewProject = async () => {
    if (newProjectName.trim() && onProjectCreated) {
      setIsCreatingProject(true);
      const createdProject = await onProjectCreated(newProjectName.trim());
      setIsCreatingProject(false);
      if (createdProject) {
        // Projects list will update via snapshot listener in parent.
        // We can optimistically select it here.
        setSelectedProjectId(createdProject.id);
        setNewProjectName("");
        setShowNewProjectForm(false);
      }
      // If createdProject is undefined, an error occurred, toast shown by parent.
    }
  };
  
  const countSelectedTasks = () => {
    if (!task && (!selectedTaskIds || selectedTaskIds.size === 0)) return 0;
    
    if (selectedTaskIds && selectedTaskIds.size > 0) {
      return selectedTaskIds.size;
    }
    
    if (Array.isArray(task)) {
        let count = 0;
        const countRecursively = (tasks: DisplayTask[]) => {
            tasks.forEach(t => {
                count++;
                if (t.subtasks) countRecursively(t.subtasks);
            });
        };
        countRecursively(task);
        return count;
    }
    
    if (task) {
      let singleTaskCount = 1;
      const countDescendants = (t: DisplayTask) => {
          if (t.subtasks) {
              t.subtasks.forEach(st => {
                  singleTaskCount++;
                  countDescendants(st);
              });
          }
      };
      countDescendants(task);
      return singleTaskCount;
    }
    return 0;
  };

  const numTasks = countSelectedTasks();
  const taskTitleOrCount = numTasks === 1 && task && !Array.isArray(task) ? `"${task.title}"` : numTasks > 0 ? `${numTasks} tasks/concepts` : "the task(s)";


  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
          onClose();
          setShowNewProjectForm(false); 
          setNewProjectName("");
      }
    }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add to Project</DialogTitle>
          <DialogDescription>
            Select a project to add {taskTitleOrCount} to, or create a new project.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4 min-h-[200px]">
          {isLoadingProjects ? (
             <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Loading projects...</p>
             </div>
          ) : showNewProjectForm ? (
            <div className="space-y-3 p-3 border rounded-md bg-muted/30">
              <Label htmlFor="new-project-name" className="font-semibold">New Project Name</Label>
              <Input
                id="new-project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Q4 Marketing Campaign"
                autoFocus
                disabled={isCreatingProject}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowNewProjectForm(false)} disabled={isCreatingProject}>Cancel</Button>
                <Button onClick={handleCreateNewProject} disabled={!newProjectName.trim() || isCreatingProject}>
                  {isCreatingProject && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create & Select
                </Button>
              </div>
            </div>
          ) : (
            <>
              {projects.length > 0 ? (
                <RadioGroup value={selectedProjectId} onValueChange={setSelectedProjectId} className="max-h-[200px] overflow-y-auto pr-2 space-y-1">
                  {projects.map((project: any) => (
                    <div key={project.id} className="flex items-center space-x-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value={project.id} id={`project-${project.id}`} />
                      <Label htmlFor={`project-${project.id}`} className="flex-1 cursor-pointer text-sm">{project.name}</Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-3">No projects yet. Create one below!</p>
              )}
              <Separator />
              <Button variant="outline" className="w-full" onClick={() => setShowNewProjectForm(true)} disabled={isCreatingProject}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create New Project
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => {
              onClose();
              setShowNewProjectForm(false);
              setNewProjectName("");
          }}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedProjectId || numTasks === 0 || isLoadingProjects || isCreatingProject || showNewProjectForm}>
            Add to Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

