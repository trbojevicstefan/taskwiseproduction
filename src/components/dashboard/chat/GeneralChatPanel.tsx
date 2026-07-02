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

type PanelMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; answer: GeneralChatAnswer }
  | { id: string; role: 'error'; text: string; question: string };

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
    'inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 hover:bg-background';

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
  'rounded-2xl border border-border/50 bg-background/70 p-4 text-card-foreground shadow-[0_14px_30px_-24px_rgba(0,0,0,0.55)] backdrop-blur-md';

const AssistantMessageBubble: React.FC<{ answer: GeneralChatAnswer }> = ({
  answer,
}) => (
  <div className="flex items-start gap-3">
    <AssistantAvatar />
    <div className={cn('max-w-[78%] md:max-w-[560px]', assistantBubbleClass)}>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {answer.answer}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ConfidencePill confidence={answer.confidence} />
      </div>
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
        'flex items-center justify-center rounded-full border border-border/60 bg-background/80 shadow-sm',
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

export interface GeneralChatPanelProps {
  className?: string;
  /** Override the hero heading (defaults to the Chat page copy). */
  heroTitle?: string;
  /** Override the suggested prompts shown in the hero state. */
  suggestedPrompts?: string[];
  /** Tighter spacing for side-column embeds. Defaults to false. */
  compact?: boolean;
}

export default function GeneralChatPanel({
  className,
  heroTitle,
  suggestedPrompts,
  compact = false,
}: GeneralChatPanelProps) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && !isLoading) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isLoading]);

  const runQuestion = useCallback(async (question: string) => {
    setIsLoading(true);
    try {
      const response = await apiFetch<{ ok?: boolean; data?: unknown }>(
        '/api/ai/chat',
        {
          method: 'POST',
          body: JSON.stringify({ question }),
        }
      );
      const answer = normalizeGeneralChatAnswer(response?.data);
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: 'assistant', answer },
      ]);
    } catch (error) {
      const text =
        error instanceof Error && error.message
          ? error.message
          : 'Something went wrong while answering. Please try again.';
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: 'error', text, question },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSend = useCallback(() => {
    const question = inputValue.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!question || isLoading) return;
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'user', text: question },
    ]);
    setInputValue('');
    void runQuestion(question);
  }, [inputValue, isLoading, runQuestion]);

  const handleRetry = useCallback(
    (messageId: string, question: string) => {
      if (isLoading) return;
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
      void runQuestion(question);
    },
    [isLoading, runQuestion]
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
            title={heroTitle ?? 'Ask anything about your meetings.'}
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
            handleSend();
          }}
        >
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="Ask about meetings, tasks, people, or clients..."
            onChange={(event) => setInputValue(event.target.value)}
            className="h-11 w-full rounded-full border border-border/60 bg-background/80 px-4"
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
