// src/components/auth/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleHelp,
  Loader2,
  MessageSquareText,
  Search,
  Sparkles,
  Users,
  Video,
  Workflow,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIntegrations } from "@/contexts/IntegrationsContext";
import { useToast } from "@/hooks/use-toast";
import { onPeopleSnapshot } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import SlackSyncDialog from "@/components/dashboard/people/SlackSyncDialog";
import {
  getOnboardingDestination,
  getOnboardingDestinationLabel,
  normalizeOnboardingGoal,
  normalizeOnboardingStep,
  ONBOARDING_TOTAL_STEPS,
  type OnboardingGoal,
} from "@/components/auth/onboarding-wizard-state";

const STEP_STORAGE_KEY = "taskwise:onboarding-step";
const GOAL_STORAGE_KEY = "taskwise:onboarding-goal";

const GOALS: Array<{
  id: OnboardingGoal;
  icon: React.ElementType;
  title: string;
  description: string;
}> = [
  {
    id: "follow_up",
    icon: CheckCircle2,
    title: "Follow up faster",
    description: "Turn decisions and commitments into reviewed work without manual copy-paste.",
  },
  {
    id: "search",
    icon: Search,
    title: "Ask my meeting history",
    description: "Find decisions, promises, blockers and context across transcripts in seconds.",
  },
  {
    id: "capture",
    icon: Video,
    title: "Centralize meeting memory",
    description: "Bring transcripts, people, tasks and client context into one reliable workspace.",
  },
  {
    id: "automate",
    icon: Workflow,
    title: "Automate handoffs",
    description: "Turn meeting events into controlled downstream workflows after human review.",
  },
];

const OnboardingWizard = ({ onClose }: { onClose?: () => void }) => {
  const { user, completeOnboarding } = useAuth();
  const {
    isSlackConnected,
    isLoadingSlackConnection,
    connectSlack,
    isFathomConnected,
    isLoadingFathomConnection,
    connectFathom,
  } = useIntegrations();
  const { toast } = useToast();
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(1);
  const [goal, setGoal] = useState<OnboardingGoal>("follow_up");
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSlackSyncOpen, setIsSlackSyncOpen] = useState(false);
  const [slackPeopleCount, setSlackPeopleCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCurrentStep(normalizeOnboardingStep(window.sessionStorage.getItem(STEP_STORAGE_KEY)));
    setGoal(normalizeOnboardingGoal(window.sessionStorage.getItem(GOAL_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STEP_STORAGE_KEY, String(currentStep));
  }, [currentStep]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(GOAL_STORAGE_KEY, goal);
  }, [goal]);

  useEffect(() => {
    if (!user?.uid) {
      setSlackPeopleCount(0);
      return;
    }

    return onPeopleSnapshot(user.uid, (loadedPeople) => {
      setSlackPeopleCount(loadedPeople.filter((person) => Boolean(person.slackId)).length);
    });
  }, [user?.uid]);

  const selectedGoal = useMemo(
    () => GOALS.find((item) => item.id === goal) ?? GOALS[0],
    [goal]
  );

  const destination = getOnboardingDestination(goal);
  const destinationLabel = getOnboardingDestinationLabel(goal);

  const refreshPeople = async () => {
    try {
      const response = await fetch("/api/people");
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data)) return;
      setSlackPeopleCount(data.filter((person) => Boolean(person?.slackId)).length);
    } catch (error) {
      console.error("Failed to refresh people:", error);
    }
  };

  const next = () => setCurrentStep((step) => Math.min(ONBOARDING_TOTAL_STEPS, step + 1));
  const back = () => setCurrentStep((step) => Math.max(1, step - 1));

  const finishOnboarding = async () => {
    setIsFinishing(true);
    try {
      await completeOnboarding();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(STEP_STORAGE_KEY);
        window.sessionStorage.removeItem(GOAL_STORAGE_KEY);
        // Clean up the previous wizard key so old sessions never resume into a stale flow.
        window.sessionStorage.removeItem("onboardingStep");
      }
      toast({
        title: "Your Taskwise workspace is ready",
        description: "Start with one real meeting. Taskwise will keep the source context attached to what happens next.",
      });
      router.push(destination);
      onClose?.();
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      toast({
        title: "Could not finish setup",
        description: "Your setup progress is saved. Try again without losing your place.",
        variant: "destructive",
      });
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto bg-background/90 p-4 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="taskwise-onboarding-title"
      aria-describedby="taskwise-onboarding-description"
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center py-4">
        <div className="w-full overflow-hidden rounded-3xl border bg-card shadow-2xl">
          <div className="grid lg:grid-cols-[280px_1fr]">
            <aside className="border-b bg-muted/20 p-5 lg:border-b-0 lg:border-r lg:p-7">
              <div className="flex items-center gap-3">
                <Logo size="md" isIconOnly />
                <div>
                  <p className="text-sm font-semibold">Taskwise</p>
                  <p className="text-xs text-muted-foreground">Meeting memory → action</p>
                </div>
              </div>

              <div className="mt-7">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Setup progress</span>
                  <span>{currentStep}/{ONBOARDING_TOTAL_STEPS}</span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Onboarding progress"
                  aria-valuemin={1}
                  aria-valuemax={ONBOARDING_TOTAL_STEPS}
                  aria-valuenow={currentStep}
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${(currentStep / ONBOARDING_TOTAL_STEPS) * 100}%` }}
                  />
                </div>
              </div>

              <nav className="mt-6 grid grid-cols-5 gap-1 lg:grid-cols-1 lg:gap-2" aria-label="Onboarding steps">
                <ProgressStep number={1} label="Your goal" currentStep={currentStep} />
                <ProgressStep number={2} label="Meeting source" currentStep={currentStep} />
                <ProgressStep number={3} label="Team context" currentStep={currentStep} />
                <ProgressStep number={4} label="How it works" currentStep={currentStep} />
                <ProgressStep number={5} label="Start" currentStep={currentStep} />
              </nav>

              <div className="mt-7 hidden rounded-2xl border bg-background/70 p-4 text-xs leading-5 text-muted-foreground lg:block">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <CircleHelp className="h-4 w-4" />
                  Nothing here locks you in
                </div>
                <p className="mt-2">
                  Fathom and Slack can be skipped. You can reconnect providers, rerun onboarding, or open Help & Docs later from the header.
                </p>
              </div>
            </aside>

            <main className="min-h-[570px] p-5 sm:p-8 lg:p-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                >
                  {currentStep === 1 && (
                    <WizardStep
                      eyebrow="1 · Personalize the first win"
                      icon={Sparkles}
                      title="What do you want Taskwise to solve first?"
                      description="Pick the outcome that matters most. This only changes where we send you after setup — every capability remains available."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {GOALS.map((item) => (
                          <GoalCard
                            key={item.id}
                            {...item}
                            selected={goal === item.id}
                            onSelect={() => setGoal(item.id)}
                          />
                        ))}
                      </div>
                      <Button size="lg" className="mt-7 w-full sm:w-auto" onClick={next}>
                        Continue with {selectedGoal.title.toLowerCase()}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </WizardStep>
                  )}

                  {currentStep === 2 && (
                    <WizardStep
                      eyebrow="2 · Recommended meeting source"
                      icon={Video}
                      title="Connect Fathom so Taskwise has real meeting memory"
                      description="Fathom is the primary meeting source. Once connected, Taskwise can attach answers and extracted commitments back to the transcript they came from."
                    >
                      <StatusCard
                        title="Fathom"
                        status={isFathomConnected ? "Connected" : "Recommended"}
                        description="Meetings + transcripts become searchable context for chat, reviewed tasks, people/client memory and automations."
                        connected={isFathomConnected}
                      />

                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        <MiniBenefit number="01" title="Capture" text="Meeting and transcript arrive." />
                        <MiniBenefit number="02" title="Understand" text="Ask, find decisions and review commitments." />
                        <MiniBenefit number="03" title="Act" text="Move approved outcomes into work or workflows." />
                      </div>

                      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                        <Button
                          size="lg"
                          onClick={() => connectFathom()}
                          disabled={isLoadingFathomConnection || isFathomConnected}
                        >
                          {isLoadingFathomConnection ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : isFathomConnected ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Video className="mr-2 h-4 w-4" />
                          )}
                          {isFathomConnected ? "Fathom connected" : "Connect Fathom"}
                        </Button>
                        <Button variant="outline" size="lg" onClick={next}>
                          {isFathomConnected ? "Continue" : "Skip for now"}
                        </Button>
                      </div>
                      <HelpText>
                        Skipping does not create demo data or fake a connection. You can add Fathom later from Integrations.
                      </HelpText>
                    </WizardStep>
                  )}

                  {currentStep === 3 && (
                    <WizardStep
                      eyebrow="3 · Optional team context"
                      icon={Users}
                      title="Add Slack only if team context helps"
                      description="Slack is useful for teammate identity, assignee context and sharing. It is not required for meetings, transcript chat, tasks, Board or Automations."
                    >
                      <StatusCard
                        title="Slack"
                        status={isSlackConnected ? "Connected" : "Optional"}
                        description={
                          slackPeopleCount > 0
                            ? `${slackPeopleCount} Slack people are already synced into Taskwise.`
                            : "Connect your workspace, then choose which people Taskwise should sync."
                        }
                        connected={isSlackConnected}
                      />

                      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                        <Button
                          size="lg"
                          onClick={connectSlack}
                          disabled={isLoadingSlackConnection || isSlackConnected}
                        >
                          {isLoadingSlackConnection ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : isSlackConnected ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Users className="mr-2 h-4 w-4" />
                          )}
                          {isSlackConnected ? "Slack connected" : "Connect Slack"}
                        </Button>
                        {isSlackConnected && (
                          <Button variant="outline" size="lg" onClick={() => setIsSlackSyncOpen(true)}>
                            {slackPeopleCount > 0 ? "Manage synced people" : "Choose people to sync"}
                          </Button>
                        )}
                        <Button variant="ghost" size="lg" onClick={next}>
                          {isSlackConnected ? "Continue" : "Skip Slack"}
                        </Button>
                      </div>
                    </WizardStep>
                  )}

                  {currentStep === 4 && (
                    <WizardStep
                      eyebrow="4 · The mental model"
                      icon={Bot}
                      title="One conversation, one chain of evidence"
                      description="Taskwise is most useful when you follow the same simple loop after a meeting. AI can recommend; you stay in control of writes, sharing and automation."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <WorkflowCard
                          icon={Video}
                          title="1. Meeting"
                          text="Open the real transcript and summary. This is the source of truth."
                        />
                        <WorkflowCard
                          icon={MessageSquareText}
                          title="2. Ask"
                          text="Ask what changed, what was promised, who owns it and what is blocked."
                        />
                        <WorkflowCard
                          icon={CheckCircle2}
                          title="3. Review"
                          text="Approve what should become work instead of blindly accepting AI extraction."
                        />
                        <WorkflowCard
                          icon={Workflow}
                          title="4. Automate"
                          text="Only then hand selected outcomes to Slack, webhooks or another system."
                        />
                      </div>

                      <div className="mt-6 rounded-2xl border bg-primary/5 p-4">
                        <div className="flex items-start gap-3">
                          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                          <div>
                            <p className="text-sm font-semibold">Look for source context before acting</p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              Transcript chat and extracted work should keep evidence close. If a suggestion is uncertain, verify the source before publishing or automating it.
                            </p>
                          </div>
                        </div>
                      </div>

                      <Button size="lg" className="mt-7" onClick={next}>
                        Got it — show me where to start
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </WizardStep>
                  )}

                  {currentStep === 5 && (
                    <WizardStep
                      eyebrow="5 · First success"
                      icon={Sparkles}
                      title={`Start with: ${selectedGoal.title}`}
                      description="Setup is complete. Your first useful action should happen in the product, not in another tutorial screen."
                    >
                      <div className="rounded-2xl border bg-muted/20 p-5">
                        <p className="text-sm font-semibold">Your shortest path</p>
                        <div className="mt-4 space-y-3">
                          <ChecklistItem text={getFirstStep(goal, isFathomConnected)} />
                          <ChecklistItem text={getSecondStep(goal)} />
                          <ChecklistItem text="Review the source and confirm what should happen next." />
                        </div>
                      </div>

                      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                        <Button size="lg" onClick={() => void finishOnboarding()} disabled={isFinishing}>
                          {isFinishing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4" />
                          )}
                          {destinationLabel}
                        </Button>
                        <Button variant="outline" size="lg" onClick={() => router.push("/docs")} disabled={isFinishing}>
                          <CircleHelp className="mr-2 h-4 w-4" />
                          Help & Docs
                        </Button>
                      </div>
                    </WizardStep>
                  )}
                </motion.div>
              </AnimatePresence>

              <div className="mt-8 flex items-center justify-between border-t pt-5">
                <Button variant="ghost" onClick={back} disabled={currentStep === 1 || isFinishing}>
                  Back
                </Button>
                {onClose && (
                  <Button variant="ghost" onClick={onClose} disabled={isFinishing}>
                    Close for now
                  </Button>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>

      <SlackSyncDialog
        isOpen={isSlackSyncOpen}
        onClose={() => setIsSlackSyncOpen(false)}
        onSynced={() => void refreshPeople()}
      />
    </div>
  );
};

function WizardStep({
  eyebrow,
  icon: Icon,
  title,
  description,
  children,
}: {
  eyebrow: string;
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h1 id="taskwise-onboarding-title" className="mt-2 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p id="taskwise-onboarding-description" className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
        {description}
      </p>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function GoalCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        selected ? "border-primary bg-primary/5 shadow-sm" : "bg-background hover:border-primary/40 hover:bg-muted/20"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
          <Icon className="h-4 w-4" />
        </div>
        {selected && <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />}
      </div>
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </button>
  );
}

function ProgressStep({ number, label, currentStep }: { number: number; label: string; currentStep: number }) {
  const completed = number < currentStep;
  const active = number === currentStep;
  return (
    <div
      className={`flex items-center justify-center gap-3 rounded-xl px-2 py-2 text-xs lg:justify-start lg:px-3 ${
        active ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground"
      }`}
      aria-current={active ? "step" : undefined}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
          completed ? "bg-primary text-primary-foreground" : active ? "border border-primary text-primary" : "border"
        }`}
      >
        {completed ? <Check className="h-3.5 w-3.5" /> : number}
      </span>
      <span className="hidden lg:inline">{label}</span>
    </div>
  );
}

function StatusCard({
  title,
  status,
  description,
  connected,
}: {
  title: string;
  status: string;
  description: string;
  connected: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-background p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="text-base font-semibold">{title}</div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${connected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {status}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function MiniBenefit({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-muted/15 p-3">
      <div className="text-[10px] font-semibold tracking-wider text-primary">{number}</div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

function WorkflowCard({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
      <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function getFirstStep(goal: OnboardingGoal, fathomConnected: boolean): string {
  if (!fathomConnected) return "Open Taskwise and add or connect a real meeting source when you are ready.";
  if (goal === "search") return "Open Chat and ask one concrete question about a real meeting or workspace history.";
  if (goal === "automate") return "Open Automations and start from a meeting-event recipe instead of a blank workflow.";
  return "Open one real Fathom meeting and inspect its transcript and extracted context.";
}

function getSecondStep(goal: OnboardingGoal): string {
  if (goal === "search") return "Open a cited source from the answer and verify the underlying transcript context.";
  if (goal === "automate") return "Read the When → Then summary and preview the payload before enabling anything.";
  if (goal === "capture") return "Ask what was decided and confirm the important people and commitments are represented correctly.";
  return "Review extracted commitments and keep only the work that should actually be tracked.";
}

export default OnboardingWizard;
