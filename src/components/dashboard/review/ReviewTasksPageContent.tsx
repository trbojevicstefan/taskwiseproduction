"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  RefreshCw,
  Search,
} from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardScreenSkeleton from "@/components/dashboard/DashboardScreenSkeleton";
import CoreLoopStartPanel from "@/components/dashboard/home/CoreLoopStartPanel";
import { MeetingDetailSheet } from "@/components/dashboard/meetings/MeetingsPageContent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import type { Meeting } from "@/types/meeting";
import type { ExtractedTaskSchema, TaskReferenceSchema } from "@/types/chat";
import { cn } from "@/lib/utils";
import { isReviewTasksHomeEnabled } from "@/lib/simplification-flags";

type ReviewStatus = "needs_review" | "reviewed" | "processing" | "failed";

const isExtractedTask = (
  item: ExtractedTaskSchema | TaskReferenceSchema
): item is ExtractedTaskSchema => "id" in item && "priority" in item;

const getExtractedTasks = (meeting: Meeting) =>
  (meeting.extractedTasks || []).filter(isExtractedTask);

const isTaskConfirmed = (task: ExtractedTaskSchema) =>
  task.reviewStatus === "confirmed" ||
  task.taskState === "active" ||
  Boolean(task.addedToBoardId);

const needsTaskReview = (task: ExtractedTaskSchema): boolean => {
  if (task.completionSuggested) return true;
  if (!isTaskConfirmed(task)) return true;
  return Boolean(task.subtasks?.some(needsTaskReview));
};

const getReviewStatus = (meeting: Meeting): ReviewStatus => {
  if (meeting.state === "error") return "failed";
  if (meeting.state === "processing" || meeting.state === "raw_data_in") {
    return "processing";
  }
  const tasks = getExtractedTasks(meeting);
  if (tasks.some(needsTaskReview)) return "needs_review";
  if (tasks.length > 0) return "reviewed";
  return "processing";
};

const statusMeta: Record<
  ReviewStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  needs_review: {
    label: "Needs review",
    icon: ClipboardCheck,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  },
  reviewed: {
    label: "Reviewed",
    icon: CheckCircle2,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  processing: {
    label: "Processing",
    icon: Clock,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const getTaskCounts = (meeting: Meeting) => {
  const tasks = getExtractedTasks(meeting);
  let total = 0;
  let open = 0;
  let needsReview = 0;

  const walk = (items: ExtractedTaskSchema[]) => {
    items.forEach((task) => {
      total += 1;
      if ((task.status || "todo") !== "done") open += 1;
      if (needsTaskReview(task)) needsReview += 1;
      if (task.subtasks?.length) walk(task.subtasks);
    });
  };
  walk(tasks);

  return { total, open, needsReview };
};

const getTimeValue = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
};

export default function ReviewTasksPageContent() {
  const { meetings, isLoadingMeetingHistory, refreshMeetings } = useMeetingHistory();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMeetingId = searchParams.get("meeting");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const reviewHomeEnabled = isReviewTasksHomeEnabled();

  const reviewMeetings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return meetings
      .filter((meeting) => {
        if (!normalizedQuery) return true;
        return `${meeting.title || ""} ${meeting.summary || ""}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .map((meeting) => ({
        meeting,
        status: getReviewStatus(meeting),
        counts: getTaskCounts(meeting),
      }))
      .sort((a, b) => {
        const statusOrder: Record<ReviewStatus, number> = {
          failed: 0,
          needs_review: 1,
          processing: 2,
          reviewed: 3,
        };
        const statusDelta = statusOrder[a.status] - statusOrder[b.status];
        if (statusDelta !== 0) return statusDelta;
        return (
          getTimeValue(b.meeting.lastActivityAt || b.meeting.createdAt) -
          getTimeValue(a.meeting.lastActivityAt || a.meeting.createdAt)
        );
      });
  }, [meetings, query]);

  const groupedMeetings = useMemo(
    () =>
      (["needs_review", "processing", "failed", "reviewed"] as ReviewStatus[]).map(
        (status) => ({
          status,
          items: reviewMeetings.filter((item) => item.status === status),
        })
      ),
    [reviewMeetings]
  );

  useEffect(() => {
    if (requestedMeetingId) {
      setSelectedMeetingId(requestedMeetingId);
      return;
    }
    setSelectedMeetingId((current) => {
      if (current && reviewMeetings.some((item) => item.meeting.id === current)) {
        return current;
      }
      return reviewMeetings[0]?.meeting.id || null;
    });
  }, [requestedMeetingId, reviewMeetings]);

  const selectedMeeting = selectedMeetingId
    ? meetings.find((meeting) => meeting.id === selectedMeetingId) || null
    : null;

  if (isLoadingMeetingHistory) {
    return <DashboardScreenSkeleton />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <DashboardHeader
        pageIcon={ClipboardCheck}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Review Tasks</h1>}
      >
        <Button variant="outline" size="sm" onClick={() => void refreshMeetings()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </DashboardHeader>

      <div className="flex-1 overflow-hidden">
        <div className="grid h-full grid-cols-1 gap-0 lg:grid-cols-[360px_1fr]">
          <aside className="border-r bg-muted/20">
            <div className="space-y-4 p-4">
              {reviewHomeEnabled ? <CoreLoopStartPanel compact /> : null}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search meetings..."
                  className="pl-9"
                />
              </div>
            </div>
            <ScrollArea className="h-[calc(100vh-250px)] px-4 pb-4">
              <div className="space-y-5">
                {groupedMeetings.map(({ status, items }) => {
                  const meta = statusMeta[status];
                  const Icon = meta.icon;
                  if (!items.length) return null;
                  return (
                    <section key={status} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </div>
                        <Badge variant="secondary">{items.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {items.map(({ meeting, counts }) => {
                          const isSelected = meeting.id === selectedMeetingId;
                          return (
                            <button
                              key={meeting.id}
                              type="button"
                              onClick={() => {
                                setSelectedMeetingId(meeting.id);
                                router.replace(`/review?meeting=${meeting.id}`, {
                                  scroll: false,
                                });
                              }}
                              className={cn(
                                "w-full rounded-lg border bg-card p-3 text-left shadow-sm transition hover:border-primary/40",
                                isSelected && "border-primary bg-primary/5"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">
                                    {meeting.title || "Untitled meeting"}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {meeting.summary || "No summary yet."}
                                  </p>
                                </div>
                                <Badge className={cn("shrink-0 border", meta.className)}>
                                  {counts.needsReview > 0 ? counts.needsReview : counts.open}
                                </Badge>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                <span>{counts.total} tasks</span>
                                <span>{counts.open} open</span>
                                {meeting.ingestSource ? <span>{meeting.ingestSource}</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                {reviewMeetings.length === 0 ? (
                  <Card className="border-dashed shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">No meetings to review</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Create a task list from pasted notes or sync a meeting source to start reviewing.
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </ScrollArea>
          </aside>

          <main className="h-full overflow-auto">
            {selectedMeeting ? (
              <MeetingDetailSheet
                id={selectedMeeting.id}
                onClose={() => setSelectedMeetingId(null)}
                onNavigateToChat={() => router.push("/chat")}
                variant="page"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-md text-center">
                  <ClipboardCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Select a meeting</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Choose a meeting from the queue to review suggested tasks, owners, due dates, and status.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
