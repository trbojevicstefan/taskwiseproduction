// src/components/auth/OnboardingWizard.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useFolders } from '@/contexts/FolderContext';
import { usePlanningHistory } from '@/contexts/PlanningHistoryContext';
import { useChatHistory } from '@/contexts/ChatHistoryContext';
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { processPastedContent } from '@/ai/flows/process-pasted-content';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Building, FolderPlus, Sparkles, Check, PartyPopper, MessageSquare, Brain, MousePointer, Share2, MoveHorizontal } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { ScrollArea } from '@/components/ui/scroll-area';
import { sanitizeTaskForFirestore } from '@/lib/data';
import type { ExtractedTaskSchema } from '@/types/chat';
import { v4 as uuidv4 } from 'uuid';
import CreatingMeetingAnimation from './CreatingMeetingAnimation';


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

// --- Pre-made data for templates ---
const meetingTranscriptExample = `
Team Sync - Q3 Roadmap

Desiree (desiree@example.com): Alright team, let's sync on the Q3 roadmap. Project Firefly is the top priority. Mark, what's the status on the spec?

Mark: The spec is 90% done. I need legal to review the new DPA clause before I finalize it. I'll send it to them by EOD tomorrow.

Sam (sam@example.com, Lead Engineer): Once the spec is final, my team can start the front-end work. We'll need about 3 sprints to get the beta ready.

Desiree: Okay, let's target a public beta launch for July 20th. Sam, can your team handle that?

Sam: It'll be tight, but yes. We'll need the final designs from the design team by the end of next week.

Anna (UX Designer): I'm on it. I'll schedule a design review for this Friday.

Desiree: Perfect. After the beta is out, I want to create a follow-up deck for the investors. Mark, can you draft the initial slides on the tech achievements?

Mark: You got it.
`;

const birthdayPlanTasks: ExtractedTaskSchema[] = [
    { id: 'bp-1', title: 'Guest List & Invitations', priority: 'high', subtasks: [
        { id: 'bp-1-1', title: 'Finalize guest list', priority: 'high', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-1-2', title: 'Design and send out invitations', priority: 'medium', dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), subtasks: null, description: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-1-3', title: 'Track RSVPs', priority: 'low', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
    ], description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
    { id: 'bp-2', title: 'Venue & Decorations', priority: 'high', subtasks: [
        { id: 'bp-2-1', title: 'Book party venue', priority: 'high', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-2-2', title: 'Plan theme and decorations', priority: 'medium', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-2-3', title: 'Purchase or make decorations', priority: 'medium', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
    ], description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
    { id: 'bp-3', title: 'Food & Drinks', priority: 'medium', subtasks: [
        { id: 'bp-3-1', title: 'Plan the menu', priority: 'medium', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-3-2', title: 'Order the birthday cake', priority: 'high', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
        { id: 'bp-3-3', title: 'Buy drinks and snacks', priority: 'low', subtasks: null, description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
    ], description: null, dueAt: null, aiAssistanceText: null, firestoreTaskId: null, addedToProjectId: null, addedToProjectName: null, researchBrief: null, assigneeName: null, assignee: null },
];

const OnboardingWizard = ({ onClose }: { onClose?: () => void }) => {
    const { user, updateUserProfile, completeOnboarding } = useAuth();
    const { addFolder } = useFolders();
    const { createNewPlanningSession } = usePlanningHistory();
    const { createNewSession: createNewChatSession } = useChatHistory();
    const { createNewMeeting, updateMeeting } = useMeetingHistory();
    const { toast } = useToast();
    const router = useRouter();

    const [currentStep, setCurrentStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
    const [destinationPage, setDestinationPage] = useState<string>('/chat');

    // State for individual steps
    const [workspaceName, setWorkspaceName] = useState('');
    const [folderName, setFolderName] = useState('');
    
    useEffect(() => {
        if (user?.workspace?.name) {
            setWorkspaceName(user.workspace.name);
        }
         if (!folderName) {
            setFolderName(`${user?.displayName || 'My'}'s First Project`);
        }
    }, [user, folderName]);
    
    const handleStep1Submit = async () => {
        if (!workspaceName.trim()) {
            toast({ title: "Workspace name cannot be empty.", variant: "destructive" });
            return;
        }
        setIsLoading(true);
        // Optimistically update UI
        setCurrentStep(2); 
        try {
            // Save in the background, avoid global loader
            await updateUserProfile({ workspace: { name: workspaceName.trim() } }, true); 
            toast({ title: "Workspace updated!" });
        } catch (error) {
            toast({ title: "Error", description: "Could not save workspace name.", variant: "destructive"});
            setCurrentStep(1); // Revert on error
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStep2Submit = async () => {
        if (!folderName.trim()) {
            toast({ title: "Folder name cannot be empty.", variant: "destructive" });
            return;
        }
        setIsLoading(true);
        // Optimistically update UI
        setCurrentStep(3);
        try {
            await addFolder({ name: folderName.trim(), parentId: null });
            toast({ title: "Folder created!" });
        } catch (error) {
            toast({ title: "Error", description: "Could not create folder.", variant: "destructive"});
            setCurrentStep(2); // Revert on error
        } finally {
            setIsLoading(false);
        }
    };

    const handleFinishOnboarding = async () => {
        setIsLoading(true);
        // The completeOnboarding function now hides the wizard immediately
        // and handles the backend update.
        await completeOnboarding();
        toast({ title: "Welcome to TaskWiseAI!", description: "Let's get started." });
        // The router push is now a secondary action. The primary action is closing the wizard.
        router.push(destinationPage);
        onClose?.();
        setIsLoading(false);
    }
    
    const handleTemplateSelection = async (template: 'chat' | 'plan') => {
        setIsCreatingTemplate(true);
        
        let destination = '/meetings';

        try {
            if (template === 'chat') {
                const requestedDetailLevel = user?.taskGranularityPreference || 'medium';
                const result = await processPastedContent({
                    pastedText: meetingTranscriptExample,
                    requestedDetailLevel,
                });
                
                if (result.isMeeting && result.meeting) {
                    const { meeting, allTaskLevels } = result;
                    // FIX: Ensure allTaskLevels is not undefined.
                    const meetingData = {
                        ...meeting,
                        allTaskLevels: allTaskLevels || { light: [], medium: [], detailed: [] },
                    };

                    const newMeeting = await createNewMeeting(meetingData);
                    
                    if (newMeeting) {
                        const newChat = await createNewChatSession({ title: `Chat about "${newMeeting.title}"`, sourceMeetingId: newMeeting.id, initialTasks: newMeeting.extractedTasks, initialPeople: newMeeting.attendees, allTaskLevels: newMeeting.allTaskLevels });
                        const newPlan = await createNewPlanningSession(newMeeting.summary, newMeeting.extractedTasks, `Plan from "${newMeeting.title}"`, newMeeting.allTaskLevels, newMeeting.id);
                        if(newChat && newPlan) {
                            await updateMeeting(newMeeting.id, { chatSessionId: newChat.id, planningSessionId: newPlan.id });
                        }
                    }
                    destination = `/meetings?open=${newMeeting?.id}`;
                } else {
                    // Fallback if the example is misclassified
                    await createNewChatSession({ title: result.titleSuggestion, initialTasks: result.tasks, initialPeople: result.people, allTaskLevels: result.allTaskLevels });
                    destination = '/chat';
                }
                
            } else if (template === 'plan') {
                destination = '/planning';
                const tasksWithIds = birthdayPlanTasks.map(task => ({
                    ...task,
                    id: uuidv4(),
                    subtasks: task.subtasks?.map(sub => ({...sub, id: uuidv4()})) || null
                }));
                await createNewPlanningSession("Plan a Birthday Party", tasksWithIds.map(t => sanitizeTaskForFirestore(t)), "Birthday Party Plan");
                
            }
            
            setDestinationPage(destination);
            setCurrentStep(4);

        } catch (error) {
             console.error("Onboarding template error:", error);
            toast({ title: "An error occurred", description: "Could not set up the example. Please try again.", variant: "destructive" });
        } finally {
             setIsCreatingTemplate(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, step: number) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (step === 1) handleStep1Submit();
            if (step === 2) handleStep2Submit();
        }
    };

    const renderStepContent = () => {
        if(isCreatingTemplate) {
            return (
                 <Step key="creating-template" step={currentStep} currentStep={currentStep}>
                    <div className="animated-glow-shadow">
                        <div className="p-6 bg-card border border-border/20 rounded-xl shadow-2xl flex flex-col h-full items-center justify-center text-center">
                            <CreatingMeetingAnimation />
                            <h2 className="text-xl font-bold font-headline mt-6">AI is Processing Your Example</h2>
                            <p className="text-muted-foreground mt-2">Just a moment while we set up the demo content for you...</p>
                        </div>
                    </div>
                </Step>
            )
        }

        switch (currentStep) {
            case 1:
                return (
                     <Step key={1} step={1} currentStep={currentStep}>
                        <div className="animated-glow-shadow">
                           <div className="text-center p-6 bg-card border border-border/20 rounded-xl shadow-2xl">
                               <div className="flex justify-center mb-6">
                                  <Logo size="md" isIconOnly={true}/>
                               </div>
                               <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                   <Building size={24} />
                               </div>
                               <h2 className="text-2xl font-bold font-headline mb-2">{`Welcome, ${user?.displayName || 'User'}!`}</h2>
                               <p className="text-muted-foreground mb-6">Let's start by giving your workspace a name. This helps you organize everything.</p>
                               <div className="mb-6">
                                   <Input placeholder="e.g., My Company, Side Hustle, etc." value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} disabled={isLoading} onKeyDown={(e) => handleKeyDown(e, 1)}/>
                               </div>
                               <Button size="lg" className="w-full" onClick={handleStep1Submit} disabled={isLoading}>
                                   {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Set Name & Continue"}
                               </Button>
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
                                  <Logo size="md" isIconOnly={true}/>
                               </div>
                               <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                   <FolderPlus size={24} />
                               </div>
                               <h2 className="text-2xl font-bold font-headline mb-2">Create Your First Project Folder</h2>
                               <p className="text-muted-foreground mb-6">Folders are how you organize different projects or areas of your life. Let's create one.</p>
                               <div className="mb-6">
                                   <Input placeholder="e.g., Q3 Marketing, Website Redesign..." value={folderName} onChange={(e) => setFolderName(e.target.value)} disabled={isLoading} onKeyDown={(e) => handleKeyDown(e, 2)}/>
                               </div>
                               <Button size="lg" className="w-full" onClick={handleStep2Submit} disabled={isLoading}>
                                   {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Create Folder & Continue"}
                               </Button>
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
                                  <Logo size="md" isIconOnly={true}/>
                               </div>
                               <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                                   <Sparkles size={24} />
                               </div>
                               <h2 className="text-2xl font-bold font-headline mb-2">Get Started with an Example</h2>
                               <p className="text-muted-foreground mb-6">Choose a template to see how TaskWiseAI can work for you.</p>
                               <div className="grid grid-cols-1 gap-4">
                                    <Button variant="outline" className="h-auto py-3 justify-start text-left" onClick={() => handleTemplateSelection('chat')} disabled={isLoading}>
                                        <MessageSquare className="mr-4 h-6 w-6 text-blue-500"/>
                                        <div>
                                            <p className="font-semibold">Process a Meeting</p>
                                            <p className="text-xs text-muted-foreground">Extract summary & tasks from a sample meeting transcript.</p>
                                        </div>
                                    </Button>
                                     <Button variant="outline" className="h-auto py-3 justify-start text-left" onClick={() => handleTemplateSelection('plan')} disabled={isLoading}>
                                        <PartyPopper className="mr-4 h-6 w-6 text-fuchsia-500"/>
                                        <div>
                                            <p className="font-semibold">Plan a Birthday Party</p>
                                            <p className="text-xs text-muted-foreground">See a pre-made hierarchical plan with tasks and sub-tasks.</p>
                                        </div>
                                     </Button>
                               </div>
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
                                      <Logo size="md" isIconOnly={true}/>
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
                                           <MoveHorizontal className="h-8 w-8 text-orange-400 mt-1 flex-shrink-0"/>
                                           <div>
                                               <h3 className="font-semibold">Swipe to Navigate</h3>
                                               <p className="text-xs text-muted-foreground">On mobile, swipe from the right edge to open tasks, and from the left to open the main menu.</p>
                                           </div>
                                       </div>
                                       <div className="flex items-start gap-4 p-3 bg-background rounded-lg border">
                                           <MousePointer className="h-8 w-8 text-blue-400 mt-1 flex-shrink-0"/>
                                           <div>
                                               <h3 className="font-semibold">Drag to Select</h3>
                                               <p className="text-xs text-muted-foreground">In the Tasks panel, click and drag on the thin slider to the left of the tasks to select multiple items at once.</p>
                                           </div>
                                       </div>
                                        <div className="flex items-start gap-4 p-3 bg-background rounded-lg border">
                                           <Share2 className="h-8 w-8 text-green-400 mt-1 flex-shrink-0"/>
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
                )
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
                    {[1, 2, 3, 4].map((step) => (
                        <div key={step} className={
                            `w-2.5 h-2.5 rounded-full transition-all duration-300 ${currentStep === step ? 'bg-primary scale-125' : 'bg-muted'}`
                        }/>
                    ))}
                 </div>
            </div>
        </div>
    );
};

export default OnboardingWizard;
