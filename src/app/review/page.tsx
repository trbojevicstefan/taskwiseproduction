import type { Metadata } from "next";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import ReviewTasksPageContent from "@/components/dashboard/review/ReviewTasksPageContent";

export const metadata: Metadata = {
  title: "Review Tasks | TaskWiseAI",
  description: "Review AI-suggested meeting tasks before moving work forward.",
};

export default function ReviewTasksPage() {
  return (
    <DashboardPageLayout>
      <ReviewTasksPageContent />
    </DashboardPageLayout>
  );
}
