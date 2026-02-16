// src/contexts/FolderContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { Folder } from '@/types/folder';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';

interface FolderContextType {
  folders: Folder[];
  isLoadingFolders: boolean;
  addFolder: (folderData: Omit<Folder, 'id' | 'userId' | 'createdAt'>) => Promise<void>;
  updateFolder: (folderId: string, folderData: Partial<Omit<Folder, 'id' | 'userId' | 'createdAt'>>) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
}

const FolderContext = createContext<FolderContextType | undefined>(undefined);

export const FolderProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingFolders(true);
      apiFetch<Folder[]>("/api/folders")
        .then(setFolders)
        .finally(() => setIsLoadingFolders(false));
    } else {
      setFolders([]);
      setIsLoadingFolders(false);
    }
  }, [user?.uid]);

  const addFolder = useCallback(async (folderData: Omit<Folder, 'id' | 'userId' | 'createdAt'>) => {
    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in to create a folder.", variant: "destructive" });
      return;
    }
    try {
      const created = await apiFetch<Folder>("/api/folders", {
        method: "POST",
        body: JSON.stringify(folderData),
      });
      setFolders(prev => [...prev, created]);
      toast({ title: "Folder Created", description: `Folder "${folderData.name}" has been created.` });
    } catch (error) {
      console.error("Error creating folder:", error);
      toast({ title: "Error", description: "Could not create folder.", variant: "destructive" });
    }
  }, [user, toast]);

  const updateFolder = useCallback(async (folderId: string, folderData: Partial<Omit<Folder, 'id' | 'userId' | 'createdAt'>>) => {
    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in to update a folder.", variant: "destructive" });
      return;
    }
    try {
      const updated = await apiFetch<Folder>(`/api/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify(folderData),
      });
      setFolders(prev => prev.map(folder => folder.id === updated.id ? updated : folder));
      // No toast here for quieter successful updates (e.g., renaming)
    } catch (error) {
      console.error("Error updating folder:", error);
      toast({ title: "Error", description: "Could not update folder.", variant: "destructive" });
    }
  }, [user, toast]);

  const deleteFolder = useCallback(async (folderId: string) => {
    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in to delete a folder.", variant: "destructive" });
      return;
    }
    try {
      await apiFetch(`/api/folders/${folderId}`, { method: "DELETE" });
      setFolders(prev => prev.filter(folder => folder.id !== folderId));
      toast({ title: "Folder Deleted", description: "The folder and its contents have been un-filed." });
    } catch (error) {
      console.error("Error deleting folder:", error);
      toast({ title: "Error", description: "Could not delete folder.", variant: "destructive" });
    }
  }, [user, toast]);

  return (
    <FolderContext.Provider value={{ folders, isLoadingFolders, addFolder, updateFolder, deleteFolder }}>
      {children}
    </FolderContext.Provider>
  );
};

export const useFolders = () => {
  const context = useContext(FolderContext);
  if (context === undefined) {
    throw new Error('useFolders must be used within a FolderProvider');
  }
  return context;
};
