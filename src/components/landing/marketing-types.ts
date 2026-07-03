import type { LucideIcon } from "lucide-react";

export type MarketingNavItem = {
  href: string;
  label: string;
};

export type MarketingCard = {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  badge?: string;
};

export type MarketingStep = {
  title: string;
  description: string;
  eyebrow: string;
};
