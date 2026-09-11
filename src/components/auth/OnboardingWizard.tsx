// src/components/auth/OnboardingWizard.tsx
"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PartyPopper,
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

const TOTAL_STEPS = 4;

const Step = ({
  step,
  currentStep,
  children,
}: {
  step: number;
  currentStep: number;
  children: React.ReactNode;
}) =>
  currentStep === step ? (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.985 }}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      {children}
    </motion.div>
  ) : null;

function StepShell({
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-2xl md:p-7">
      <div className="mb-5 flex items-center justify-between gap-4">
        <Logo size="md" isIconOnly />
        <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </span>
      </div>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

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
  const [isLoading, setIsLoading] = useState(false);
  const [isSlackSyncOpen, setIsSlackSyncOpen] = useState(false);
  const [slackPeopleCount, setSlackPeopleCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedStep = window.sessionStorage.getItem("onboardingStep");
    if (!storedStep) return;
    const parsedStep = Number.parseInt(storedStep, 10);
    if (!Number.isNaN(parsedStep) && parsedStep >= 1 && parsedStep <= TOTAL_STEPS) {
      setCurrentStep(parsedStep);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("onboardingStep", String(currentStep));
  }, [currentStep]);

  useEffect(() => {
    if (!user?.uid) {
      setSlackPeopleCount(0);
      return;
    }

    const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
      setSlackPeopleCount(loadedPeople.filter((person) => Boolean(person.slackId)).length);
    });

    return () => unsubscribe();
  }, [user?.uid]);

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

  const finishOnboarding = async (destination: "/meetings" | "/chat") => {
    setIsLoading(true);
    try {
      await completeOnboarding();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("onboardingStep");
      }
      toast({
        title: "Taskwise is ready",
        description: "Your meetings can now become searchable context, tasks and follow-up workflows.",
      });
      router.push(destination);
      onClose?.();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>Getting started</span>
          <span>{currentStep} of {TOTAL_STEPS}</span>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
          />
        </div>

        <AnimatePresence mode="wait">
          <Step key={currentStep} step={currentStep} currentStep={currentStep}>
            {currentStep === 1 && (
              <StepShell
                eyebrow="Start with value"
                icon={Sparkles}
                title="Turn every meeting into usable memory"
                description="Taskwise connects the conversation to what happens next: searchable transcripts, reviewed commitments, people and client context, planning, sharing and automations."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <ValueCard icon={MessageSquareText} title="Ask" text="Chat with one meeting or your workspace history." />
                  <ValueCard icon={CheckCircle2} title="Act" text="Review tasks instead of copying action items by hand." />
                  <ValueCard icon={Workflow} title="Automate" text="Send approved outcomes into follow-up workflows." />
                </div>
                <Button className="mt-6 w-full" size="lg" onClick={() => setCurrentStep(2)}>
                  Set up my meeting memory
                </Button>
              </StepShell>
            )}

            {currentStep === 2 && (
              <StepShell
                eyebrow="Recommended"
                icon={Video}
                title="Connect Fathom first"
                description="Fathom is Taskwise's primary meeting source. Connect it to bring meetings and transcripts into the same place where you review tasks, ask questions and trigger follow-up."
              >
                <div className="rounded-xl border bg-muted/25 p-4 text-sm">
                  <div className="font-medium">What happens after connection</div>
                  <div className="mt-2 space-y-1.5 text-muted-foreground">
                    <p>1. Meetings and transcripts arrive in Taskwise.</p>
                    <p>2. You can chat with the transcript and review extracted commitments.</p>
                    <p>3. Approved outcomes can flow into tasks, planning and automations.</p>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => connectFathom()}
                    disabled={isLoadingFathomConnection || isFathomConnected}
                  >
                    {isLoadingFathomConnection ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : isFathomConnected ? (
                      <Check className="mr-2 h-5 w-5" />
                    ) : (
                      <Video className="mr-2 h-5 w-5" />
                    )}
                    {isFathomConnected ? "Fathom connected" : "Connect Fathom"}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => setCurrentStep(3)}>
                    {isFathomConnected ? "Continue" : "Continue without Fathom"}
                  </Button>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  You can change or add meeting providers later from integrations/settings.
                </p>
              </StepShell>
            )}

            {currentStep === 3 && (
              <StepShell
                eyebrow="Optional team layer"
                icon={Users}
                title="Connect your team when it helps"
                description="Slack is optional. Use it when you want Taskwise to understand teammates, improve assignee context and make sharing follow-up easier."
              >
                <div className="space-y-3">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={connectSlack}
                    disabled={isLoadingSlackConnection || isSlackConnected}
                  >
                    {isLoadingSlackConnection ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : isSlackConnected ? (
                      <Check className="mr-2 h-5 w-5" />
                    ) : (
                      <Users className="mr-2 h-5 w-5" />
                    )}
                    {isSlackConnected ? "Slack connected" : "Connect Slack"}
                  </Button>
                  {isSlackConnected && (
                    <Button variant="outline" className="w-full" onClick={() => setIsSlackSyncOpen(true)}>
                      <Users className="mr-2 h-4 w-4" />
                      {slackPeopleCount > 0 ? `${slackPeopleCount} Slack people synced` : "Choose people to sync"}
                    </Button>
                  )}
                  <Button variant="ghost" className="w-full" onClick={() => setCurrentStep(4)}>
                    Continue
                  </Button>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  You do not need Slack to use meetings, transcript chat, tasks, Board or Automations.
                </p>
              </StepShell>
            )}

            {currentStep === 4 && (
              <StepShell
                eyebrow="First success"
                icon={PartyPopper}
                title="You're ready — here is the shortest useful path"
                description="Start with one real meeting. Open it, ask a question about the transcript, review the commitments, then decide what should become a task or workflow."
              >
                <div className="space-y-3">
                  <NextStep number="1" title="Open Meetings" text="Pick a transcript and review the conversation in context." />
                  <NextStep number="2" title="Ask Taskwise" text="Ask what was decided, promised, blocked or due next." />
                  <NextStep number="3" title="Review before acting" text="Keep humans in control of tasks, sharing and downstream automation." />
                </div>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  <Button size="lg" onClick={() => void finishOnboarding("/meetings")} disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Video className="mr-2 h-5 w-5" />}
                    Open Meetings
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => void finishOnboarding("/chat")} disabled={isLoading}>
                    <MessageSquareText className="mr-2 h-5 w-5" />
                    Open Chat
                  </Button>
                </div>
              </StepShell>
            )}
          </Step>
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
            disabled={currentStep === 1 || isLoading}
          >
            Back
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
              Close for now
            </Button>
          )}
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

function ValueCard({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <Icon className="h-4 w-4 text-primary" />
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

function NextStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {number}
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

export default OnboardingWizard;
