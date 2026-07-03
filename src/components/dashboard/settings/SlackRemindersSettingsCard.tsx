"use client";

import React, { useEffect, useState } from "react";
import { Bell, Loader2, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SLACK_REMINDER_SETTINGS,
  type SlackReminderDeliverMode,
  type SlackReminderDigestFrequency,
  type SlackReminderSettings,
} from "@/lib/workspace-settings";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const MAX_DAYS_BEFORE_ENTRIES = 3;

/** Draft of free-text inputs that need normalization before persisting. */
export type SlackReminderDraftInputs = {
  /** Raw values of the up-to-3 "days before due" number inputs. */
  daysBeforeInputs: string[];
  /** Raw value of the max-reminders-per-task number input. */
  maxPerTaskInput: string;
  /** Raw value of the default channel id input. */
  defaultChannelInput: string;
};

/**
 * Normalizes the editable draft into a persistable settings payload —
 * ints 1..30 (unique, sorted, max 3) for remindDaysBefore, maxRemindersPerTask
 * clamped to 1..10, and a trimmed-or-null defaultChannelId. Exported so tests
 * can assert the exact save payload shape.
 */
export const buildSlackReminderSettingsPayload = (
  settings: SlackReminderSettings,
  inputs: SlackReminderDraftInputs
): SlackReminderSettings => {
  const remindDaysBefore = Array.from(
    new Set(
      inputs.daysBeforeInputs
        .map((raw) => Math.round(Number(raw)))
        .filter((value) => Number.isInteger(value) && value > 0 && value <= 30)
    )
  )
    .sort((left, right) => left - right)
    .slice(0, MAX_DAYS_BEFORE_ENTRIES);

  const parsedMax = Math.round(Number(inputs.maxPerTaskInput));
  const maxRemindersPerTask = Number.isFinite(parsedMax)
    ? Math.min(10, Math.max(1, parsedMax))
    : DEFAULT_SLACK_REMINDER_SETTINGS.maxRemindersPerTask;

  const defaultChannelId = inputs.defaultChannelInput.trim() || null;

  return {
    enabled: settings.enabled,
    remindDaysBefore:
      remindDaysBefore.length > 0
        ? remindDaysBefore
        : [...DEFAULT_SLACK_REMINDER_SETTINGS.remindDaysBefore],
    remindOnDue: settings.remindOnDue,
    remindOverdue: settings.remindOverdue,
    maxRemindersPerTask,
    deliver: settings.deliver,
    defaultChannelId,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    digest: settings.digest,
  };
};

const toDaysInputs = (remindDaysBefore: number[]): string[] =>
  Array.from({ length: MAX_DAYS_BEFORE_ENTRIES }, (_, index) =>
    remindDaysBefore[index] !== undefined ? String(remindDaysBefore[index]) : ""
  );

const resolveConfiguredSettings = (user: unknown): SlackReminderSettings => {
  const configured = (
    user as { activeWorkspaceSlackReminders?: SlackReminderSettings } | null
  )?.activeWorkspaceSlackReminders;
  if (!configured) {
    return DEFAULT_SLACK_REMINDER_SETTINGS;
  }
  return {
    ...DEFAULT_SLACK_REMINDER_SETTINGS,
    ...configured,
    remindDaysBefore: Array.isArray(configured.remindDaysBefore)
      ? configured.remindDaysBefore
      : [...DEFAULT_SLACK_REMINDER_SETTINGS.remindDaysBefore],
  };
};

export default function SlackRemindersSettingsCard({
  className,
}: {
  className?: string;
}) {
  const { user, updateUserProfile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<SlackReminderSettings>(() =>
    resolveConfiguredSettings(user)
  );
  const [daysBeforeInputs, setDaysBeforeInputs] = useState<string[]>(() =>
    toDaysInputs(resolveConfiguredSettings(user).remindDaysBefore)
  );
  const [maxPerTaskInput, setMaxPerTaskInput] = useState<string>(() =>
    String(resolveConfiguredSettings(user).maxRemindersPerTask)
  );
  const [defaultChannelInput, setDefaultChannelInput] = useState<string>(
    () => resolveConfiguredSettings(user).defaultChannelId || ""
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const workspaceName = user?.workspace?.name || "";
  const canSave = Boolean(workspaceName) && user?.activeWorkspaceRole !== "member";

  useEffect(() => {
    const configured = (
      user as { activeWorkspaceSlackReminders?: SlackReminderSettings } | null
    )?.activeWorkspaceSlackReminders;
    if (configured) {
      const merged = resolveConfiguredSettings(user);
      setSettings(merged);
      setDaysBeforeInputs(toDaysInputs(merged.remindDaysBefore));
      setMaxPerTaskInput(String(merged.maxRemindersPerTask));
      setDefaultChannelInput(merged.defaultChannelId || "");
    }
  }, [user]);

  const handleSave = async () => {
    if (!workspaceName) {
      toast({
        title: "No active workspace",
        description: "Slack reminder settings require an active workspace.",
        variant: "destructive",
      });
      return;
    }

    const nextSettings = buildSlackReminderSettingsPayload(settings, {
      daysBeforeInputs,
      maxPerTaskInput,
      defaultChannelInput,
    });
    setSettings(nextSettings);
    setDaysBeforeInputs(toDaysInputs(nextSettings.remindDaysBefore));
    setMaxPerTaskInput(String(nextSettings.maxRemindersPerTask));
    setDefaultChannelInput(nextSettings.defaultChannelId || "");

    setIsSaving(true);
    try {
      await updateUserProfile({
        workspace: {
          name: workspaceName,
          settings: {
            slackReminders: nextSettings,
          },
        } as any,
      });
      toast({
        title: "Slack Reminders Updated",
        description: "Reminder schedule, delivery, and digest settings were saved.",
      });
    } catch (error) {
      console.error("Failed to save Slack reminder settings:", error);
      toast({
        title: "Error",
        description: "Could not save Slack reminder settings.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/slack/reminders/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not sync reminders.");
      }
      const enrolled = Number(payload?.enrolled) || 0;
      const canceledStale = Number(payload?.canceledStale) || 0;
      const skipped = Number(payload?.skipped) || 0;
      toast({
        title: "Reminder Sync Complete",
        description: `Enrolled ${enrolled}, canceled ${canceledStale} stale, skipped ${skipped}.`,
      });
    } catch (error) {
      console.error("Failed to sync Slack reminders:", error);
      toast({
        title: "Sync Failed",
        description:
          error instanceof Error ? error.message : "Could not sync reminders.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDaysBeforeChange = (index: number, value: string) => {
    setDaysBeforeInputs((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? value : entry))
    );
  };

  return (
    <Card className={cn("shadow-lg rounded-xl", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 font-headline text-xl">
          <Bell className="text-sky-400 drop-shadow-[0_2px_4px_rgba(56,189,248,0.5)]" />
          Slack Reminders
        </CardTitle>
        <CardDescription>
          Schedule Slack nudges for tasks before, on, and after their due date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Enable Slack reminders</Label>
            <p className="text-xs text-muted-foreground">
              Automatically enroll tasks with due dates into scheduled Slack reminders.
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              setSettings((current) => ({ ...current, enabled: checked }))
            }
            aria-label="Enable Slack reminders"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Remind days before due</Label>
          <p className="text-xs text-muted-foreground">
            Up to three lead times, in days before the due date (1–30). Leave a field
            empty to skip it.
          </p>
          <div className="flex items-center gap-2">
            {daysBeforeInputs.map((value, index) => (
              <Input
                key={index}
                type="number"
                min={1}
                max={30}
                className="w-20"
                value={value}
                placeholder="—"
                aria-label={`Days before due ${index + 1}`}
                onChange={(event) => handleDaysBeforeChange(index, event.target.value)}
                disabled={!settings.enabled}
              />
            ))}
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="slack-reminders-on-due" className="text-sm font-normal">
              Remind on due date
            </Label>
            <Switch
              id="slack-reminders-on-due"
              checked={settings.remindOnDue}
              onCheckedChange={(checked) =>
                setSettings((current) => ({ ...current, remindOnDue: checked }))
              }
              disabled={!settings.enabled}
              aria-label="Remind on due date"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="slack-reminders-overdue" className="text-sm font-normal">
              Remind when overdue
            </Label>
            <Switch
              id="slack-reminders-overdue"
              checked={settings.remindOverdue}
              onCheckedChange={(checked) =>
                setSettings((current) => ({ ...current, remindOverdue: checked }))
              }
              disabled={!settings.enabled}
              aria-label="Remind when overdue"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="space-y-1">
            <Label htmlFor="slack-reminders-max-per-task" className="text-sm font-medium">
              Max reminders per task
            </Label>
            <p className="text-xs text-muted-foreground">
              Hard cap of scheduled and sent reminders per task (1–10).
            </p>
          </div>
          <Input
            id="slack-reminders-max-per-task"
            type="number"
            min={1}
            max={10}
            className="w-20"
            value={maxPerTaskInput}
            onChange={(event) => setMaxPerTaskInput(event.target.value)}
            disabled={!settings.enabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slack-reminders-deliver" className="text-sm font-medium">
            Deliver via
          </Label>
          <Select
            value={settings.deliver}
            onValueChange={(value) =>
              setSettings((current) => ({
                ...current,
                deliver: value as SlackReminderDeliverMode,
              }))
            }
            disabled={!settings.enabled}
          >
            <SelectTrigger id="slack-reminders-deliver">
              <SelectValue placeholder="Select delivery" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dm">Direct message</SelectItem>
              <SelectItem value="channel">Channel</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Direct messages go to the task assignee&apos;s linked Slack account; the
            channel is used as a fallback when no Slack user can be resolved.
          </p>
          {settings.deliver === "channel" ? (
            <div className="space-y-1 pt-1">
              <Label htmlFor="slack-reminders-channel" className="text-xs font-medium">
                Default channel ID
              </Label>
              <Input
                id="slack-reminders-channel"
                value={defaultChannelInput}
                placeholder="C0123456789"
                onChange={(event) => setDefaultChannelInput(event.target.value)}
                disabled={!settings.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Paste the Slack channel ID (from the channel&apos;s details page). The
                bot must be a member of the channel.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Quiet hours</Label>
          <p className="text-xs text-muted-foreground">
            Reminders that land inside quiet hours are delayed until they end. Uses the
            workspace timezone (UTC fallback). Equal values disable quiet hours.
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={String(settings.quietHoursStart)}
              onValueChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  quietHoursStart: Number(value),
                }))
              }
              disabled={!settings.enabled}
            >
              <SelectTrigger className="w-28" aria-label="Quiet hours start">
                <SelectValue placeholder="Start" />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">to</span>
            <Select
              value={String(settings.quietHoursEnd)}
              onValueChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  quietHoursEnd: Number(value),
                }))
              }
              disabled={!settings.enabled}
            >
              <SelectTrigger className="w-28" aria-label="Quiet hours end">
                <SelectValue placeholder="End" />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slack-reminders-digest" className="text-sm font-medium">
            Daily digest
          </Label>
          <Select
            value={settings.digest}
            onValueChange={(value) =>
              setSettings((current) => ({
                ...current,
                digest: value as SlackReminderDigestFrequency,
              }))
            }
            disabled={!settings.enabled}
          >
            <SelectTrigger id="slack-reminders-digest">
              <SelectValue placeholder="Select digest" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            One summary per day with overdue and due-today counts plus the top tasks.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSyncNow()}
            disabled={isSyncing || !workspaceName}
          >
            {isSyncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync reminders now
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || !canSave}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Reminder Settings
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Delivery requires the background worker (npm run jobs:worker) to be running.
        </p>
        {!canSave && workspaceName ? (
          <p className="text-xs text-muted-foreground">
            Only workspace owners and admins can change Slack reminder settings.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
