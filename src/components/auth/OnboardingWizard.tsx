// src/components/auth/OnboardingWizard.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { useToast } from '@/hooks/use-toast';
import { onPeopleSnapshot } from '@/lib/data';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { ScrollArea } from '@/components/ui/scroll-area';
import SlackSyncDialog from '@/components/dashboard/people/SlackSyncDialog';
import { Loader2, PartyPopper, MousePointer, Share2, MoveHorizontal, Slack, Users, Video, Check } from 'lucide-react';


const Step = ({ step, currentStep, children }: { step: number; currentStep: number; children: React.ReactNode }) => {
    return currentStep === step ? (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, duration: 0.3 }}
        className="h-full"
      >
        {children}
      </motion.div>
    ) : null;
};

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
    const [hasSyncedSlackPeople, setHasSyncedSlackPeople] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const storedStep = window.sessionStorage.getItem("onboardingStep");
        if (!storedStep) return;
        const parsedStep = Number.parseInt(storedStep, 10);
        if (Number.isNaN(parsedStep)) return;
        if (parsedStep >= 1 && parsedStep <= 4) {
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
            setHasSyncedSlackPeople(false);
            return;
        }

        const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
            const slackCount = loadedPeople.filter((person: any) => Boolean(person.slackId)).length;
            setSlackPeopleCount(slackCount);
            if (slackCount > 0) {
                setHasSyncedSlackPeople(true);
            }
        });

        return () => unsubscribe();
    }, [user?.uid]);

    const refreshPeople = async () => {
        try {
            const response = await fetch("/api/people");
            if (!response.ok) return;
            const data = await response.json();
            if (!Array.isArray(data)) return;
            const slackCount = data.filter((person: any) => Boolean(person.slackId)).length;
            setSlackPeopleCount(slackCount);
            if (slackCount > 0) {
                setHasSyncedSlackPeople(true);
            }
        } catch (error) {
            console.error("Failed to refresh people:", error);
        }
    };

    const handleFinishOnboarding = async () => {
        setIsLoading(true);
        await completeOnboarding();
        toast({ title: "Welcome to TaskWiseAI!", description: "Let's get started." });
        router.push("/chat");
        onClose?.();
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem("onboardingStep");
        }
        setIsLoading(false);
    };

    const hasSlackPeople = hasSyncedSlackPeople || slackPeopleCount > 0;

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return (
                    <Step key={1} step={1} currentStep={currentStep}>
                        <div className="animated-glow-shadow">
                            <div className="text-center p-6 bg-card border border-border/20 rounded-xl shadow-2xl">
                                <div className="flex justify-center mb-6">
                                    <Logo size="md" isIconOnly={true} />
                                </div>
                                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Slack size={24} />
                                </div>
                                <h2 className="text-2xl font-bold font-headline mb-2">Connect Slack</h2>
                                <p className="text-muted-foreground mb-6">
                                    Connect Slack to sync your team and share updates.
                                </p>
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
                                            <Check className="mr-2 h-5 w-5 text-green-500" />
                                        ) : (
                                            <Slack className="mr-2 h-5 w-5" />
                                        )}
                                        {isSlackConnected ? "Slack Connected" : "Connect Slack"}
                                    </Button>
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => setCurrentStep(2)}
                                        disabled={!isSlackConnected}
                                    >
                                        Continue
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="w-full"
                                        onClick={() => setCurrentStep(2)}
                                    >
                                        Skip for now
                                    </Button>
                                </div>
                                {!isSlackConnected && (
                                    <p className="text-xs text-muted-foreground mt-4">
                                        You will be redirected to Slack to authorize TaskWiseAI.
                                    </p>
                                )}
                            </div>
                        </div>
                    </Step>
                );
            case 2:
                return (
                    <Step key={2} step={2} currentStep={currentStep}>
                        <div className="animated-glow-shadow">
                            <div className="text-center p-6 bg-card border border-border/20 rounded-xl shadow-2xl">
                                <div className="flex justify-center mb-6">
                                    <Logo size="md" isIconOnly={true} />
                                </div>
                                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Users size={24} />
                                </div>
                                <h2 className="text-2xl font-bold font-headline mb-2">Import People</h2>
                                <p className="text-muted-foreground mb-4">
                                    Choose which Slack users to save in your people directory.
                                </p>
                                <div className="rounded-lg border bg-background/60 px-4 py-3 text-sm text-muted-foreground mb-4">
                                    {hasSlackPeople ? (
                                        <div className="flex items-center justify-center gap-2 text-foreground">
                                            <Check className="h-4 w-4 text-green-500" />
                                            {slackPeopleCount > 0
                                                ? `${slackPeopleCount} people synced from Slack.`
                                                : "Slack sync complete."}
                                        </div>
                                    ) : (
                                        <span>No Slack people synced yet.</span>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <Button
                                        size="lg"
                                        className="w-full"
                                        onClick={() => setIsSlackSyncOpen(true)}
                                        disabled={!isSlackConnected}
                                    >
                                        <Users className="mr-2 h-5 w-5" />
                                        Sync Slack Users
                                    </Button>
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => setCurrentStep(3)}
                                        disabled={!hasSlackPeople}
                                    >
                                        Continue
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="w-full"
                                        onClick={() => setCurrentStep(3)}
                                    >
                                        Skip for now
                                    </Button>
                                </div>
                                {!isSlackConnected && (
                                    <p className="text-xs text-muted-foreground mt-4">
                                        Connect Slack before syncing people.
                                    </p>
                                )}
                            </div>
                        </div>
                    </Step>
                );
            case 3:
                return (
                    <Step key={3} step={3} currentStep={currentStep}>
                        <div className="animated-glow-shadow">
                            <div className="text-center p-6 bg-card border border-border/20 rounded-xl shadow-2xl">
                                <div className="flex justify-center mb-6">
                                    <Logo size="md" isIconOnly={true} />
                                </div>
                                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Video size={24} />
                                </div>
                                <h2 className="text-2xl font-bold font-headline mb-2">Connect Fathom</h2>
                                <p className="text-muted-foreground mb-6">
                                    Pull meetings and transcripts directly from Fathom.
                                </p>
                                <div className="space-y-3">
                                    <Button
                                        size="lg"
                                        className="w-full"
                                        onClick={connectFathom}
                                        disabled={isLoadingFathomConnection || isFathomConnected}
                                    >
                                        {isLoadingFathomConnection ? (
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        ) : isFathomConnected ? (
                                            <Check className="mr-2 h-5 w-5 text-green-500" />
                                        ) : (
                                            <Video className="mr-2 h-5 w-5" />
                                        )}
                                        {isFathomConnected ? "Fathom Connected" : "Connect Fathom"}
                                    </Button>
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => setCurrentStep(4)}
                                        disabled={!isFathomConnected}
                                    >
                                        Continue
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="w-full"
                                        onClick={() => setCurrentStep(4)}
                                    >
                                        Skip for now
                                    </Button>
                                </div>
                                {!isFathomConnected && (
                                    <p className="text-xs text-muted-foreground mt-4">
                                        You will be redirected to Fathom to authorize TaskWiseAI.
                                    </p>
                                )}
                            </div>
                        </div>
                    </Step>
                );
            case 4:
                return (
                    <Step key={4} step={4} currentStep={currentStep}>
                        <div className="animated-glow-shadow">
                            <div className="text-center p-6 md:p-8 bg-card border border-border/20 rounded-xl shadow-2xl flex flex-col h-full">
                                <div className="flex-shrink-0">
                                    <div className="flex justify-center mb-4">
                                        <Logo size="md" isIconOnly={true} />
                                    </div>
                                    <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-2">
                                        <PartyPopper size={28} />
                                    </div>
                                    <h2 className="text-2xl font-bold font-headline mb-1">You're All Set!</h2>
                                    <p className="text-muted-foreground mb-4">Here are a couple of tips to get you started:</p>
                                </div>

                                <ScrollArea className="flex-grow my-4 text-left">
                                    <div className="space-y-4 pr-2">
                                        <div className="flex items-start gap-4 p-3 bg-background rounded-lg border">
                                            <MoveHorizontal className="h-8 w-8 text-orange-400 mt-1 flex-shrink-0" />
                                            <div>
                                                <h3 className="font-semibold">Swipe to Navigate</h3>
                                                <p className="text-xs text-muted-foreground">On mobile, swipe from the right edge to open tasks, and from the left to open the main menu.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-4 p-3 bg-background rounded-lg border">
                                            <MousePointer className="h-8 w-8 text-blue-400 mt-1 flex-shrink-0" />
                                            <div>
                                                <h3 className="font-semibold">Drag to Select</h3>
                                                <p className="text-xs text-muted-foreground">In the Tasks panel, click and drag on the thin slider to the left of the tasks to select multiple items at once.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-4 p-3 bg-background rounded-lg border">
                                            <Share2 className="h-8 w-8 text-green-400 mt-1 flex-shrink-0" />
                                            <div>
                                                <h3 className="font-semibold">Share Your Plan</h3>
                                                <p className="text-xs text-muted-foreground">After selecting tasks, a mobile menu will appear, letting you share via your phone's native share menu.</p>
                                            </div>
                                        </div>
                                    </div>
                                </ScrollArea>

                                <div className="flex-shrink-0 mt-4">
                                    <Button size="lg" className="w-full" onClick={handleFinishOnboarding} disabled={isLoading}>
                                        {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Let's Go!"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Step>
                );
            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="relative w-full max-w-md mx-auto h-auto">
                <button
                    type="button"
                    aria-label="Close onboarding"
                    className="absolute -top-2 -right-2 h-9 w-9 rounded-full border border-border/40 bg-background/80 text-muted-foreground hover:text-foreground hover:border-border flex items-center justify-center"
                    onClick={() => onClose?.()}
                >
                    X
                </button>
                <AnimatePresence mode="wait">
                    {renderStepContent()}
                </AnimatePresence>
                <div className="flex justify-center gap-2 mt-6">
                    {[1, 2, 3, 4].map((step: any) => (
                        <div
                            key={step}
                            className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${currentStep === step ? 'bg-primary scale-125' : 'bg-muted'}`}
                        />
                    ))}
                </div>
            </div>
            <SlackSyncDialog
                isOpen={isSlackSyncOpen}
                onClose={() => setIsSlackSyncOpen(false)}
                onSynced={() => {
                    setHasSyncedSlackPeople(true);
                    refreshPeople();
                }}
            />
        </div>
    );
};

export default OnboardingWizard;

