export const TASK_TYPE_VALUES = [
  "coordination",
  "communication",
  "documentation",
  "delivery",
  "design",
  "engineering",
  "research",
  "legal",
  "sales",
  "marketing",
  "operations",
  "general",
] as const;

export type TaskTypeCategory = (typeof TASK_TYPE_VALUES)[number];

export const TASK_TYPE_LABELS: Record<TaskTypeCategory, string> = {
  coordination: "Coordination",
  communication: "Communication",
  documentation: "Documentation",
  delivery: "Delivery",
  design: "Design",
  engineering: "Engineering",
  research: "Research",
  legal: "Legal",
  sales: "Sales",
  marketing: "Marketing",
  operations: "Operations",
  general: "General",
};
