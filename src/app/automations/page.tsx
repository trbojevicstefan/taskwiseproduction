import type { Metadata } from "next";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import AutomationsPageContent from "@/components/dashboard/automations/AutomationsPageContent";

export const metadata: Metadata = {
  title: "Automations | TaskWiseAI",
  description: "Turn processed meetings into reliable follow-up workflows.",
};

export default function AutomationsPage() {
  return (
    <DashboardPageLayout>
      <AutomationsPageContent />
    </DashboardPageLayout>
  );
}
