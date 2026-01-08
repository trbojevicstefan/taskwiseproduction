"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Board } from "@/types/board";
import { useToast } from "@/hooks/use-toast";

export const useWorkspaceBoards = (workspaceId?: string | null) => {
  const { toast } = useToast();
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setBoards([]);
      return;
    }

    let isActive = true;
    setIsLoading(true);

    apiFetch<Board[]>(`/api/workspaces/${workspaceId}/boards`)
      .then((boardList) => {
        if (isActive) {
          setBoards(boardList);
        }
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("Failed to load boards:", error);
        toast({
          title: "Could not load boards",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [workspaceId, toast]);

  return { boards, isLoading };
};
