// src/components/dashboard/reports/ReportsPageContent.tsx
"use client";

import { useMemo, useState } from "react";
import { format, isSameMonth, isSameWeek, addDays, subDays } from "date-fns";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Users,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  Timer,
} from "lucide-react";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import { useTasks } from "@/contexts/TaskContext";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const toDateValue = (value: any) => {
  if (!value) return null;
  if (value?.toDate) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value?.toMillis) {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const StatCard = ({
  title,
  value,
  description,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ElementType;
  tone?: "default" | "success" | "warning";
}) => {
  const toneClasses = {
    default: "from-slate-500/10 via-transparent to-transparent border-border/50",
    success: "from-emerald-500/15 via-transparent to-transparent border-emerald-500/30",
    warning: "from-amber-500/15 via-transparent to-transparent border-amber-500/30",
  };

  return (
    <Card className={`relative overflow-hidden border ${toneClasses[tone]}`}>
      <div className="absolute inset-0 bg-gradient-to-br opacity-80" />
      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
          <div className="rounded-full bg-muted/70 p-2">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
        <div className="mt-3 text-3xl font-semibold text-foreground">{value}</div>
        <CardDescription className="text-xs text-muted-foreground">{description}</CardDescription>
      </CardHeader>
    </Card>
  );
};

type ReportRange = "7d" | "30d" | "90d" | "this_week" | "this_month" | "all";

const rangeLabel: Record<ReportRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_week: "This week",
  this_month: "This month",
  all: "All time",
};

const getRangeStart = (range: ReportRange, now: Date) => {
  switch (range) {
    case "7d":
      return subDays(now, 7);
    case "30d":
      return subDays(now, 30);
    case "90d":
      return subDays(now, 90);
    case "this_week":
      return subDays(now, 7);
    case "this_month":
      return subDays(now, 30);
    default:
      return null;
  }
};

const flattenMeetingTasks = (meetingTasks: any[], meetingMeta: { createdAt?: any; startTime?: any; lastActivityAt?: any; id?: string }) => {
  const createdAt =
    meetingMeta.startTime ||
    meetingMeta.createdAt ||
    meetingMeta.lastActivityAt ||
    null;

  const walk = (tasks: any[]): any[] =>
    tasks.flatMap((task) => {
      const base = {
        ...task,
        createdAt,
        sourceMeetingId: meetingMeta.id || null,
      };
      const subtasks = task.subtasks ? walk(task.subtasks) : [];
      return [base, ...subtasks];
    });

  return walk(meetingTasks || []);
};

export default function ReportsPageContent() {
  const { meetings, isLoadingMeetingHistory } = useMeetingHistory();
  const { tasks, isLoadingTasks } = useTasks();
  const [range, setRange] = useState<ReportRange>("30d");

  const metrics = useMemo(() => {
    const now = new Date();
    const rangeStart = getRangeStart(range, now);
    const isInRange = (date: Date | null) => {
      if (!date) return true;
      if (!rangeStart) return true;
      const time = date.getTime();
      return time >= rangeStart.getTime() && time <= now.getTime();
    };

    const meetingDates = meetings.map((meeting) => ({
      meeting,
      date: toDateValue(meeting.startTime) || toDateValue(meeting.lastActivityAt),
    }));

    const meetingsInRange = meetingDates.filter(({ date }) => isInRange(date)).map(({ meeting }) => meeting);
    const meetingsThisWeek = meetingDates.filter(({ date }) => date && isSameWeek(date, now)).length;
    const meetingsThisMonth = meetingDates.filter(({ date }) => date && isSameMonth(date, now)).length;

    const meetingDerivedTasks = meetings.flatMap((meeting) =>
      flattenMeetingTasks(meeting.extractedTasks || [], meeting)
    );
    const hasSessionTasks = tasks.some(
      (task) => task.sourceSessionType === "meeting" || task.sourceSessionType === "chat"
    );
    const reportTasks =
      tasks.length === 0
        ? meetingDerivedTasks
        : hasSessionTasks
          ? tasks
          : [...tasks, ...meetingDerivedTasks];

    const tasksInRange = reportTasks.filter((task) => {
      const createdAt = toDateValue(task.createdAt);
      if (!createdAt) return true;
      return isInRange(createdAt);
    });

    const normalizeStatus = (status?: string | null) => {
      const value = (status || "").toLowerCase().trim();
      if (["done", "completed", "complete", "closed", "finished"].includes(value)) return "done";
      if (["in progress", "inprogress", "in_progress", "active", "doing", "started"].includes(value)) return "inprogress";
      if (["recurring", "repeat", "repeating"].includes(value)) return "recurring";
      if (["todo", "to do", "pending", "open", "backlog", "new"].includes(value)) return "todo";
      return "todo";
    };

    const normalizePriority = (priority?: string | null) => {
      const value = (priority || "").toLowerCase().trim();
      if (["high", "urgent", "critical"].includes(value)) return "high";
      if (["low", "minor"].includes(value)) return "low";
      return "medium";
    };

    const getAssigneeName = (task: any) =>
      task.assignee?.name ||
      task.assignee?.displayName ||
      task.assignee?.email ||
      task.assigneeName ||
      null;

    const totalTasks = tasksInRange.length;
    const completedTasks = tasksInRange.filter((task) => normalizeStatus(task.status) === "done").length;
    const openTasks = tasksInRange.filter((task) => normalizeStatus(task.status) !== "done").length;
    const unassignedTasks = tasksInRange.filter((task) => !getAssigneeName(task)).length;
    const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    const tasksByPriority = tasksInRange
      .filter((task) => task.status !== "done")
      .reduce(
        (acc, task) => {
        acc[normalizePriority(task.priority)] += 1;
        return acc;
      },
      { high: 0, medium: 0, low: 0 }
    );

    const tasksByStatus = tasksInRange.reduce(
      (acc, task) => {
        const normalized = normalizeStatus(task.status);
        acc[normalized] += 1;
        return acc;
      },
      { todo: 0, inprogress: 0, done: 0, recurring: 0 }
    );

    const uniqueAttendees = new Set<string>();
    meetingsInRange.forEach((meeting) => {
      (meeting.attendees || []).forEach((person) => {
        if (person.email) uniqueAttendees.add(person.email.toLowerCase());
        else if (person.name) uniqueAttendees.add(person.name.toLowerCase());
      });
    });

    const totalActionItems = meetingsInRange.reduce(
      (sum, meeting) => sum + (meeting.extractedTasks?.length || 0),
      0
    );
    const avgActions = meetingsInRange.length > 0 ? Math.round(totalActionItems / meetingsInRange.length) : 0;

    const topAssignees = tasksInRange
      .filter((task) => getAssigneeName(task))
      .reduce((acc: Record<string, number>, task) => {
        const key = getAssigneeName(task) || "Unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const topAssigneeList = Object.entries(topAssignees)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const recentMeetings = [...meetingsInRange]
      .sort((a, b) => {
        const dateA = toDateValue(a.lastActivityAt)?.getTime() || 0;
        const dateB = toDateValue(b.lastActivityAt)?.getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 5);

    const overdueTasks = tasksInRange.filter((task) => {
      if (!task.dueAt) return false;
      const dueDate = toDateValue(task.dueAt);
      return dueDate ? dueDate < now && normalizeStatus(task.status) !== "done" : false;
    });

    const dueSoonTasks = tasksInRange.filter((task) => {
      if (!task.dueAt) return false;
      const dueDate = toDateValue(task.dueAt);
      if (!dueDate) return false;
      const withinWeek = dueDate >= now && dueDate <= addDays(now, 7);
      return withinWeek && normalizeStatus(task.status) !== "done";
    });

    const bestMeetings = meetingsInRange
      .map((meeting) => {
        const tasksCount = meeting.extractedTasks?.length || 0;
        const completedCount =
          meeting.extractedTasks?.filter((task) => (task.status || "todo") === "done").length || 0;
        const completionRate = tasksCount > 0 ? Math.round((completedCount / tasksCount) * 100) : 0;
        return { meeting, completionRate, tasksCount };
      })
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 5);

    const sentimentLeaders = meetingsInRange
      .filter((meeting) => meeting.overallSentiment != null)
      .sort((a, b) => (b.overallSentiment || 0) - (a.overallSentiment || 0))
      .slice(0, 5);

    return {
      meetingsThisWeek,
      meetingsThisMonth,
      totalTasks,
      completedTasks,
      openTasks,
      completionRate,
      tasksByPriority,
      tasksByStatus,
      uniqueAttendees: uniqueAttendees.size,
      avgActions,
      totalActionItems,
      topAssigneeList,
      recentMeetings,
      overdueTasks,
      dueSoonTasks,
      bestMeetings,
      sentimentLeaders,
      meetingsInRangeCount: meetingsInRange.length,
      unassignedTasks,
    };
  }, [meetings, tasks, range]);

  const isLoading = isLoadingMeetingHistory || isLoadingTasks;

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        pageIcon={BarChart3}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Reports</h1>}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              {rangeLabel[range]}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(rangeLabel) as ReportRange[]).map((key) => (
              <DropdownMenuItem key={key} onClick={() => setRange(key)}>
                {rangeLabel[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </DashboardHeader>
      <div className="flex-grow space-y-6 p-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Meetings"
              value={metrics.meetingsInRangeCount}
              description={`${metrics.meetingsThisWeek} this week`}
              icon={CalendarDays}
            />
            <StatCard
              title="Actions Extracted"
              value={metrics.totalActionItems}
              description={`Avg ${metrics.avgActions} per meeting`}
              icon={ClipboardList}
              tone="warning"
            />
            <StatCard
              title="Open Tasks"
              value={metrics.openTasks}
              description={`${metrics.completedTasks} completed • ${metrics.unassignedTasks} unassigned`}
              icon={CheckCircle2}
              tone="default"
            />
            <StatCard
              title="People Involved"
              value={metrics.uniqueAttendees}
              description={`${metrics.meetingsThisMonth} meetings this month`}
              icon={Users}
              tone="success"
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Task Health</CardTitle>
              <CardDescription>Completion rate across active projects and meetings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Completion rate</span>
                    <span className="font-semibold">{metrics.completionRate}%</span>
                  </div>
                  <Progress value={metrics.completionRate} className="h-2" />
                  <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">To do</span>
                    <span className="font-semibold">{metrics.tasksByStatus.todo}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">In progress</span>
                    <span className="font-semibold">{metrics.tasksByStatus.inprogress}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Recurring</span>
                    <span className="font-semibold">{metrics.tasksByStatus.recurring}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unassigned</span>
                    <span className="font-semibold">{metrics.unassignedTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Done</span>
                    <span className="font-semibold">{metrics.tasksByStatus.done}</span>
                  </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">SLA Snapshot</CardTitle>
              <CardDescription>Overdue and upcoming deadlines.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" /> Overdue
                    </span>
                    <Badge variant="destructive">{metrics.overdueTasks.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Timer className="h-4 w-4" /> Due soon
                    </span>
                    <Badge variant="secondary">{metrics.dueSoonTasks.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <TrendingUp className="h-4 w-4" /> Total open
                    </span>
                    <Badge variant="outline">{metrics.openTasks}</Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Meetings</CardTitle>
              <CardDescription>Jump back into your latest meeting summaries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : metrics.recentMeetings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No meetings yet.</p>
              ) : (
                metrics.recentMeetings.map((meeting) => {
                  const date = toDateValue(meeting.lastActivityAt);
                  return (
                    <Link
                      key={meeting.id}
                      href={`/meetings/${meeting.id}`}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3 transition hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {date ? format(date, "MMM d, yyyy") : "Recently updated"}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {(meeting.extractedTasks || []).length} tasks
                      </span>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Owners</CardTitle>
              <CardDescription>People with the most assigned tasks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : metrics.topAssigneeList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignees yet.</p>
              ) : (
                <>
                  {metrics.unassignedTasks > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Unassigned</span>
                      <Badge variant="outline">{metrics.unassignedTasks} tasks</Badge>
                    </div>
                  )}
                  {metrics.topAssigneeList.map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{name}</span>
                      <Badge variant="outline">{count} tasks</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Priority Mix</CardTitle>
              <CardDescription>Open tasks grouped by priority.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">High</span>
                    <Badge variant="destructive">{metrics.tasksByPriority.high}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Medium</span>
                    <Badge variant="secondary">{metrics.tasksByPriority.medium}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Low</span>
                    <Badge variant="outline">{metrics.tasksByPriority.low}</Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Best Performing Meetings</CardTitle>
              <CardDescription>Highest completion rate of action items.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : metrics.bestMeetings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No meetings with actionable tasks yet.</p>
              ) : (
                metrics.bestMeetings.map(({ meeting, completionRate, tasksCount }) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3 transition hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{meeting.title}</p>
                      <p className="text-xs text-muted-foreground">{tasksCount} tasks</p>
                    </div>
                    <Badge variant="outline">{completionRate}%</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sentiment Leaders</CardTitle>
              <CardDescription>Meetings with the strongest sentiment scores.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : metrics.sentimentLeaders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sentiment data yet.</p>
              ) : (
                metrics.sentimentLeaders.map((meeting) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3 transition hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{meeting.title}</p>
                      <p className="text-xs text-muted-foreground">Sentiment score</p>
                    </div>
                    <Badge variant="secondary">
                      {Math.round((meeting.overallSentiment || 0) * 100)}%
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Assignee Breakdown</CardTitle>
              <CardDescription>Who owns the most work (open + done).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : metrics.topAssigneeList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignees yet.</p>
              ) : (
                metrics.topAssigneeList.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{name}</span>
                    <Badge variant="outline">{count} tasks</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
