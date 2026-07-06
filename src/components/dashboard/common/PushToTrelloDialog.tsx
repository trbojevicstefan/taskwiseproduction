// src/components/dashboard/common/PushToTrelloDialog.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertTriangle, ExternalLink, Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { TrelloBoard, TrelloList } from '@/lib/trelloAPI';

interface PushToTrelloDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: ExtractedTaskSchema[];
}

export type TrelloDialogPhase =
  | 'checking'
  | 'unconfigured'
  | 'disconnected'
  | 'authExpired'
  | 'connected'
  | 'error';

export interface TrelloConnectionStatusPayload {
  configured?: boolean;
  authorizeUrl?: string | null;
  connection?: {
    status?: string | null;
    memberUsername?: string | null;
    memberFullName?: string | null;
  } | null;
}

const MAX_CARDS_PER_REQUEST = 25;
const MAX_NAME_LENGTH = 512;
const MAX_DESC_LENGTH = 8000;
const MAX_SUBTASKS_PER_CARD = 50;
const MAX_SUBTASK_LENGTH = 500;

export const resolveTrelloPhaseFromStatus = (
  payload: TrelloConnectionStatusPayload | null | undefined
): TrelloDialogPhase => {
  if (!payload) return 'error';
  if (!payload.configured) return 'unconfigured';
  if (payload.connection?.status === 'active') return 'connected';
  return 'disconnected';
};

export const buildCardDescription = (task: ExtractedTaskSchema): string => {
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

const normalizeDueDate = (value: ExtractedTaskSchema['dueAt']): string | undefined => {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

/**
 * Builds the POST /api/trello/cards payload from Taskwise tasks: title,
 * description, due date, assignee text, source meeting link (when the task
 * has a source session), and subtasks as checklist items. Applies the same
 * size caps the API enforces.
 */
export const buildTrelloCardsPayload = (
  tasks: ExtractedTaskSchema[],
  listId: string,
  origin: string | null
) => ({
  listId,
  cards: tasks.slice(0, MAX_CARDS_PER_REQUEST).map((task) => {
    const desc = buildCardDescription(task).slice(0, MAX_DESC_LENGTH);
    const assigneeName =
      task.assignee?.displayName || task.assigneeName || undefined;
    const sourceMeetingUrl =
      origin && task.sourceSessionId
        ? `${origin}/meetings/${encodeURIComponent(task.sourceSessionId)}`
        : undefined;
    const subtasks = (task.subtasks || [])
      .map((subtask) => (subtask.title || '').trim())
      .filter(Boolean)
      .slice(0, MAX_SUBTASKS_PER_CARD)
      .map((title) => title.slice(0, MAX_SUBTASK_LENGTH));
    return {
      name: (task.title || 'Untitled task').trim().slice(0, MAX_NAME_LENGTH) || 'Untitled task',
      ...(desc ? { desc } : {}),
      ...(normalizeDueDate(task.dueAt) ? { due: normalizeDueDate(task.dueAt) } : {}),
      ...(assigneeName ? { assigneeName } : {}),
      ...(sourceMeetingUrl ? { sourceMeetingUrl } : {}),
      ...(subtasks.length > 0 ? { subtasks } : {}),
    };
  }),
});

export const extractErrorMessage = async (
  response: Response,
  fallback: string
) => {
  try {
    const payload = await response.json();
    const message = payload?.message || payload?.error || payload?.details;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to generic message.
  }
  return fallback;
};

/**
 * Connect UI for the token-paste flow: open the Trello authorize page, copy
 * the token Trello displays, paste it here. Reused by the reconnect
 * (auth-expired) state and by the settings TrelloConnectDialog.
 */
export function TrelloConnectPanel({
  authorizeUrl,
  isConnecting,
  errorMessage,
  onConnectSubmit,
  variant = 'connect',
}: {
  authorizeUrl: string | null;
  isConnecting: boolean;
  errorMessage?: string | null;
  onConnectSubmit: (token: string) => void;
  variant?: 'connect' | 'reconnect';
}) {
  const [tokenInput, setTokenInput] = useState('');
  const trimmedToken = tokenInput.trim();

  return (
    <div className="space-y-4">
      {variant === 'reconnect' ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>
            Your Trello authorization is no longer valid. Reconnect Trello to
            continue.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Trello is not connected yet. Authorize Taskwise on Trello, copy the
          token Trello shows you, and paste it below.
        </p>
      )}
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!authorizeUrl}
          onClick={() => {
            if (authorizeUrl && typeof window !== 'undefined') {
              window.open(authorizeUrl, '_blank', 'noopener');
            }
          }}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Open Trello authorization
        </Button>
        <div className="space-y-2">
          <Label htmlFor="trello-token">Trello token</Label>
          <Input
            id="trello-token"
            type="password"
            autoComplete="off"
            placeholder="Paste the token from Trello"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            disabled={isConnecting}
          />
        </div>
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={isConnecting || trimmedToken.length < 8}
          onClick={() => onConnectSubmit(trimmedToken)}
        >
          {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {variant === 'reconnect' ? 'Reconnect Trello' : 'Connect Trello'}
        </Button>
      </div>
    </div>
  );
}

export interface PushToTrelloDialogBodyProps {
  phase: TrelloDialogPhase;
  statusMessage?: string | null;
  authorizeUrl: string | null;
  isConnecting: boolean;
  connectError?: string | null;
  onConnectSubmit: (token: string) => void;
  onRetry: () => void;
  boards: TrelloBoard[];
  lists: TrelloList[];
  boardsLoaded: boolean;
  listsLoaded: boolean;
  isFetchingBoards: boolean;
  isFetchingLists: boolean;
  selectedBoardId: string | null;
  selectedListId: string | null;
  onBoardChange: (boardId: string) => void;
  onListChange: (listId: string) => void;
}

/** Presentational dialog body — exported so tests can render every state. */
export function PushToTrelloDialogBody(props: PushToTrelloDialogBodyProps) {
  const {
    phase,
    statusMessage,
    authorizeUrl,
    isConnecting,
    connectError,
    onConnectSubmit,
    onRetry,
    boards,
    lists,
    boardsLoaded,
    listsLoaded,
    isFetchingBoards,
    isFetchingLists,
    selectedBoardId,
    selectedListId,
    onBoardChange,
    onListChange,
  } = props;

  if (phase === 'checking') {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking Trello connection...
      </div>
    );
  }

  if (phase === 'unconfigured') {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        Trello is not configured for this app. Ask an administrator to set the
        TRELLO_API_KEY environment variable, then try again.
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-destructive">
          {statusMessage || 'Could not load the Trello connection.'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (phase === 'disconnected' || phase === 'authExpired') {
    return (
      <div className="py-2">
        <TrelloConnectPanel
          authorizeUrl={authorizeUrl}
          isConnecting={isConnecting}
          errorMessage={connectError}
          onConnectSubmit={onConnectSubmit}
          variant={phase === 'authExpired' ? 'reconnect' : 'connect'}
        />
      </div>
    );
  }

  const noBoards = boardsLoaded && !isFetchingBoards && boards.length === 0;
  const noLists =
    Boolean(selectedBoardId) && listsLoaded && !isFetchingLists && lists.length === 0;

  return (
    <div className="py-4 space-y-4">
      {noBoards ? (
        <p className="text-sm text-muted-foreground">
          No open boards were found in your Trello account. Create a board in
          Trello, then reopen this dialog.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="trello-board">Board</Label>
            <Select
              value={selectedBoardId || ''}
              onValueChange={onBoardChange}
              disabled={isFetchingBoards}
            >
              <SelectTrigger id="trello-board">
                <SelectValue
                  placeholder={isFetchingBoards ? 'Loading boards...' : 'Select a board'}
                />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trello-list">List</Label>
            <Select
              value={selectedListId || ''}
              onValueChange={onListChange}
              disabled={isFetchingLists || !selectedBoardId}
            >
              <SelectTrigger id="trello-list">
                <SelectValue
                  placeholder={isFetchingLists ? 'Loading lists...' : 'Select a list'}
                />
              </SelectTrigger>
              <SelectContent>
                {lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {noLists ? (
              <p className="text-sm text-muted-foreground">
                This board has no open lists. Add a list to the board in
                Trello, then pick it here.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function PushToTrelloDialog({ isOpen, onClose, tasks }: PushToTrelloDialogProps) {
  const [phase, setPhase] = useState<TrelloDialogPhase>('checking');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isFetchingBoards, setIsFetchingBoards] = useState(false);
  const [isFetchingLists, setIsFetchingLists] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const { toast } = useToast();

  const fetchBoards = useCallback(async () => {
    setIsFetchingBoards(true);
    setBoardsLoaded(false);
    try {
      const response = await fetch('/api/trello/boards');
      if (response.status === 401) {
        setPhase('authExpired');
        return;
      }
      if (response.status === 409) {
        setPhase('disconnected');
        return;
      }
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, 'Failed to fetch Trello boards.')
        );
      }
      const payload = await response.json();
      const fetchedBoards: TrelloBoard[] = Array.isArray(payload?.boards)
        ? payload.boards
        : [];
      setBoards(fetchedBoards);
      setBoardsLoaded(true);
      if (fetchedBoards.length > 0) {
        setSelectedBoardId(fetchedBoards[0].id);
      }
    } catch (error: any) {
      console.error('Error fetching Trello boards:', error);
      setPhase('error');
      setStatusMessage(error?.message || 'Failed to fetch Trello boards.');
    } finally {
      setIsFetchingBoards(false);
    }
  }, []);

  const checkConnection = useCallback(async () => {
    setPhase('checking');
    setStatusMessage(null);
    setConnectError(null);
    try {
      const response = await fetch('/api/trello/connection');
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, 'Could not load the Trello connection.')
        );
      }
      const payload: TrelloConnectionStatusPayload = await response.json();
      setAuthorizeUrl(payload?.authorizeUrl || null);
      const nextPhase = resolveTrelloPhaseFromStatus(payload);
      setPhase(nextPhase);
      if (nextPhase === 'connected') {
        void fetchBoards();
      }
    } catch (error: any) {
      console.error('Error loading Trello connection:', error);
      setPhase('error');
      setStatusMessage(error?.message || 'Could not load the Trello connection.');
    }
  }, [fetchBoards]);

  useEffect(() => {
    if (isOpen) {
      void checkConnection();
    }
  }, [isOpen, checkConnection]);

  useEffect(() => {
    const fetchLists = async () => {
      if (!selectedBoardId || phase !== 'connected') return;
      setIsFetchingLists(true);
      setListsLoaded(false);
      setLists([]);
      setSelectedListId(null);
      try {
        const params = new URLSearchParams({ boardId: selectedBoardId });
        const response = await fetch(`/api/trello/lists?${params.toString()}`);
        if (response.status === 401) {
          setPhase('authExpired');
          return;
        }
        if (!response.ok) {
          throw new Error(
            await extractErrorMessage(response, 'Failed to fetch Trello lists.')
          );
        }
        const payload = await response.json();
        const fetchedLists: TrelloList[] = Array.isArray(payload?.lists)
          ? payload.lists
          : [];
        setLists(fetchedLists);
        setListsLoaded(true);
        if (fetchedLists.length > 0) {
          setSelectedListId(fetchedLists[0].id);
        }
      } catch (error: any) {
        console.error('Error fetching Trello lists:', error);
        toast({
          title: 'Error',
          description: error?.message || 'Failed to fetch Trello lists.',
          variant: 'destructive',
        });
      } finally {
        setIsFetchingLists(false);
      }
    };
    void fetchLists();
  }, [selectedBoardId, phase, toast]);

  const handleConnectSubmit = async (token: string) => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const response = await fetch('/api/trello/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, 'Could not connect your Trello account.')
        );
      }
      toast({ title: 'Trello Connected!', description: 'Your Trello account is now linked.' });
      setPhase('connected');
      void fetchBoards();
    } catch (error: any) {
      console.error('Error connecting Trello:', error);
      setConnectError(error?.message || 'Could not connect your Trello account.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handlePush = async () => {
    if (!selectedListId) {
      toast({ title: 'No List Selected', variant: 'destructive' });
      return;
    }
    setIsPushing(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : null;
      const response = await fetch('/api/trello/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTrelloCardsPayload(tasks, selectedListId, origin)),
      });
      if (response.status === 401) {
        setPhase('authExpired');
        return;
      }
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, 'Failed to create Trello cards.')
        );
      }
      const payload = await response.json();
      const createdCount = Number(payload?.createdCount) || 0;
      const failures = Array.isArray(payload?.failures) ? payload.failures : [];
      if (failures.length > 0) {
        toast({
          title: 'Partially Pushed to Trello',
          description: `${createdCount} card(s) created; ${failures.length} failed (${failures[0]?.error || 'unknown error'}). Retry the failed tasks.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Success!',
          description: `${createdCount} card(s) were pushed to Trello.`,
        });
      }
      onClose();
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error Pushing to Trello',
        description: error?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handleDialogClose = () => {
    onClose();
    // Reset state when closing
    setTimeout(() => {
      setPhase('checking');
      setStatusMessage(null);
      setConnectError(null);
      setBoards([]);
      setLists([]);
      setBoardsLoaded(false);
      setListsLoaded(false);
      setSelectedBoardId(null);
      setSelectedListId(null);
    }, 300);
  };

  const canPush =
    phase === 'connected' &&
    Boolean(selectedListId) &&
    tasks.length > 0 &&
    !isFetchingBoards &&
    !isFetchingLists &&
    !isPushing;

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to Trello</DialogTitle>
          <DialogDescription>
            Select a Trello board and list to send {tasks.length} task(s) to.
          </DialogDescription>
        </DialogHeader>
        <PushToTrelloDialogBody
          phase={phase}
          statusMessage={statusMessage}
          authorizeUrl={authorizeUrl}
          isConnecting={isConnecting}
          connectError={connectError}
          onConnectSubmit={handleConnectSubmit}
          onRetry={() => void checkConnection()}
          boards={boards}
          lists={lists}
          boardsLoaded={boardsLoaded}
          listsLoaded={listsLoaded}
          isFetchingBoards={isFetchingBoards}
          isFetchingLists={isFetchingLists}
          selectedBoardId={selectedBoardId}
          selectedListId={selectedListId}
          onBoardChange={setSelectedBoardId}
          onListChange={setSelectedListId}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleDialogClose} disabled={isPushing}>
            Cancel
          </Button>
          <Button onClick={handlePush} disabled={!canPush}>
            {isPushing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Push to Trello
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Standalone connect dialog for the Settings integrations card. Loads the
 * authorize URL itself and reports success via onConnected.
 */
export function TrelloConnectDialog({
  isOpen,
  onClose,
  onConnected,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) return;
    setConnectError(null);
    const load = async () => {
      try {
        const response = await fetch('/api/trello/connection');
        const payload = await response.json().catch(() => ({}));
        setConfigured(Boolean(payload?.configured));
        setAuthorizeUrl(payload?.authorizeUrl || null);
      } catch {
        setConfigured(null);
      }
    };
    void load();
  }, [isOpen]);

  const handleConnectSubmit = async (token: string) => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const response = await fetch('/api/trello/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, 'Could not connect your Trello account.')
        );
      }
      toast({ title: 'Trello Connected!', description: 'Your Trello account is now linked.' });
      onConnected?.();
      onClose();
    } catch (error: any) {
      setConnectError(error?.message || 'Could not connect your Trello account.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Trello</DialogTitle>
          <DialogDescription>
            Authorize Taskwise on Trello and paste the token to connect.
          </DialogDescription>
        </DialogHeader>
        {configured === false ? (
          <div className="py-4 text-sm text-muted-foreground">
            Trello is not configured for this app. Ask an administrator to set
            the TRELLO_API_KEY environment variable, then try again.
          </div>
        ) : (
          <TrelloConnectPanel
            authorizeUrl={authorizeUrl}
            isConnecting={isConnecting}
            errorMessage={connectError}
            onConnectSubmit={handleConnectSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
