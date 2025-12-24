// src/components/dashboard/chat/QuickShare.tsx
"use client";

import React from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Share2, Copy, FileText, Link as LinkIcon } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

interface QuickShareProps {
  task: ExtractedTaskSchema;
  onShare: () => Promise<void>; // Native share
  onCopy: () => void; // Copy as text
  onLinkShare?: () => void; // Optional: For magic link
  className?: string;
}

export default function QuickShare({ task, onShare, onCopy, onLinkShare, className }: QuickShareProps) {
  return (
    <Popover>
        <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 group", className)}>
                <Share2 className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors"/>
            </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1" align="end">
            <div className="flex flex-col">
                <Button variant="ghost" className="w-full justify-start" onClick={() => onShare()}>
                    <Share2 className="mr-2 h-4 w-4" /> Share via...
                </Button>
                <Separator className="my-1" />
                <Button variant="ghost" className="w-full justify-start" onClick={() => onCopy()}>
                    <Copy className="mr-2 h-4 w-4" /> Copy as Text
                </Button>
                {onLinkShare && (
                    <Button variant="ghost" className="w-full justify-start" onClick={onLinkShare}>
                        <LinkIcon className="mr-2 h-4 w-4" /> Copy Magic Link
                    </Button>
                )}
            </div>
        </PopoverContent>
    </Popover>
  );
}
