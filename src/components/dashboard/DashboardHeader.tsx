// src/components/dashboard/DashboardHeader.tsx
"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import HeaderNav from "./HeaderNav";
import { cn } from "@/lib/utils";


interface DashboardHeaderProps {
  pageIcon?: React.ElementType | null; // Changed to be optional or null
  pageTitle: React.ReactNode;
  children?: React.ReactNode;
}

export default function DashboardHeader({ pageIcon: Icon, pageTitle, children }: DashboardHeaderProps) {
  return (
    <div className="p-4 flex-shrink-0 bg-background">
      <div className="flex flex-row justify-between items-center gap-3">
        <div className="flex items-center gap-2 flex-grow min-w-0">
          <SidebarTrigger />
          <div className="flex-grow min-w-0 flex items-center gap-2">
             {Icon && <Icon className="mr-0 h-6 w-6 text-primary flex-shrink-0 hidden sm:block" />}
             <div className={cn("flex-grow min-w-0", !Icon && "ml-2")}>{pageTitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          {children}
          <HeaderNav />
        </div>
      </div>
    </div>
  );
}
