// src/components/dashboard/common/ProfileReportDialog.tsx
"use client";

/**
 * Priority 9 — one-click report dialog shared by the person and company
 * profiles. POSTs to the given report endpoint, renders the structured
 * source-grounded report, and offers a copy-as-markdown button (no PDF).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { Check, Copy, FileText, Loader2, RefreshCw } from "lucide-react";
import type { ProfileReport } from "@/types/profile-report";

interface ProfileReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** POST endpoint, e.g. /api/people/abc/report or /api/companies/abc/report. */
  endpoint: string;
  subjectName: string;
}

const SECTION_DEFINITIONS: Array<{
  key: keyof Pick<
    ProfileReport,
    | "openCommitments"
    | "overdueOrRisk"
    | "completedWork"
    | "recentMeetings"
    | "keyDecisions"
  >;
  heading: string;
}> = [
  { key: "openCommitments", heading: "Open commitments" },
  { key: "overdueOrRisk", heading: "Overdue & at-risk" },
  { key: "completedWork", heading: "Completed work" },
  { key: "recentMeetings", heading: "Recent meetings" },
  { key: "keyDecisions", heading: "Key decisions" },
];

/** Render the report as markdown for the copy button. Exported for tests. */
export const reportToMarkdown = (report: ProfileReport): string => {
  const lines: string[] = [
    `# Report: ${report.subjectName}`,
    "",
    `_Generated ${report.generatedAt.slice(0, 10)} · confidence: ${report.confidence}_`,
    "",
    "## Executive summary",
    report.executiveSummary,
  ];
  for (const section of SECTION_DEFINITIONS) {
    const items = report[section.key];
    lines.push("", `## ${section.heading}`);
    if (items.length) {
      items.forEach((item) => lines.push(`- ${item}`));
    } else {
      lines.push("- None recorded.");
    }
  }
  lines.push("", "## Suggested next action", report.suggestedNextAction);
  if (report.sources.length) {
    lines.push("", "## Sources");
    report.sources.forEach((source) => {
      const stamp = source.timestamp ? ` [${source.timestamp}]` : "";
      lines.push(
        `- (${source.sourceType}) ${source.title}${stamp}: "${source.snippet}"`
      );
    });
  }
  return lines.join("\n");
};

export default function ProfileReportDialog({
  isOpen,
  onClose,
  endpoint,
  subjectName,
}: ProfileReportDialogProps) {
  const { toast } = useToast();
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ ok: boolean; data: ProfileReport }>(
        endpoint,
        { method: "POST", body: JSON.stringify({}) }
      );
      setReport(response.data);
    } catch (fetchError) {
      console.error("Failed to generate report:", fetchError);
      setError("Could not generate the report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (isOpen) {
      setReport(null);
      setCopied(false);
      void generate();
    }
  }, [isOpen, generate]);

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report));
      setCopied(true);
      toast({ title: "Report copied", description: "Markdown copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      console.error("Failed to copy report:", copyError);
      toast({
        title: "Copy failed",
        description: "Could not copy the report to your clipboard.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Report: {subjectName}
          </DialogTitle>
          <DialogDescription>
            Source-grounded summary built from meetings, transcripts, and tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Generating report…</span>
            </div>
          )}

          {!isLoading && error && (
            <div className="work-inset p-4 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {!isLoading && !error && report && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {report.subjectType}
                </Badge>
                <Badge
                  variant={report.confidence === "high" ? "default" : "outline"}
                  className="capitalize"
                >
                  Confidence: {report.confidence}
                </Badge>
              </div>

              <section className="work-inset p-4">
                <h3 className="text-sm font-semibold mb-1">Executive summary</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {report.executiveSummary}
                </p>
              </section>

              {SECTION_DEFINITIONS.map(({ key, heading }) => (
                <section key={key} className="work-inset p-4">
                  <h3 className="text-sm font-semibold mb-1">{heading}</h3>
                  {report[key].length ? (
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {report[key].map((item, index) => (
                        <li key={`${key}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">None recorded.</p>
                  )}
                </section>
              ))}

              <section className="work-inset p-4">
                <h3 className="text-sm font-semibold mb-1">Suggested next action</h3>
                <p className="text-sm">{report.suggestedNextAction}</p>
              </section>

              {report.sources.length > 0 && (
                <section className="work-inset p-4">
                  <h3 className="text-sm font-semibold mb-1">Sources</h3>
                  <ul className="space-y-2 text-sm">
                    {report.sources.map((source, index) => (
                      <li key={`source-${index}`} className="flex flex-col">
                        <span className="font-medium">
                          <Badge variant="outline" className="mr-2 capitalize">
                            {source.sourceType}
                          </Badge>
                          {source.title}
                          {source.timestamp ? ` · ${source.timestamp}` : ""}
                        </span>
                        <span className="text-muted-foreground">
                          “{source.snippet}”
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => void generate()}
            disabled={isLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerate
          </Button>
          <Button onClick={handleCopy} disabled={!report || isLoading}>
            {copied ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            Copy report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
