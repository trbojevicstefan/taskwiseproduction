"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ClipboardPaste, PlayCircle, Settings2, Sparkles, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePasteAction } from "@/contexts/PasteActionContext";
import { useIntegrations } from "@/contexts/IntegrationsContext";
import { isManualMeetingIngestEnabled } from "@/lib/simplification-flags";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "taskwise_start_here_dismissed";

const SAMPLE_MEETING_TRANSCRIPT = [
  "Taskwise sample meeting: Customer onboarding review",
  "",
  "Maya: We need to send Acme the onboarding checklist by Friday.",
  "Jon: I will draft the checklist and include the data migration steps.",
  "Priya: Please schedule a technical handoff with their IT lead next Tuesday.",
  "Maya: The contract owner should review billing terms before the handoff.",
  "Jon: I will also create a Trello-ready task for the migration dry run.",
].join("\n");

export default function CoreLoopStartPanel({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { openPasteDialog } = usePasteAction();
  const { isFathomConnected } = useIntegrations();
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem(DISMISS_KEY) === "true";
    return false;
  });
  const manualIngestEnabled = isManualMeetingIngestEnabled();

  // Auto-hide if user already has Fathom connected or dismissed manually
  if (dismissed || isFathomConnected) return null;

  const handleProcessDraft = () => {
    const text = draftText.trim();
    if (!text) return;
    setIsPasteOpen(false);
    setDraftText("");
    openPasteDialog(text);
  };

  return (
    <>
      <Card className={cn("border-border/70 shadow-sm", className)}>
        <CardHeader className={cn("relative", compact ? "pb-3" : undefined)}>
          <button
            onClick={() => { localStorage.setItem(DISMISS_KEY, "true"); setDismissed(true); }}
            className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition"
            aria-label="Dismiss"
          ><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            Start here
          </div>
          <CardTitle className={compact ? "text-xl" : "text-2xl"}>
            Create your first task list
          </CardTitle>
          <CardDescription>
            Paste meeting notes, connect Fathom, or try a sample meeting and review the tasks next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <Button
              className="h-auto justify-start gap-3 py-3 text-left"
              onClick={() => setIsPasteOpen(true)}
              disabled={!manualIngestEnabled}
            >
              <ClipboardPaste className="h-5 w-5" />
              <span>
                <span className="block font-semibold">Paste notes</span>
                <span className="block text-xs font-normal opacity-80">Transcript or raw notes</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto justify-start gap-3 py-3 text-left"
              asChild
            >
              <Link href="/settings?section=integrations" prefetch={false}>
                <Video className="h-5 w-5" />
                <span>
                  <span className="block font-semibold">Connect Fathom</span>
                  <span className="block text-xs font-normal text-muted-foreground">Sync real meetings</span>
                </span>
              </Link>
            </Button>
            <Button
              variant="secondary"
              className="h-auto justify-start gap-3 py-3 text-left"
              onClick={() => openPasteDialog(SAMPLE_MEETING_TRANSCRIPT)}
            >
              <PlayCircle className="h-5 w-5" />
              <span>
                <span className="block font-semibold">Try sample</span>
                <span className="block text-xs font-normal text-muted-foreground">Demo task list</span>
              </span>
            </Button>
          </div>
          {!manualIngestEnabled ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              Manual meeting ingest is disabled by feature flag.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={isPasteOpen} onOpenChange={setIsPasteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste transcript or notes</DialogTitle>
            <DialogDescription>
              Taskwise will analyze this content and open the review queue when it finishes.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="Paste meeting transcript, notes, or action items..."
            className="min-h-[260px] resize-y"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleProcessDraft} disabled={!draftText.trim()}>
              Process notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
