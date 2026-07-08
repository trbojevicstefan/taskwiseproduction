// src/components/dashboard/meetings/MeetingDetailSections.tsx
"use client";

/**
 * Priority 13 meeting detail sections: presentational building blocks for the
 * action-oriented meeting page (agenda, completion suggestions with evidence,
 * linked chat sessions, related clients, source integration, transcript
 * viewer with jump-to-line highlighting, and the generated-report dialog).
 *
 * These components are deliberately stateless — MeetingDetailSheet owns the
 * data and handlers — so they stay easy to test with static markup.
 */

import React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  Crosshair,
  FileText,
  Loader2,
  MessageSquareText,
  Plug,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { transcriptLineDomId } from "@/lib/transcript-navigation";
import type { GeneralChatSource } from "@/types/general-chat";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export type MeetingEvidenceSnippet = {
  snippet: string;
  speaker?: string | null;
  timestamp?: string | null;
};

export type MeetingCompletionSuggestionItem = {
  taskId: string;
  title: string;
  assigneeName?: string | null;
  reason?: string | null;
  evidence: MeetingEvidenceSnippet[];
};

export type MeetingLinkedChatSessionItem = {
  id: string;
  title: string;
};

export type MeetingRelatedClientItem = {
  id: string;
  name: string;
  company?: string | null;
};

export type MeetingReportData = {
  meetingId?: string;
  report: string;
  sources: GeneralChatSource[];
  grounded?: boolean;
  generatedAt?: string;
};

export const MEETING_SOURCE_LABELS: Record<string, string> = {
  fathom: "Fathom",
  fireflies: "Fireflies",
  grain: "Grain",
  manual: "Manual import",
  google: "Google Meet",
  import: "Imported",
};

const SectionCard = ({
  icon,
  title,
  action,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={cn("work-panel p-4", className)}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
);

// ---------------------------------------------------------------------------
// Agenda (read-only render; editable agendas live on /planning)
// ---------------------------------------------------------------------------

export type AgendaDisplayItem = { title: string; notes?: string };

/**
 * Normalize an agenda field into display items. Canonical shape is
 * Array<{ id, title, notes, order }> (src/lib/meeting-agenda.ts, edited on
 * /planning); legacy/loose shapes (plain string, string[], { text }[]) are
 * tolerated. Structured sections are ordered by `order`.
 */
export const normalizeAgendaItems = (agenda: unknown): AgendaDisplayItem[] => {
  if (typeof agenda === "string") {
    return agenda
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .map((title) => ({ title }));
  }
  if (Array.isArray(agenda)) {
    return agenda
      .map((item, index) => {
        if (typeof item === "string") {
          return { title: item.trim(), notes: undefined, order: index, index };
        }
        if (item && typeof item === "object") {
          const record = item as {
            title?: unknown;
            notes?: unknown;
            text?: unknown;
            order?: unknown;
          };
          const title =
            typeof record.title === "string" && record.title.trim()
              ? record.title.trim()
              : typeof record.text === "string"
                ? record.text.trim()
                : "";
          const notes =
            typeof record.notes === "string" && record.notes.trim()
              ? record.notes.trim()
              : undefined;
          const order =
            typeof record.order === "number" ? record.order : index;
          return { title, notes, order, index };
        }
        return { title: "", notes: undefined, order: index, index };
      })
      .filter((item) => item.title)
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ title, notes }) => ({ title, notes }));
  }
  return [];
};

export function MeetingAgendaSection({ agenda }: { agenda: unknown }) {
  const items = normalizeAgendaItems(agenda);
  if (!items.length) return null;
  return (
    <SectionCard
      icon={<ClipboardList className="h-4 w-4 text-primary" />}
      title="Agenda"
    >
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
        {items.map((item, index) => (
          <li key={`${index}-${item.title.slice(0, 24)}`}>
            {item.title}
            {item.notes && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.notes}
              </p>
            )}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Completion suggestions (accept/dismiss wired to /api/tasks/cleanup/actions)
// ---------------------------------------------------------------------------

export function MeetingCompletionSuggestionsSection({
  suggestions,
  onAccept,
  onDismiss,
  onJumpToTranscript,
  pendingTaskId,
}: {
  suggestions: MeetingCompletionSuggestionItem[];
  onAccept: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onJumpToTranscript?: (snippet: string) => void;
  pendingTaskId?: string | null;
}) {
  if (!suggestions.length) return null;
  return (
    <SectionCard
      icon={<CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
      title="Completion suggestions"
      action={
        <Badge variant="outline" className="rounded-full text-[11px]">
          {suggestions.length} to review
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        These tasks look already done based on what was said. Accept to mark
        them complete, or dismiss to keep them open.
      </p>
      <div className="space-y-2">
        {suggestions.map((suggestion) => {
          const isPending = pendingTaskId === suggestion.taskId;
          return (
            <div key={suggestion.taskId} className="data-row px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {suggestion.title}
                  </p>
                  {(suggestion.assigneeName || suggestion.reason) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {suggestion.assigneeName
                        ? `Owner: ${suggestion.assigneeName}`
                        : null}
                      {suggestion.assigneeName && suggestion.reason ? " — " : null}
                      {suggestion.reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    className="h-7"
                    disabled={isPending}
                    onClick={() => onAccept(suggestion.taskId)}
                  >
                    {isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Accept
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-7"
                    disabled={isPending}
                    onClick={() => onDismiss(suggestion.taskId)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
              {suggestion.evidence.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {suggestion.evidence.slice(0, 3).map((evidence, index) => (
                    <div
                      key={`${suggestion.taskId}-evidence-${index}`}
                      className="work-inset flex items-start justify-between gap-2 px-2.5 py-1.5"
                    >
                      <p className="text-xs leading-snug text-muted-foreground">
                        {evidence.timestamp ? (
                          <span className="mr-1 tabular-nums text-foreground/70">
                            [{evidence.timestamp}]
                          </span>
                        ) : null}
                        {evidence.speaker ? (
                          <span className="mr-1 font-medium text-foreground/80">
                            {evidence.speaker}:
                          </span>
                        ) : null}
                        “{evidence.snippet}”
                      </p>
                      {onJumpToTranscript && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                          onClick={() => onJumpToTranscript(evidence.snippet)}
                        >
                          <Crosshair className="h-3 w-3" />
                          Jump to transcript
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Linked chat sessions
// ---------------------------------------------------------------------------

export function MeetingLinkedChatSection({
  sessions,
  onOpenSession,
}: {
  sessions: MeetingLinkedChatSessionItem[];
  onOpenSession: (sessionId: string) => void;
}) {
  if (!sessions.length) return null;
  return (
    <SectionCard
      icon={<MessageSquareText className="h-4 w-4 text-primary" />}
      title="Linked chats"
    >
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="data-row flex items-center justify-between gap-2 px-3 py-2"
          >
            <p className="truncate text-sm text-foreground">{session.title}</p>
            <Button
              size="xs"
              variant="outline"
              className="h-7 shrink-0"
              onClick={() => onOpenSession(session.id)}
            >
              Open chat
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Related clients / companies (best-effort from attendee directory matches)
// ---------------------------------------------------------------------------

export function MeetingRelatedClientsSection({
  clients,
}: {
  clients: MeetingRelatedClientItem[];
}) {
  if (!clients.length) return null;
  return (
    <SectionCard
      icon={<Users className="h-4 w-4 text-primary" />}
      title="Related clients"
    >
      <div className="space-y-2">
        {clients.map((client) => (
          <div
            key={client.id}
            className="data-row flex items-center justify-between gap-2 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {client.name}
              </p>
              {client.company && (
                <p className="truncate text-xs text-muted-foreground">
                  {client.company}
                </p>
              )}
            </div>
            <Button size="xs" variant="ghost" className="h-7 shrink-0" asChild>
              <Link href={`/people/${client.id}`}>View</Link>
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Source integration
// ---------------------------------------------------------------------------

export function MeetingSourceSection({
  ingestSource,
}: {
  ingestSource?: string | null;
}) {
  if (!ingestSource) return null;
  const label = MEETING_SOURCE_LABELS[ingestSource] || ingestSource;
  return (
    <SectionCard icon={<Plug className="h-4 w-4 text-primary" />} title="Source">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Badge variant="secondary" className="rounded-full">
          {label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          This meeting was ingested from {label}.
        </span>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Transcript viewer with per-line ids for jump-to-transcript
// ---------------------------------------------------------------------------

export function MeetingTranscriptViewer({
  lines,
  highlightIndex,
}: {
  lines: string[];
  highlightIndex?: number | null;
}) {
  if (!lines.length) {
    return (
      <div className="work-panel p-8 text-center text-sm text-muted-foreground">
        No transcript is attached to this meeting.
      </div>
    );
  }
  return (
    <div className="work-panel p-4">
      <div className="max-h-[65vh] space-y-0.5 overflow-y-auto pr-2">
        {lines.map((line, index) => (
          <p
            key={index}
            id={transcriptLineDomId(index)}
            data-transcript-line={index}
            className={cn(
              "whitespace-pre-wrap rounded px-1.5 py-0.5 font-mono text-xs leading-relaxed text-muted-foreground transition-colors",
              index === highlightIndex &&
                "bg-primary/15 text-foreground ring-1 ring-primary/40"
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generated report dialog
// ---------------------------------------------------------------------------

export function MeetingReportDialog({
  open,
  onOpenChange,
  meetingTitle,
  isGenerating,
  report,
  error,
  onCopy,
  onJumpToTranscript,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingTitle: string;
  isGenerating: boolean;
  report: MeetingReportData | null;
  error?: string | null;
  onCopy: () => void;
  onJumpToTranscript?: (snippet: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Meeting report
          </DialogTitle>
          <DialogDescription>
            Source-grounded report for “{meetingTitle}”.
          </DialogDescription>
        </DialogHeader>

        {isGenerating && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Generating report…
          </div>
        )}

        {!isGenerating && error && (
          <div className="work-inset px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {!isGenerating && !error && report && (
          <div className="space-y-3">
            <div className="work-inset max-h-[45vh] overflow-y-auto px-3 py-2">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {report.report}
              </pre>
            </div>
            {report.sources.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sources
                </p>
                <div className="space-y-1.5">
                  {report.sources.map((source, index) => (
                    <div
                      key={`${source.sourceId}-${index}`}
                      className="data-row flex items-start justify-between gap-2 px-2.5 py-1.5"
                    >
                      <p className="text-xs leading-snug text-muted-foreground">
                        <Badge
                          variant="outline"
                          className="mr-1.5 rounded-full text-[10px] capitalize"
                        >
                          {source.sourceType}
                        </Badge>
                        {source.timestamp ? (
                          <span className="mr-1 tabular-nums text-foreground/70">
                            [{source.timestamp}]
                          </span>
                        ) : null}
                        “{source.snippet}”
                      </p>
                      {onJumpToTranscript &&
                        source.sourceType === "transcript" && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                            onClick={() => onJumpToTranscript(source.snippet)}
                          >
                            <Crosshair className="h-3 w-3" />
                            Jump to transcript
                          </Button>
                        )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {report.grounded === false && (
              <p className="text-xs text-muted-foreground">
                No transcript or summary is attached, so this report only
                reflects structured data.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCopy}
            disabled={isGenerating || !report?.report}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy report
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
