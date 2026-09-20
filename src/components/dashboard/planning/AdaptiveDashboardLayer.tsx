"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiFetch } from "@/lib/api";
import type {
  AdaptiveDashboardDecision,
  AdaptiveDashboardSurface,
} from "@/lib/jev-dashboard";
import { cn } from "@/lib/utils";

export type AdaptiveDashboardContext = {
  recentMeetingCount: number;
  meetingsNeedingReview: number;
  upcomingMeetingCount: number;
  urgentTaskCount: number;
  highPriorityTaskCount: number;
  openTaskCount: number;
  peopleFollowupCount: number;
};

export type AdaptiveDashboardApiPayload = {
  decision: AdaptiveDashboardDecision;
  context: AdaptiveDashboardContext;
};

const DISMISS_PREFIX = "taskwise.adaptiveDashboard.dismissed.";

const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="h-8 w-8 shrink-0 text-muted-foreground"
    onClick={onDismiss}
    aria-label="Dismiss suggestion"
  >
    <X className="h-4 w-4" />
  </Button>
);

const ContextBadges = ({ context }: { context: AdaptiveDashboardContext }) => {
  const badges = [
    context.recentMeetingCount > 0
      ? `${context.recentMeetingCount} recent meeting${context.recentMeetingCount === 1 ? "" : "s"}`
      : null,
    context.meetingsNeedingReview > 0
      ? `${context.meetingsNeedingReview} need review`
      : null,
    context.urgentTaskCount > 0
      ? `${context.urgentTaskCount} urgent task${context.urgentTaskCount === 1 ? "" : "s"}`
      : null,
    context.upcomingMeetingCount > 0
      ? `${context.upcomingMeetingCount} upcoming`
      : null,
    context.peopleFollowupCount > 0
      ? `${context.peopleFollowupCount} follow-up signal${context.peopleFollowupCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean) as string[];

  if (!badges.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {badges.slice(0, 4).map((label) => (
        <Badge key={label} variant="secondary" className="font-normal">
          {label}
        </Badge>
      ))}
    </div>
  );
};

const ActionButtons = ({
  decision,
  compact = false,
}: {
  decision: AdaptiveDashboardDecision;
  compact?: boolean;
}) => (
  <div className={cn("flex flex-wrap gap-2", compact && "pt-1")}>
    <Button size={compact ? "sm" : "default"} asChild>
      <Link href={decision.primaryAction.href}>
        {decision.primaryAction.label}
        <ArrowRight className="ml-2 h-3.5 w-3.5" />
      </Link>
    </Button>
    {decision.secondaryAction ? (
      <Button size={compact ? "sm" : "default"} variant="outline" asChild>
        <Link href={decision.secondaryAction.href}>
          {decision.secondaryAction.label}
        </Link>
      </Button>
    ) : null}
  </div>
);

const PromptBody = ({
  payload,
  onDismiss,
  compact = false,
}: {
  payload: AdaptiveDashboardApiPayload;
  onDismiss: () => void;
  compact?: boolean;
}) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {payload.decision.eyebrow}
        </div>
        <h2 className={cn("font-semibold tracking-tight", compact ? "text-base" : "text-lg")}>
          {payload.decision.title}
        </h2>
      </div>
      <DismissButton onDismiss={onDismiss} />
    </div>
    <p className="text-sm leading-6 text-muted-foreground">
      {payload.decision.description}
    </p>
    <ContextBadges context={payload.context} />
    <ActionButtons decision={payload.decision} compact={compact} />
  </div>
);

export function AdaptiveDashboardPrompt({
  payload,
  onDismiss,
}: {
  payload: AdaptiveDashboardApiPayload;
  onDismiss: () => void;
}) {
  const surface: AdaptiveDashboardSurface = payload.decision.surface;
  if (surface === "none") return null;

  if (surface === "inline") {
    return (
      <Card className="border-primary/20 bg-card shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <PromptBody payload={payload} onDismiss={onDismiss} />
        </CardContent>
      </Card>
    );
  }

  if (surface === "popover") {
    return (
      <Popover
        open
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto w-full justify-between gap-4 border-primary/20 bg-card px-4 py-3 text-left shadow-sm"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="rounded-full bg-primary/10 p-2 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-primary">
                  Suggested focus
                </span>
                <span className="block truncate text-sm font-semibold text-foreground">
                  {payload.decision.title}
                </span>
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(92vw,420px)] p-4"
        >
          <PromptBody payload={payload} onDismiss={onDismiss} compact />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-primary">
            <Sparkles className="h-4 w-4" />
            {payload.decision.eyebrow}
          </div>
          <DialogTitle className="text-xl">{payload.decision.title}</DialogTitle>
          <DialogDescription className="pt-1 leading-6">
            {payload.decision.description}
          </DialogDescription>
        </DialogHeader>
        <ContextBadges context={payload.context} />
        <DialogFooter className="sm:justify-start">
          <ActionButtons decision={payload.decision} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdaptiveDashboardLayer({
  className,
}: {
  className?: string;
}) {
  const [payload, setPayload] = useState<AdaptiveDashboardApiPayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<{ ok?: boolean; data?: AdaptiveDashboardApiPayload } & AdaptiveDashboardApiPayload>(
      "/api/dashboard/adaptive",
      { cache: "no-store" }
    )
      .then((response) => {
        if (cancelled) return;
        const resolved = response?.data ?? response;
        if (!resolved?.decision || !resolved?.context) return;
        const key = `${DISMISS_PREFIX}${resolved.decision.decisionKey}`;
        if (typeof window !== "undefined" && localStorage.getItem(key) === "true") {
          setDismissed(true);
          return;
        }
        setPayload(resolved);
      })
      .catch((error) => {
        // Adaptive guidance must never block the core Planning experience.
        console.error("Failed to load adaptive dashboard guidance:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (payload?.decision.decisionKey && typeof window !== "undefined") {
      localStorage.setItem(
        `${DISMISS_PREFIX}${payload.decision.decisionKey}`,
        "true"
      );
    }
    setDismissed(true);
  }, [payload]);

  if (!payload || dismissed || payload.decision.surface === "none") return null;

  return (
    <div className={className} data-adaptive-focus={payload.decision.focus}>
      <AdaptiveDashboardPrompt payload={payload} onDismiss={handleDismiss} />
    </div>
  );
}
