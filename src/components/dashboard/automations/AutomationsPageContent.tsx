"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CirclePause,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Webhook,
  Workflow,
} from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  buildAutomationHealthSummary,
  getAutomationHealthState,
  getAutomationTemplateDraft,
  type AutomationTemplateId,
} from "@/components/dashboard/automations/automation-view-model";

type WorkflowSummary = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  trigger: "meeting.ingested" | "meeting.updated";
  updatedAt?: string | null;
  canManage?: boolean;
  autoDisabledAt?: string | null;
  autoDisabledReason?: string | null;
};

type Draft = {
  name: string;
  description: string;
  trigger: "meeting.ingested" | "meeting.updated";
  destinationUrl: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  trigger: "meeting.ingested",
  destinationUrl: "",
};

const templates: Array<{
  id: AutomationTemplateId;
  title: string;
  description: string;
  eyebrow: string;
}> = [
  {
    id: "meeting-webhook",
    eyebrow: "Most useful",
    title: "Meeting → webhook",
    description: "Send a clean meeting payload to n8n, Zapier, Make, your CRM, or an internal service.",
  },
  {
    id: "meeting-updated",
    eyebrow: "Keep systems aligned",
    title: "Meeting update → webhook",
    description: "Push corrections and enriched meeting context after the original meeting is processed.",
  },
  {
    id: "client-handoff",
    eyebrow: "Client ops",
    title: "Client handoff",
    description: "Start from a client-meeting recipe, then add filtering in the advanced editor.",
  },
];

const triggerLabel = (trigger: WorkflowSummary["trigger"]) =>
  trigger === "meeting.updated" ? "Meeting updated" : "Meeting processed";

const formatUpdatedAt = (value?: string | null) => {
  if (!value) return "No recent update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent update";
  return `Updated ${date.toLocaleString()}`;
};

export default function AutomationsPageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const workspaceId = user?.workspace?.id;
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showCreator, setShowCreator] = useState(false);

  const loadWorkflows = useCallback(
    async (manual = false) => {
      if (!workspaceId) {
        setWorkflows([]);
        setIsLoading(false);
        return;
      }
      if (manual) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/automation/workflows`,
          { cache: "no-store" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load automations.");
        }
        setWorkflows(Array.isArray(payload?.workflows) ? payload.workflows : []);
      } catch (error) {
        toast({
          title: "Could not load automations",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [toast, workspaceId]
  );

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const summary = useMemo(
    () => buildAutomationHealthSummary(workflows),
    [workflows]
  );

  const chooseTemplate = (templateId: AutomationTemplateId) => {
    const template = getAutomationTemplateDraft(templateId);
    setDraft({ ...template, destinationUrl: "" });
    setShowCreator(true);
  };

  const handleCreate = async () => {
    if (!workspaceId || isCreating) return;
    if (!draft.name.trim() || !draft.destinationUrl.trim()) {
      toast({
        title: "Name and destination required",
        description: "Give the automation a name and a valid HTTPS destination URL.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/automation/workflows`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            enabled: true,
            trigger: draft.trigger,
            filters: [],
            fieldSelection: { mode: "all", fields: [] },
            transform: { runtime: "quickjs", script: null, timeoutMs: 1000 },
            destination: {
              type: "webhook",
              url: draft.destinationUrl.trim(),
              headers: {},
            },
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not create the automation.");
      }
      if (payload?.workflow) {
        setWorkflows((current) => [payload.workflow, ...current]);
      } else {
        await loadWorkflows(true);
      }
      setDraft(EMPTY_DRAFT);
      setShowCreator(false);
      toast({
        title: "Automation created",
        description: "The workflow is active. Use Advanced controls when you need filters or transforms.",
      });
    } catch (error) {
      toast({
        title: "Could not create automation",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const toggleWorkflow = async (workflow: WorkflowSummary) => {
    if (!workspaceId || pendingWorkflowId) return;
    setPendingWorkflowId(workflow.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/automation/workflows/${encodeURIComponent(workflow.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !workflow.enabled }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not update automation.");
      const updated = payload?.workflow as WorkflowSummary | undefined;
      if (updated?.id) {
        setWorkflows((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
      } else {
        await loadWorkflows(true);
      }
    } catch (error) {
      toast({
        title: "Automation update failed",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setPendingWorkflowId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DashboardHeader
        pageIcon={Workflow}
        pageTitle={<h1 className="font-headline text-2xl font-bold">Automations</h1>}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
          <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit">Meeting memory → action</Badge>
              <h2 className="text-2xl font-semibold tracking-tight">Make the useful part happen after the meeting.</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Trigger reliable follow-up when a meeting is processed or updated. Start simple here; use Advanced when you need filters, payload transforms, delivery replay, or signing controls.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/docs">Automation docs</Link>
              </Button>
              <Button onClick={() => setShowCreator((value) => !value)}>
                <Plus className="mr-2 h-4 w-4" />
                New automation
              </Button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Automation health">
            <Metric label="Total" value={summary.total} icon={Workflow} />
            <Metric label="Active" value={summary.active} icon={CheckCircle2} />
            <Metric label="Paused" value={summary.paused} icon={CirclePause} />
            <Metric label="Needs attention" value={summary.needsAttention} icon={AlertTriangle} />
          </section>

          {showCreator && (
            <Card className="border-primary/30 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Quick builder
                </CardTitle>
                <CardDescription>
                  One trigger, one destination. Add advanced filtering and transforms after the reliable path is working.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="automation-name">Name</Label>
                    <Input
                      id="automation-name"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Client meeting handoff"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="automation-trigger">When</Label>
                    <Select
                      value={draft.trigger}
                      onValueChange={(value: Draft["trigger"]) =>
                        setDraft((current) => ({ ...current, trigger: value }))
                      }
                    >
                      <SelectTrigger id="automation-trigger">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meeting.ingested">A meeting is processed</SelectItem>
                        <SelectItem value="meeting.updated">A meeting is updated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="automation-description">Description</Label>
                  <Textarea
                    id="automation-description"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="What should this workflow accomplish?"
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="automation-destination">Then send to</Label>
                  <Input
                    id="automation-destination"
                    type="url"
                    value={draft.destinationUrl}
                    onChange={(event) => setDraft((current) => ({ ...current, destinationUrl: event.target.value }))}
                    placeholder="https://your-system.example/webhooks/taskwise"
                  />
                  <p className="text-xs text-muted-foreground">
                    Works well with an n8n webhook, Make/Zapier webhook, CRM endpoint, or your own service.
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                  <div className="font-medium">Plain-English preview</div>
                  <p className="mt-1 text-muted-foreground">
                    <strong>When</strong> {draft.trigger === "meeting.updated" ? "a Taskwise meeting changes" : "Taskwise finishes processing a meeting"}, <strong>then</strong> send the meeting payload to {draft.destinationUrl.trim() || "your webhook destination"}.
                  </p>
                </div>

                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="ghost" asChild>
                    <Link href="/settings?section=advanced">
                      Advanced filters & delivery controls <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowCreator(false)}>Cancel</Button>
                    <Button onClick={() => void handleCreate()} disabled={isCreating}>
                      {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create & enable
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <section className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Start from a recipe</h3>
              <p className="text-sm text-muted-foreground">Recipes prefill the useful minimum; you stay in control of the destination and advanced rules.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => chooseTemplate(template.id)}
                  className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge variant="secondary" className="mb-3">{template.eyebrow}</Badge>
                  <div className="font-semibold">{template.title}</div>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{template.description}</p>
                  <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                    Use recipe <ArrowRight className="ml-1 h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Your automations</h3>
                <p className="text-sm text-muted-foreground">See what is running before you open a detailed editor.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadWorkflows(true)} disabled={isRefreshing || isLoading}>
                {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>

            {isLoading ? (
              <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading workflows…
              </div>
            ) : workflows.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card p-8 text-center">
                <Webhook className="mx-auto h-8 w-8 text-muted-foreground" />
                <h4 className="mt-3 font-semibold">No automations yet</h4>
                <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                  Start with a meeting webhook. It is the simplest way to connect Taskwise meeting memory to the system where work actually happens.
                </p>
                <Button className="mt-4" onClick={() => chooseTemplate("meeting-webhook")}>Create first automation</Button>
              </div>
            ) : (
              <div className="grid gap-3">
                {workflows.map((workflow) => {
                  const state = getAutomationHealthState(workflow);
                  const stateLabel = state === "active" ? "Active" : state === "paused" ? "Paused" : "Needs attention";
                  return (
                    <Card key={workflow.id} className={state === "needs_attention" ? "border-amber-500/40" : undefined}>
                      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="truncate font-semibold">{workflow.name}</h4>
                            <Badge variant={state === "active" ? "secondary" : "outline"}>{stateLabel}</Badge>
                            <Badge variant="outline">{triggerLabel(workflow.trigger)}</Badge>
                          </div>
                          {workflow.description ? <p className="text-sm text-muted-foreground">{workflow.description}</p> : null}
                          <p className="text-xs text-muted-foreground">{formatUpdatedAt(workflow.updatedAt)}</p>
                          {state === "needs_attention" && workflow.autoDisabledReason ? (
                            <p className="text-xs text-amber-700 dark:text-amber-300">Auto-disabled: {workflow.autoDisabledReason}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link href="/settings?section=advanced">Advanced</Link>
                          </Button>
                          <Button
                            size="sm"
                            variant={workflow.enabled ? "secondary" : "default"}
                            onClick={() => void toggleWorkflow(workflow)}
                            disabled={!workflow.canManage || pendingWorkflowId === workflow.id}
                          >
                            {pendingWorkflowId === workflow.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                            {workflow.enabled ? "Pause" : "Enable"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
