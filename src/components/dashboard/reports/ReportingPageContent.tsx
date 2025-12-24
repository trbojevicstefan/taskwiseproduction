// src/components/dashboard/reports/ReportingPageContent.tsx
"use client";

import { BarChart, Users } from 'lucide-react';
import ReportCard from './ReportCard';
import DashboardHeader from '../DashboardHeader';

export default function ReportingPageContent() {
  return (
    <div className="flex flex-col h-full">
        <DashboardHeader
          pageIcon={BarChart}
          pageTitle={<h1 className="text-2xl font-bold font-headline">Reports</h1>}
        />
      <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-6 overflow-auto">
        <p className="text-muted-foreground">
            Visualize your productivity and track team performance.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <ReportCard
            title="Tasks Completed This Week"
            value="42"
            change="+10%"
            changeType="increase"
          />
          <ReportCard
            title="Avg. Task Completion Time"
            value="2.5 days"
            change="-5%"
            changeType="decrease"
          />
          <ReportCard
            title="Overdue Tasks"
            value="8"
            change="+15%"
            changeType="increase"
          />
          {/* Add more ReportCard components here as needed */}
        </div>
      </div>
    </div>
  );
}
