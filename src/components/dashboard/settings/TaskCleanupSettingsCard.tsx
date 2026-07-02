"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
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
  DEFAULT_TASK_CLEANUP_SETTINGS,
  type TaskCleanupCategoryKey,
  type TaskCleanupSettings,
  type TaskCleanupStrictness,
} from "@/lib/workspace-settings";

const STRICTNESS_OPTIONS: {
  value: TaskCleanupStrictness;
  label: string;
  description: string;
}[] = [
  {
    value: "light",
    label: "Light",
    description: "Only obvious junk — high-confidence logistics and confirmed completed tasks.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Obvious junk plus likely duplicates and stale follow-ups.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    description: "Also flags low-specificity tasks and weaker-confidence suggestions.",
  },
];

const CATEGORY_OPTIONS: { key: TaskCleanupCategoryKey; label: string }[] = [
  { key: "scheduling_admin", label: "Scheduling & admin" },
  { key: "meeting_logistics", label: "Meeting logistics" },
  { key: "already_completed", label: "Already completed" },
  { key: "duplicate", label: "Duplicates" },
  { key: "low_specificity", label: "Low specificity" },
  { key: "stale_follow_up", label: "Stale follow-ups" },
  { key: "expired_event", label: "Expired event tasks" },
];

const clampAutoExpireDays = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TASK_CLEANUP_SETTINGS.autoExpireDays;
  return Math.min(90, Math.max(1, Math.round(value)));
};

export default function TaskCleanupSettingsCard({ className }: { className?: string }) {
  const { user, updateUserProfile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<TaskCleanupSettings>(
    DEFAULT_TASK_CLEANUP_SETTINGS
  );
  const [autoExpireInput, setAutoExpireInput] = useState<string>(
    String(DEFAULT_TASK_CLEANUP_SETTINGS.autoExpireDays)
  );
  const [isSaving, setIsSaving] = useState(false);

  const workspaceName = user?.workspace?.name || "";
  const canSave = Boolean(workspaceName) && user?.activeWorkspaceRole !== "member";

  useEffect(() => {
    const configured = (user as { activeWorkspaceTaskCleanup?: TaskCleanupSettings } | null)
      ?.activeWorkspaceTaskCleanup;
    if (configured) {
      setSettings({
        ...DEFAULT_TASK_CLEANUP_SETTINGS,
        ...configured,
        categories: {
          ...DEFAULT_TASK_CLEANUP_SETTINGS.categories,
          ...(configured.categories || {}),
        },
      });
      setAutoExpireInput(
        String(configured.autoExpireDays ?? DEFAULT_TASK_CLEANUP_SETTINGS.autoExpireDays)
      );
    }
  }, [user]);

  const handleSave = async () => {
    if (!workspaceName) {
      toast({
        title: "No active workspace",
        description: "Task cleanup settings require an active workspace.",
        variant: "destructive",
      });
      return;
    }

    const autoExpireDays = clampAutoExpireDays(Number(autoExpireInput));
    const nextSettings: TaskCleanupSettings = { ...settings, autoExpireDays };
    setSettings(nextSettings);
    setAutoExpireInput(String(autoExpireDays));

    setIsSaving(true);
    try {
      await updateUserProfile({
        workspace: {
          name: workspaceName,
          settings: {
            taskCleanup: nextSettings,
          },
        } as any,
      });
      toast({
        title: "Task Cleanup Updated",
        description: "Cleanup strictness, expiry, and category settings were saved.",
      });
    } catch (error) {
      console.error("Failed to save task cleanup settings:", error);
      toast({
        title: "Error",
        description: "Could not save task cleanup settings.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const strictnessDescription =
    STRICTNESS_OPTIONS.find((option) => option.value === settings.strictness)
      ?.description || "";

  return (
    <Card className={cn("shadow-lg rounded-xl", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 font-headline text-xl">
          <Sparkles className="text-emerald-400 drop-shadow-[0_2px_4px_rgba(52,211,153,0.5)]" />
          Task Cleanup
        </CardTitle>
        <CardDescription>
          Control how TaskWiseAI flags vanity, duplicate, stale, and already-done tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Enable task cleanup</Label>
            <p className="text-xs text-muted-foreground">
              Scan tasks for low-value, duplicate, stale, and completed work.
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              setSettings((current) => ({ ...current, enabled: checked }))
            }
            aria-label="Enable task cleanup"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-cleanup-strictness" className="text-sm font-medium">
            Strictness
          </Label>
          <Select
            value={settings.strictness}
            onValueChange={(value) =>
              setSettings((current) => ({
                ...current,
                strictness: value as TaskCleanupStrictness,
              }))
            }
            disabled={!settings.enabled}
          >
            <SelectTrigger id="task-cleanup-strictness">
              <SelectValue placeholder="Select strictness" />
            </SelectTrigger>
            <SelectContent>
              {STRICTNESS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{strictnessDescription}</p>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="space-y-1">
            <Label htmlFor="task-cleanup-auto-expire" className="text-sm font-medium">
              Auto-expire after
            </Label>
            <p className="text-xs text-muted-foreground">
              Days before a suggested-to-expire task expires automatically (1–90).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="task-cleanup-auto-expire"
              type="number"
              min={1}
              max={90}
              className="w-20"
              value={autoExpireInput}
              onChange={(event) => setAutoExpireInput(event.target.value)}
              disabled={!settings.enabled}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Categories to flag</Label>
            <p className="text-xs text-muted-foreground">
              Choose which kinds of tasks the cleanup scan is allowed to flag.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CATEGORY_OPTIONS.map((option) => (
              <div key={option.key} className="flex items-center justify-between gap-3">
                <Label
                  htmlFor={`task-cleanup-category-${option.key}`}
                  className="text-sm font-normal"
                >
                  {option.label}
                </Label>
                <Switch
                  id={`task-cleanup-category-${option.key}`}
                  checked={settings.categories[option.key]}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({
                      ...current,
                      categories: { ...current.categories, [option.key]: checked },
                    }))
                  }
                  disabled={!settings.enabled}
                  aria-label={`Flag ${option.label}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <Button variant="link" size="sm" className="px-0" asChild>
            <a href="/review/cleanup">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open cleanup suggestions
            </a>
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || !canSave}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Cleanup Settings
          </Button>
        </div>
        {!canSave && workspaceName ? (
          <p className="text-xs text-muted-foreground">
            Only workspace owners and admins can change task cleanup settings.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
