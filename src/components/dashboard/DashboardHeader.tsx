// src/components/dashboard/DashboardHeader.tsx
"use client";

import Link from "next/link";
import { CircleHelp, Workflow } from "lucide-react";
import HeaderNav from "./HeaderNav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DashboardHeaderProps {
  pageIcon?: React.ElementType | null;
  pageTitle: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}

export default function DashboardHeader({
  pageIcon: Icon,
  pageTitle,
  description,
  children,
}: DashboardHeaderProps) {
  return (
    <div className="p-4 flex-shrink-0 bg-background">
      <div className="flex flex-row justify-between items-center gap-3">
        <div className="flex items-center gap-2 flex-grow min-w-0">
          <div className="flex-grow min-w-0 flex items-center gap-2">
            {Icon && (
              <Icon className="mr-0 h-6 w-6 text-primary flex-shrink-0 hidden sm:block" />
            )}
            <div className={cn("flex-grow min-w-0", !Icon && "ml-2")}>
              {pageTitle}
              {description && (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          {children}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                  <Link href="/automations" aria-label="Open Automations">
                    <Workflow className="h-5 w-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Automations</p>
                <p className="text-xs text-muted-foreground">Turn meeting events into controlled follow-up workflows.</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                  <Link href="/docs" aria-label="Open help and documentation">
                    <CircleHelp className="h-5 w-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Help & docs</p>
                <p className="text-xs text-muted-foreground">Learn how meetings, transcript chat, tasks, integrations, MCP and automations fit together.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <HeaderNav />
        </div>
      </div>
    </div>
  );
}
