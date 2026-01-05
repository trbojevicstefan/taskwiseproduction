export type BoardStatusCategory = "todo" | "inprogress" | "done" | "recurring";

export interface BoardTemplateStatus {
  label: string;
  color: string;
  category: BoardStatusCategory;
  isTerminal?: boolean;
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  statuses: BoardTemplateStatus[];
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "kanban-basic",
    name: "Basic Kanban",
    description: "A classic flow with review and done states.",
    statuses: [
      { label: "To do", color: "#3b82f6", category: "todo" },
      { label: "In progress", color: "#f59e0b", category: "inprogress" },
      { label: "Review", color: "#8b5cf6", category: "inprogress" },
      { label: "Done", color: "#10b981", category: "done", isTerminal: true },
    ],
  },
  {
    id: "simple",
    name: "Simple Flow",
    description: "A lightweight board for quick tracking.",
    statuses: [
      { label: "Backlog", color: "#94a3b8", category: "todo" },
      { label: "Doing", color: "#f97316", category: "inprogress" },
      { label: "Done", color: "#22c55e", category: "done", isTerminal: true },
    ],
  },
  {
    id: "sales-pipeline",
    name: "Sales Pipeline",
    description: "Track deals from lead to close.",
    statuses: [
      { label: "Lead", color: "#38bdf8", category: "todo" },
      { label: "Qualified", color: "#6366f1", category: "inprogress" },
      { label: "Proposal", color: "#f59e0b", category: "inprogress" },
      { label: "Closed won", color: "#16a34a", category: "done", isTerminal: true },
    ],
  },
];

export const DEFAULT_BOARD_TEMPLATE_ID = "kanban-basic";

export const getBoardTemplate = (templateId?: string | null) =>
  BOARD_TEMPLATES.find((template) => template.id === templateId) ||
  BOARD_TEMPLATES.find((template) => template.id === DEFAULT_BOARD_TEMPLATE_ID) ||
  BOARD_TEMPLATES[0];
