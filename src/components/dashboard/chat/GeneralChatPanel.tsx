// src/components/dashboard/chat/GeneralChatPanel.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CheckSquare,
  RefreshCw,
  Send,
  Sparkles,
  User,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Logo } from '@/components/ui/logo';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import type { Message as StoredMessage } from '@/types/chat';

// ---------------------------------------------------------------------------
// Types mirroring the POST /api/ai/chat contract
// ---------------------------------------------------------------------------

export type GeneralChatSourceType =
  | 'meeting'
  | 'transcript'
  | 'task'
  | 'person'
  | 'client';

export type GeneralChatConfidence = 'low' | 'medium' | 'high';

export type GeneralChatActionType =
  | 'open_meeting'
  | 'open_task'
  | 'create_task'
  | 'schedule_slack_reminder'
  | 'none';

export interface GeneralChatSource {
  sourceType: GeneralChatSourceType;
  sourceId: string;
  title: string;
  snippet: string;
  timestamp?: string;
  /** Optional extra some task sources may carry back to their meeting. */
  sourceSessionId?: string | null;
}

export interface GeneralChatSuggestedAction {
  label: string;
  actionType: GeneralChatActionType;
  targetId?: string;
}

export interface GeneralChatAnswer {
  answer: string;
  confidence: GeneralChatConfidence;
  sources: GeneralChatSource[];
  suggestedActions: GeneralChatSuggestedAction[];
}

export type ChatContextMode = 'workspace' | 'meeting';

export type PanelMessage =
  | { id: string; role: 'user'; text: string; at?: number }
  | {
      id: string;
      role: 'assistant';
      answer: GeneralChatAnswer;
      at?: number;
      /** True for messages saved by the pre-unification chat (no contract data). */
      legacy?: boolean;
    }
  | { id: string; role: 'error'; text: string; question: string; at?: number };

/**
 * Stored chat-session message shape: the legacy Message plus the full
 * structured answer so reloads restore confidence/sources/actions. Extra
 * fields round-trip through PATCH /api/chat-sessions/[id] untouched.
 */
export type StoredChatMessage = StoredMessage & {
  chatAnswer?: GeneralChatAnswer;
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const SOURCE_TYPES: GeneralChatSourceType[] = [
  'meeting',
  'transcript',
  'task',
  'person',
  'client',
];

const CONFIDENCE_VALUES: GeneralChatConfidence[] = ['low', 'medium', 'high'];

const ACTION_TYPES: GeneralChatActionType[] = [
  'open_meeting',
  'open_task',
  'create_task',
  'schedule_slack_reminder',
  'none',
];

export const resolveSourceHref = (source: GeneralChatSource): string | null => {
  switch (source.sourceType) {
    case 'meeting':
    case 'transcript':
      return source.sourceId ? `/meetings/${source.sourceId}` : null;
    case 'person':
    case 'client':
      return source.sourceId ? `/people/${source.sourceId}` : null;
    case 'task':
      if (source.sourceSessionId) {
        return `/meetings/${source.sourceSessionId}`;
      }
      return '/review';
    default:
      return null;
  }
};

export const normalizeGeneralChatAnswer = (
  data: unknown
): GeneralChatAnswer => {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: GeneralChatSource[] = rawSources
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        SOURCE_TYPES.includes((entry as Record<string, unknown>).sourceType as GeneralChatSourceType) &&
        typeof (entry as Record<string, unknown>).sourceId === 'string' &&
        typeof (entry as Record<string, unknown>).title === 'string'
    )
    .map((entry) => ({
      sourceType: entry.sourceType as GeneralChatSourceType,
      sourceId: entry.sourceId as string,
      title: entry.title as string,
      snippet: typeof entry.snippet === 'string' ? entry.snippet : '',
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      sourceSessionId:
        typeof entry.sourceSessionId === 'string' ? entry.sourceSessionId : undefined,
    }));

  const rawActions = Array.isArray(raw.suggestedActions) ? raw.suggestedActions : [];
  const suggestedActions: GeneralChatSuggestedAction[] = rawActions
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).label === 'string' &&
        ACTION_TYPES.includes((entry as Record<string, unknown>).actionType as GeneralChatActionType)
    )
    .map((entry) => ({
      label: entry.label as string,
      actionType: entry.actionType as GeneralChatActionType,
      targetId: typeof entry.targetId === 'string' ? entry.targetId : undefined,
    }));

  return {
    answer:
      typeof raw.answer === 'string' && raw.answer.trim().length > 0
        ? raw.answer
        : 'I could not generate an answer for that. Please try rephrasing your question.',
    confidence: CONFIDENCE_VALUES.includes(raw.confidence as GeneralChatConfidence)
      ? (raw.confidence as GeneralChatConfidence)
      : 'low',
    sources,
    suggestedActions,
  };
};

// ---------------------------------------------------------------------------
// Stored <-> panel message mapping (exported for ChatPageContent and tests)
// ---------------------------------------------------------------------------

const AI_TYPING_INDICATOR_ID = 'ai-typing-indicator';

/**
 * Map panel messages to the persisted chat-session message shape. Error
 * messages are transient and never persisted. Assistant messages keep both
 * the plain text (legacy renderers) and the structured `chatAnswer`.
 */
export const panelMessagesToStoredMessages = (
  messages: PanelMessage[],
  options: { userName?: string; userAvatar?: string } = {}
): StoredChatMessage[] =>
  messages
    .filter((message) => message.role !== 'error')
    .map((message) => {
      const timestamp = message.at ?? Date.now();
      if (message.role === 'user') {
        return {
          id: message.id,
          text: message.text,
          sender: 'user' as const,
          timestamp,
          avatar: options.userAvatar,
          name: options.userName,
        };
      }
      const answer = (message as Extract<PanelMessage, { role: 'assistant' }>)
        .answer;
      return {
        id: message.id,
        text: answer.answer,
        sender: 'ai' as const,
        timestamp,
        name: 'TaskWise AI',
        chatAnswer: answer,
        sources: answer.sources
          .filter((source) => source.snippet)
          .map((source) => ({
            timestamp: source.timestamp || 'N/A',
            snippet: source.snippet,
          })),
      };
    });

/**
 * Map persisted chat-session messages back to panel messages. Messages saved
 * by the unified panel restore their full structured answer; legacy messages
 * (pre-unification) become plain assistant bubbles without a confidence pill,
 * with their transcript sources attributed to the session's source meeting.
 */
export const storedMessagesToPanelMessages = (
  messages: StoredChatMessage[] | null | undefined,
  sourceMeetingId?: string | null
): PanelMessage[] => {
  if (!Array.isArray(messages)) return [];
  const panelMessages: PanelMessage[] = [];
  for (const message of messages) {
    if (!message || message.id === AI_TYPING_INDICATOR_ID) continue;
    if (message.sender === 'user') {
      const text = typeof message.text === 'string' ? message.text : '';
      if (!text.trim() && !message.attachedContent) continue;
      panelMessages.push({
        id: message.id,
        role: 'user',
        text: text.trim() ? text : 'Pasted text',
        at: message.timestamp,
      });
      continue;
    }
    if (message.sender !== 'ai') continue;
    if (message.chatAnswer) {
      panelMessages.push({
        id: message.id,
        role: 'assistant',
        answer: normalizeGeneralChatAnswer(message.chatAnswer),
        at: message.timestamp,
      });
      continue;
    }
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text) continue;
    const legacySources: GeneralChatSource[] = Array.isArray(message.sources)
      ? message.sources
          .filter((source) => source && typeof source.snippet === 'string')
          .map((source) => ({
            sourceType: 'transcript' as const,
            sourceId: sourceMeetingId ? String(sourceMeetingId) : '',
            title: 'Transcript',
            snippet: source.snippet,
            timestamp:
              source.timestamp && source.timestamp !== 'N/A'
                ? source.timestamp
                : undefined,
          }))
      : [];
    panelMessages.push({
      id: message.id,
      role: 'assistant',
      answer: {
        answer: text,
        confidence: 'low',
        sources: legacySources,
        suggestedActions: [],
      },
      at: message.timestamp,
      legacy: true,
    });
  }
  return panelMessages;
};

// ---------------------------------------------------------------------------
// Suggested prompts (from the Phase 2 spec)
// ---------------------------------------------------------------------------

export const GENERAL_CHAT_SUGGESTED_PROMPTS: Array<{
  prompt: string;
  isTemplate: boolean;
}> = [
  { prompt: 'What did we promise Client X last week?', isTemplate: true },
  { prompt: 'Which tasks are overdue?', isTemplate: false },
  { prompt: 'Summarize all meetings about the redesign.', isTemplate: false },
  { prompt: 'What did Stefan say about pricing?', isTemplate: true },
  { prompt: 'Which clients are waiting on us?', isTemplate: false },
];

// ---------------------------------------------------------------------------
// Small subcomponents
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<GeneralChatConfidence, string> = {
  low: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300',
  medium:
    'border-slate-400/50 bg-slate-400/10 text-slate-700 dark:border-slate-400/40 dark:bg-slate-400/10 dark:text-slate-300',
  high: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300',
};

const ConfidencePill: React.FC<{ confidence: GeneralChatConfidence }> = ({
  confidence,
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      CONFIDENCE_STYLES[confidence]
    )}
  >
    {confidence} confidence
  </span>
);

const SOURCE_ICONS: Record<GeneralChatSourceType, LucideIcon> = {
  meeting: Video,
  transcript: Video,
  task: CheckSquare,
  person: User,
  client: Building2,
};

const SourceChip: React.FC<{ source: GeneralChatSource }> = ({ source }) => {
  const Icon = SOURCE_ICONS[source.sourceType] ?? Video;
  const href = resolveSourceHref(source);
  const chipClass =
    'inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 hover:bg-muted/60';

  const chipBody = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{source.title}</span>
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className={chipClass}>
            {chipBody}
          </Link>
        ) : (
          <span className={cn(chipClass, 'cursor-default')}>{chipBody}</span>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs leading-relaxed">
          {source.snippet || source.title}
        </p>
        {source.timestamp && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {source.timestamp}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

const SuggestedActionButtons: React.FC<{
  actions: GeneralChatSuggestedAction[];
}> = ({ actions }) => {
  const router = useRouter();

  const renderable = actions.filter(
    (action) =>
      (action.actionType === 'open_meeting' && action.targetId) ||
      action.actionType === 'open_task'
  );

  if (renderable.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {renderable.map((action, index) => (
        <Button
          key={`${action.actionType}-${action.targetId ?? index}`}
          variant="outline"
          size="sm"
          className="h-7 rounded-full bg-background px-3 text-xs"
          onClick={() => {
            if (action.actionType === 'open_meeting' && action.targetId) {
              router.push(`/meetings/${action.targetId}`);
            } else if (action.actionType === 'open_task') {
              router.push('/review');
            }
          }}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
};

const AssistantAvatar: React.FC = () => (
  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background">
    <Logo size="sm" isIconOnly />
  </div>
);

const assistantBubbleClass =
  'rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm';

const AssistantMessageBubble: React.FC<{
  answer: GeneralChatAnswer;
  showConfidence?: boolean;
}> = ({ answer, showConfidence = true }) => (
  <div className="flex items-start gap-3">
    <AssistantAvatar />
    <div className={cn('max-w-[78%] md:max-w-[560px]', assistantBubbleClass)}>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {answer.answer}
      </div>
      {showConfidence && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ConfidencePill confidence={answer.confidence} />
        </div>
      )}
      {answer.sources.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </div>
          <div className="flex flex-wrap gap-1.5">
            {answer.sources.map((source, index) => (
              <SourceChip
                key={`${source.sourceType}-${source.sourceId}-${index}`}
                source={source}
              />
            ))}
          </div>
        </div>
      )}
      <SuggestedActionButtons actions={answer.suggestedActions} />
    </div>
  </div>
);

const UserMessageBubble: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start justify-end gap-3">
    <div className="max-w-[78%] rounded-2xl border border-primary/30 bg-primary/90 p-4 text-primary-foreground shadow-[0_14px_30px_-24px_rgba(0,0,0,0.55)] md:max-w-[560px]">
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
    </div>
  </div>
);

const ErrorMessageBubble: React.FC<{
  text: string;
  onRetry: () => void;
  disabled: boolean;
}> = ({ text, onRetry, disabled }) => (
  <div className="flex items-start gap-3">
    <AssistantAvatar />
    <div className="max-w-[78%] rounded-2xl border border-destructive/40 bg-destructive/10 p-4 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.55)] md:max-w-[560px]">
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-destructive">
        {text}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 h-7 rounded-full bg-background px-3 text-xs"
        onClick={onRetry}
        disabled={disabled}
      >
        <RefreshCw className="mr-1.5 h-3 w-3" />
        Retry
      </Button>
    </div>
  </div>
);

const LoadingBubble: React.FC = () => (
  <div className="flex items-start gap-3">
    <AssistantAvatar />
    <div className={cn('w-full max-w-[420px]', assistantBubbleClass)}>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
    </div>
  </div>
);

const HeroState: React.FC<{
  onPickPrompt: (prompt: string) => void;
  disabled: boolean;
  title: string;
  prompts: string[];
  showDescription: boolean;
  showTip: boolean;
  compact: boolean;
}> = ({
  onPickPrompt,
  disabled,
  title,
  prompts,
  showDescription,
  showTip,
  compact,
}) => (
  <div
    className={cn(
      'flex flex-col items-center gap-4 text-center',
      compact ? 'py-4' : 'py-8'
    )}
  >
    <div
      className={cn(
        'flex items-center justify-center rounded-full border border-border bg-card shadow-sm',
        compact ? 'h-10 w-10' : 'h-12 w-12'
      )}
    >
      <Sparkles className={cn('text-primary', compact ? 'h-4 w-4' : 'h-5 w-5')} />
    </div>
    <h2
      className={cn(
        'font-headline font-semibold text-foreground',
        compact ? 'text-lg' : 'text-xl'
      )}
    >
      {title}
    </h2>
    {showDescription && (
      <p className="max-w-md text-sm text-muted-foreground">
        Answers are grounded in your meetings, transcripts, tasks, people, and
        clients — every claim comes with its sources.
      </p>
    )}
    <div className="flex max-w-xl flex-wrap justify-center gap-2">
      {prompts.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-full bg-background"
          onClick={() => onPickPrompt(prompt)}
          disabled={disabled}
        >
          {prompt}
        </Button>
      ))}
    </div>
    {showTip && (
      <p className="text-xs text-muted-foreground">
        Tip: edit placeholders like &ldquo;Client X&rdquo; or &ldquo;Stefan&rdquo;
        before sending.
      </p>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

let panelMessageCounter = 0;
const nextMessageId = () => {
  panelMessageCounter += 1;
  return `general-chat-${Date.now()}-${panelMessageCounter}`;
};

const MAX_QUESTION_LENGTH = 2000;
const HISTORY_MAX_ENTRIES = 12;

/** Prior turns sent to /api/ai/chat so follow-ups keep their context. */
export const buildChatHistoryPayload = (
  messages: PanelMessage[]
): Array<{
  role: 'user' | 'assistant';
  text: string;
  sources?: GeneralChatSource[];
}> =>
  messages
    .reduce<
      Array<{
        role: 'user' | 'assistant';
        text: string;
        sources?: GeneralChatSource[];
      }>
    >(
      (entries, message) => {
        if (message.role === 'user') {
          entries.push({
            role: 'user',
            text: message.text.slice(0, MAX_QUESTION_LENGTH),
          });
        } else if (message.role === 'assistant') {
          const assistantEntry: {
            role: 'assistant';
            text: string;
            sources?: GeneralChatSource[];
          } = {
            role: 'assistant',
            text: message.answer.answer.slice(0, MAX_QUESTION_LENGTH),
          };
          if (message.answer.sources.length > 0) {
            assistantEntry.sources = message.answer.sources;
          }
          entries.push(assistantEntry);
        }
        return entries;
      },
      []
    )
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-HISTORY_MAX_ENTRIES);

export interface GeneralChatPanelProps {
  className?: string;
  /** Override the hero heading (defaults to the Chat page copy). */
  heroTitle?: string;
  /** Override the suggested prompts shown in the hero state. */
  suggestedPrompts?: string[];
  /** Tighter spacing for side-column embeds. Defaults to false. */
  compact?: boolean;
  /** Chat session backing this conversation (persistence + reload). */
  sessionId?: string;
  /** Meeting the conversation is scoped to (meeting mode). */
  meetingId?: string;
  /** Context mode; defaults to 'meeting' when meetingId is set. */
  mode?: ChatContextMode;
  /** Messages restored from a persisted session (consumed on session switch). */
  initialMessages?: PanelMessage[];
  /** Persist messages to PATCH /api/chat-sessions/[sessionId]. */
  persistMessages?: boolean;
  /** Called with the full message list after every change. */
  onMessagesChange?: (messages: PanelMessage[]) => void;
  /**
   * Called before the first send when persistence is requested but no
   * sessionId exists yet; should create a session and return its id.
   */
  onEnsureSession?: (question: string) => Promise<string | null>;
}

export default function GeneralChatPanel({
  className,
  heroTitle,
  suggestedPrompts,
  compact = false,
  sessionId,
  meetingId,
  mode,
  initialMessages,
  persistMessages = false,
  onMessagesChange,
  onEnsureSession,
}: GeneralChatPanelProps) {
  const [messages, setMessages] = useState<PanelMessage[]>(
    () => initialMessages ?? []
  );
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const effectiveMode: ChatContextMode =
    mode ?? (meetingId ? 'meeting' : 'workspace');

  const messagesRef = useRef<PanelMessage[]>(messages);
  const initialMessagesRef = useRef<PanelMessage[] | undefined>(initialMessages);
  initialMessagesRef.current = initialMessages;
  const onMessagesChangeRef = useRef(onMessagesChange);
  onMessagesChangeRef.current = onMessagesChange;
  const onEnsureSessionRef = useRef(onEnsureSession);
  onEnsureSessionRef.current = onEnsureSession;

  // Session id created through onEnsureSession before the parent re-rendered
  // with the new sessionId prop. Prevents a state reset when the prop catches
  // up, and lets persistence target the fresh session immediately.
  const ensuredSessionIdRef = useRef<string | null>(null);
  const lastSessionKeyRef = useRef<string | null | undefined>(undefined);

  // Reset the conversation when switching sessions; the fresh session's
  // persisted messages come in through initialMessages.
  useEffect(() => {
    const sessionKey = sessionId ?? null;
    if (lastSessionKeyRef.current === sessionKey) return;
    if (sessionKey && sessionKey === ensuredSessionIdRef.current) {
      // The prop caught up with the session this panel just created.
      lastSessionKeyRef.current = sessionKey;
      return;
    }
    const isFirstRun = lastSessionKeyRef.current === undefined;
    lastSessionKeyRef.current = sessionKey;
    ensuredSessionIdRef.current = null;
    if (isFirstRun) return; // initial state already seeded from initialMessages
    const next = initialMessagesRef.current ?? [];
    messagesRef.current = next;
    setMessages(next);
  }, [sessionId]);

  const persistToSession = useCallback(
    (nextMessages: PanelMessage[]) => {
      if (!persistMessages) return;
      const targetSessionId = sessionId ?? ensuredSessionIdRef.current;
      if (!targetSessionId) return;
      const stored = panelMessagesToStoredMessages(nextMessages);
      void apiFetch(`/api/chat-sessions/${targetSessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ messages: stored }),
      }).catch((error) => {
        console.error('Failed to persist chat messages:', error);
      });
    },
    [persistMessages, sessionId]
  );

  /** Append/replace messages, notify the parent, and persist. */
  const commitMessages = useCallback(
    (updater: (prev: PanelMessage[]) => PanelMessage[]) => {
      const next = updater(messagesRef.current);
      messagesRef.current = next;
      setMessages(next);
      onMessagesChangeRef.current?.(next);
      persistToSession(next);
    },
    [persistToSession]
  );

  useEffect(() => {
    if (messages.length === 0 && !isLoading) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isLoading]);

  const runQuestion = useCallback(
    async (
      question: string,
      history: Array<{
        role: 'user' | 'assistant';
        text: string;
        sources?: GeneralChatSource[];
      }>
    ) => {
      setIsLoading(true);
      try {
        const targetSessionId = sessionId ?? ensuredSessionIdRef.current;
        const body: Record<string, unknown> = { question };
        if (targetSessionId) body.sessionId = targetSessionId;
        if (effectiveMode === 'meeting' && meetingId) body.meetingId = meetingId;
        if (history.length > 0) body.history = history;
        const response = await apiFetch<{ ok?: boolean; data?: unknown }>(
          '/api/ai/chat',
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        );
        const answer = normalizeGeneralChatAnswer(response?.data);
        commitMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'assistant', answer, at: Date.now() },
        ]);
      } catch (error) {
        const text =
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong while answering. Please try again.';
        commitMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'error', text, question, at: Date.now() },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [commitMessages, effectiveMode, meetingId, sessionId]
  );

  const handleSend = useCallback(async () => {
    const question = inputValue.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!question || isLoading) return;
    setInputValue('');
    if (
      persistMessages &&
      !sessionId &&
      !ensuredSessionIdRef.current &&
      onEnsureSessionRef.current
    ) {
      try {
        const createdId = await onEnsureSessionRef.current(question);
        if (createdId) {
          ensuredSessionIdRef.current = createdId;
        }
      } catch (error) {
        console.error('Failed to create chat session before send:', error);
      }
    }
    const history = buildChatHistoryPayload(messagesRef.current);
    commitMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'user', text: question, at: Date.now() },
    ]);
    void runQuestion(question, history);
  }, [commitMessages, inputValue, isLoading, persistMessages, runQuestion, sessionId]);

  const handleRetry = useCallback(
    (messageId: string, question: string) => {
      if (isLoading) return;
      commitMessages((prev) =>
        prev.filter((message) => message.id !== messageId)
      );
      const history = buildChatHistoryPayload(messagesRef.current).filter(
        (entry, index, entries) =>
          !(
            index === entries.length - 1 &&
            entry.role === 'user' &&
            entry.text === question
          )
      );
      void runQuestion(question, history);
    },
    [commitMessages, isLoading, runQuestion]
  );

  const handlePickPrompt = useCallback((prompt: string) => {
    setInputValue(prompt);
    inputRef.current?.focus();
  }, []);

  const heroPrompts =
    suggestedPrompts ??
    GENERAL_CHAT_SUGGESTED_PROMPTS.map((item) => item.prompt);

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex flex-col', compact ? 'gap-4' : 'gap-5', className)}>
        {messages.length === 0 && (
          <HeroState
            onPickPrompt={handlePickPrompt}
            disabled={isLoading}
            title={
              heroTitle ??
              (effectiveMode === 'meeting'
                ? 'Ask anything about this meeting.'
                : 'Ask anything about your meetings.')
            }
            prompts={heroPrompts}
            showDescription={!compact}
            showTip={!compact && suggestedPrompts === undefined}
            compact={compact}
          />
        )}
        {messages.length > 0 && (
          <div className="flex flex-col gap-5">
            {messages.map((message) => {
              if (message.role === 'user') {
                return <UserMessageBubble key={message.id} text={message.text} />;
              }
              if (message.role === 'assistant') {
                return (
                  <AssistantMessageBubble
                    key={message.id}
                    answer={message.answer}
                    showConfidence={!message.legacy}
                  />
                );
              }
              return (
                <ErrorMessageBubble
                  key={message.id}
                  text={message.text}
                  onRetry={() => handleRetry(message.id, message.question)}
                  disabled={isLoading}
                />
              );
            })}
          </div>
        )}
        {isLoading && <LoadingBubble />}
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder={
              effectiveMode === 'meeting'
                ? 'Ask about this meeting...'
                : 'Ask about meetings, tasks, people, or clients...'
            }
            onChange={(event) => setInputValue(event.target.value)}
            className="h-11 w-full rounded-full px-4"
            disabled={isLoading}
          />
          <Button
            type="submit"
            className="h-11 rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"
            disabled={isLoading || !inputValue.trim()}
          >
            <Send className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>
        <div ref={bottomRef} />
      </div>
    </TooltipProvider>
  );
}
