
// src/components/auth/CreatingMeetingAnimation.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';
import { Logo } from '@/components/ui/logo';
import { Users, FileText, CheckCircle2, Bot } from 'lucide-react';

const animationSteps = [
    { text: "Analyzing transcript structure...", duration: 2000, progress: 25, icon: Bot },
    { text: "Identifying speakers and key moments...", duration: 2500, progress: 50, icon: Users },
    { text: "Extracting action items and tasks...", duration: 3000, progress: 75, icon: FileText },
    { text: "Building summary and plan...", duration: 1500, progress: 90, icon: CheckCircle2 },
];

const CreatingMeetingAnimation = () => {
    const [currentStep, setCurrentStep] = useState(0);
    const [progress, setProgress] = useState(10);

    useEffect(() => {
        const runAnimation = () => {
            if (currentStep < animationSteps.length) {
                const step = animationSteps[currentStep];
                setProgress(step.progress);
                const timer = setTimeout(() => {
                    setCurrentStep(currentStep + 1);
                }, step.duration);
                return () => clearTimeout(timer);
            } else {
                // Hold at 90 until processing is actually complete
                setProgress(90);
            }
        };
        return runAnimation();
    }, [currentStep]);
    
    const CurrentIcon = animationSteps[currentStep]?.icon || CheckCircle2;


    return (
        <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center text-center">
            <div className="relative h-40 w-full flex items-center justify-center">
                 <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, }}
                  >
                    <Logo size="lg" isIconOnly={true}/>
                  </motion.div>
            </div>
            <Progress value={progress} className="w-full h-2 transition-all duration-500" />
            <div className="h-16 mt-6 w-full flex items-center justify-center">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentStep}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.4 }}
                        className="flex items-center gap-3 text-lg font-medium text-muted-foreground"
                    >
                         <CurrentIcon className="h-6 w-6 text-primary"/>
                        <span>{animationSteps[currentStep]?.text || "Finalizing..."}</span>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default CreatingMeetingAnimation;

    