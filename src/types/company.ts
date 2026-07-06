// src/types/company.ts

/** Serialized company/account shape returned by the /api/companies routes. */
export interface Company {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  aliases: string[];
  peopleIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** Lightweight task row rendered on the company profile. */
export interface CompanyTaskSummary {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  assigneeName: string | null;
  overdue: boolean;
  sourceSessionId: string | null;
}

/** Lightweight meeting row rendered on the company profile. */
export interface CompanyMeetingSummary {
  id: string;
  title: string;
  startTime: string | null;
  attendeeCount: number;
}

export interface CompanyProfileStats {
  peopleCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  completedTaskCount: number;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
}
