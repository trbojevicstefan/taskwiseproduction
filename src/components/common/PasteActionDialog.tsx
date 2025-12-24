
// src/components/common/PasteActionDialog.tsx
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { usePasteAction } from '@/contexts/PasteActionContext';
import { useChatHistory } from '@/contexts/ChatHistoryContext';
import { usePlanningHistory } from '@/contexts/PlanningHistoryContext';
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { useToast } from '@/hooks/use-toast';
import { processPastedContent } from '@/ai/flows/process-pasted-content';
import { Button } from '@/components/ui/button';
import { X, Users } from 'lucide-react';
import { Logo } from '../ui/logo';
import CreatingMeetingAnimation from '../auth/CreatingMeetingAnimation';


const Step = ({ children }: { children: React.ReactNode }) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30, duration: 0.3 }}
      className="h-full w-full"
    >
      {children}
    </motion.div>
);


const PasteActionDialog = () => {
    const router = useRouter();
    const { toast } = useToast();
    const { isDialogOpen, closePasteDialog, pastedText } = usePasteAction();
    const { createNewSession: createNewChatSession } = useChatHistory();
    const { createNewPlanningSession } = usePlanningHistory();
    const { createNewMeeting, updateMeeting, setActiveMeetingId } = useMeetingHistory();

    const [isProcessing, setIsProcessing] = useState(false);

    const handleClose = () => {
        // Don't close if it's processing
        if (isProcessing) return;
        closePasteDialog();
    };

    const handleProcessMeeting = async () => {
        if (!pastedText) return;

        setIsProcessing(true);
        toast({ title: 'AI is processing your content...', description: 'Please wait a moment.' });

        try {
            // This now calls the unified, powerful AI flow.
            const result = await processPastedContent({
                pastedText,
                requestedDetailLevel: "light",
            });
            
            if (result.isMeeting && result.meeting) {
                 const { meeting } = result;
                 // Ensure the main tasks for the meeting are the ones matching the selected granularity
                 const meetingWithCorrectTasks = {
                     ...meeting,
                     extractedTasks: result.tasks,
                     allTaskLevels: result.allTaskLevels,
                 };
                 
                 const newMeeting = await createNewMeeting(meetingWithCorrectTasks);
                 
                 if (newMeeting) {
                    // Create BOTH linked sessions, ensuring they also get the right set of initial tasks
                    const newChat = await createNewChatSession({
                        title: `Chat about "${newMeeting.title}"`,
                        sourceMeetingId: newMeeting.id,
                        initialTasks: newMeeting.extractedTasks, // Use tasks from the new meeting
                        initialPeople: newMeeting.attendees,
                        allTaskLevels: result.allTaskLevels,
                    });
                    const newPlan = await createNewPlanningSession(
                        newMeeting.summary,
                        newMeeting.extractedTasks, // Use tasks from the new meeting
                        `Plan from "${newMeeting.title}"`,
                        result.allTaskLevels,
                        newMeeting.id
                    );
                    
                    if (newChat && newPlan) {
                        // Link them back to the meeting object
                        await updateMeeting(newMeeting.id, {
                            chatSessionId: newChat.id,
                            planningSessionId: newPlan.id
                        });
                    }

                    toast({ title: 'Meeting Processed!', description: `Created a meeting, chat, and plan.` });
                    
                    // Navigate to meetings page and trigger opening the new meeting
                    router.push(`/meetings?open=${newMeeting.id}`);

                 } else {
                    throw new Error("Failed to create the meeting record.");
                 }
            } else { // This handles the case where it's NOT a meeting, fallback to Chat
                 const { tasks, titleSuggestion, people } = result;
                 await createNewChatSession({ title: titleSuggestion, initialMessage: { id: `msg-${Date.now()}`, text: pastedText, sender: 'user', timestamp: Date.now(), name: 'You' }, initialTasks: tasks, initialPeople: people });
                 toast({ title: 'Success!', description: `Created new chat: "${titleSuggestion}"`, duration: 5000 });
                 router.push('/chat');
            }
        } catch (error) {
            console.error("Error processing pasted content:", error);
            toast({ title: 'AI Error', description: 'Could not process the pasted content. Please try again.', variant: 'destructive' });
        } finally {
            setIsProcessing(false);
            closePasteDialog();
        }
    };

    const renderContent = () => {
        if (isProcessing) {
            return (
                 <Step key="processing">
                    <div className="animated-glow-shadow h-full">
                        <div className="p-6 bg-card border border-border/20 rounded-xl shadow-2xl flex flex-col h-full items-center justify-center text-center">
                            <CreatingMeetingAnimation />
                            <h2 className="text-xl font-bold font-headline mt-6">AI is Processing Your Content</h2>
                            <p className="text-muted-foreground mt-2">Just a moment while we set up the meeting, tasks, and plan...</p>
                        </div>
                    </div>
                </Step>
            );
        }

        return (
             <Step key="selection">
                <div className="animated-glow-shadow h-full">
                    <div className="p-6 bg-card border border-border/20 rounded-xl shadow-2xl flex flex-col h-full">
                        <div className="flex justify-center mb-4">
                            <Logo size="md" isIconOnly={true}/>
                        </div>
                        <div className="flex-shrink-0 mb-4 text-center">
                            <h2 className="text-2xl font-bold font-headline">Process Pasted Content</h2>
                            <p className="text-muted-foreground">The AI will analyze this content as a meeting transcript.</p>
                        </div>

                        <div className="flex-grow my-4 p-3 bg-background/50 rounded-lg border overflow-hidden relative text-sm max-h-40">
                             <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words h-full overflow-y-auto">
                                <code>{pastedText?.substring(0, 500) + (pastedText && pastedText.length > 500 ? "..." : "")}</code>
                            </pre>
                        </div>
                        
                        <div className="flex-shrink-0 grid grid-cols-1 gap-4">
                            <Button size="lg" onClick={handleProcessMeeting} disabled={isProcessing} className="w-full text-base h-12 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                                <Users size={20} className="mr-3"/>
                                Process
                            </Button>
                        </div>
                    </div>
                </div>
            </Step>
        );
    };

    return (
      <AnimatePresence>
        {isDialogOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 h-9 w-9 rounded-full bg-background/50 border"
              onClick={handleClose}
            >
              <X size={20} />
            </Button>
            <div className="w-full max-w-lg mx-auto h-auto">
              <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>
            </div>
          </div>
        )}
      </AnimatePresence>
    );
};

export default PasteActionDialog;

    
